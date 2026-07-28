import { db } from '../lib/db'
import { encrypt, decrypt } from '../lib/crypto'
import { getGoogleConfig } from '../lib/integrationConfig'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const google = await getGoogleConfig()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: google.client_id,
      client_secret: google.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Failed to refresh Google token')
  return data.access_token
}

async function getValidToken(userId: string): Promise<{ accessToken: string; calendarId: string } | null> {
  const { rows: [token] } = await db.query(
    'SELECT access_token, refresh_token, token_expiry, calendar_id FROM google_calendar_tokens WHERE user_id = $1 AND sync_enabled = TRUE',
    [userId]
  )
  if (!token) return null

  let accessToken = decrypt(token.access_token)
  if (!token.token_expiry || new Date(token.token_expiry) <= new Date()) {
    accessToken = await refreshAccessToken(decrypt(token.refresh_token))
    await db.query(
      'UPDATE google_calendar_tokens SET access_token = $1, token_expiry = $2, updated_at = NOW() WHERE user_id = $3',
      [encrypt(accessToken), new Date(Date.now() + 3600_000).toISOString(), userId]
    )
  }

  return { accessToken, calendarId: token.calendar_id }
}

export async function syncAppointmentToCalendar(appointmentId: string) {
  const { rows: [appt] } = await db.query(
    `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
            s.name as service_name, s.duration_minutes,
            p.name as professional_name, p.user_id as professional_user_id,
            t.name as business_name
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN services s ON s.id = a.service_id
     JOIN professionals p ON p.id = a.professional_id
     JOIN tenants t ON t.id = a.tenant_id
     WHERE a.id = $1`,
    [appointmentId]
  )
  if (!appt) return

  // Collect users who should get this event synced:
  // 1. The professional (if they have a linked user with sync enabled)
  // 2. All owners/admins of the tenant who have sync enabled
  const { rows: syncUsers } = await db.query(
    `SELECT DISTINCT gct.user_id, gct.calendar_id
     FROM google_calendar_tokens gct
     WHERE gct.tenant_id = $1 AND gct.sync_enabled = TRUE
     AND (
       gct.user_id IN (
         SELECT ur.user_id FROM user_roles ur WHERE ur.tenant_id = $1 AND ur.role IN ('owner', 'admin')
       )
       OR gct.user_id = $2
     )`,
    [appt.tenant_id, appt.professional_user_id]
  )

  const eventBody = {
    summary: `${appt.service_name} — ${appt.customer_name}`,
    description: `Serviço: ${appt.service_name}\nCliente: ${appt.customer_name}\nTelefone: ${appt.customer_phone}\nProfissional: ${appt.professional_name}`,
    start: { dateTime: appt.starts_at, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: appt.ends_at, timeZone: 'America/Sao_Paulo' },
    attendees: [{ displayName: appt.customer_name, email: `${appt.customer_phone}@placeholder.agendabot.local` }],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
  }

  for (const { user_id, calendar_id } of syncUsers) {
    try {
      const tokenData = await getValidToken(user_id)
      if (!tokenData) continue

      // Check if event already exists
      const { rows: [existing] } = await db.query(
        'SELECT google_event_id FROM google_calendar_events WHERE appointment_id = $1 AND user_id = $2',
        [appointmentId, user_id]
      )

      const url = existing
        ? `${GOOGLE_CALENDAR_API}/calendars/${calendar_id}/events/${existing.google_event_id}`
        : `${GOOGLE_CALENDAR_API}/calendars/${calendar_id}/events`

      const res = await fetch(url, {
        method: existing ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      })

      const event = await res.json()
      if (!event.id) continue

      await db.query(
        `INSERT INTO google_calendar_events (appointment_id, user_id, google_event_id)
         VALUES ($1, $2, $3) ON CONFLICT (appointment_id, user_id) DO UPDATE SET google_event_id = $3`,
        [appointmentId, user_id, event.id]
      )
    } catch (err) {
      console.error(`Google Calendar sync failed for user ${user_id}:`, err)
    }
  }
}

export async function deleteCalendarEvent(appointmentId: string) {
  const { rows } = await db.query(
    'SELECT user_id, google_event_id FROM google_calendar_events WHERE appointment_id = $1',
    [appointmentId]
  )

  for (const { user_id, google_event_id } of rows) {
    try {
      const tokenData = await getValidToken(user_id)
      if (!tokenData) continue

      const { rows: [token] } = await db.query(
        'SELECT calendar_id FROM google_calendar_tokens WHERE user_id = $1',
        [user_id]
      )

      await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${token.calendar_id}/events/${google_event_id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${tokenData.accessToken}` } }
      )
    } catch {}
  }

  await db.query('DELETE FROM google_calendar_events WHERE appointment_id = $1', [appointmentId])
}

export async function verifyGoogleIdToken(idToken: string) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
  if (!res.ok) throw new Error('Invalid Google token')
  const data = (await res.json()) as {
    sub: string; email: string; name: string; picture: string
    aud: string; iss: string; email_verified?: string
  }

  // Verify the token was issued FOR this application, not any Google OAuth app.
  const google = await getGoogleConfig()
  const allowed = (google.client_ids || google.client_id || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (allowed.length && !allowed.includes(data.aud)) {
    throw new Error('Google token audience mismatch')
  }
  if (data.iss !== 'accounts.google.com' && data.iss !== 'https://accounts.google.com') {
    throw new Error('Invalid Google token issuer')
  }

  // AUTH-15: uma conta Google com e-mail NÃO verificado não pode virar usuário
  // verificado na plataforma (o cadastro via Google grava email_verified=TRUE
  // em users). O endpoint tokeninfo devolve email_verified como STRING
  // ("true"/"false"); tokens antigos podem trazer boolean — String() cobre os
  // dois. statusCode 403 → o error handler global devolve esta mensagem
  // amigável em vez de um 500 genérico.
  if (String(data.email_verified) !== 'true') {
    const err: any = new Error('O e-mail da sua conta Google ainda não foi verificado. Confirme seu e-mail no Google e tente novamente.')
    err.statusCode = 403
    throw err
  }

  return data
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const google = await getGoogleConfig()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: google.client_id,
      client_secret: google.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const data = await res.json()
  if (!data.refresh_token) throw new Error('No refresh token returned — ensure access_type=offline&prompt=consent')
  return data as { access_token: string; refresh_token: string; expires_in: number; id_token?: string }
}
