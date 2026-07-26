import { db } from '../lib/db'
import { sendAppointmentInvite } from '../lib/email'

// Sends calendar invites (.ics) for a customer's UPCOMING appointments to their
// saved email. Used both after a booking (auto) and on demand from the bot.

export type InviteResult =
  | { ok: true; count: number }
  | { ok: false; reason: 'sem_email' | 'sem_agendamento' | 'erro' }

const APPT_QUERY = `
  SELECT a.id, a.starts_at, a.ends_at,
         s.name AS service_name,
         p.name AS professional_name,
         c.name AS customer_name, c.email AS customer_email,
         t.name AS business_name,
         COALESCE(NULLIF(TRIM(CONCAT_WS(', ',
           NULLIF(ac.address, ''), NULLIF(ac.neighborhood, ''),
           NULLIF(TRIM(CONCAT_WS(' - ', NULLIF(ac.city, ''), NULLIF(ac.state, ''))), ''))), ''), '') AS location
  FROM appointments a
  JOIN services      s  ON s.id = a.service_id
  JOIN professionals p  ON p.id = a.professional_id
  JOIN customers     c  ON c.id = a.customer_id
  JOIN tenants       t  ON t.id = a.tenant_id
  LEFT JOIN agent_config ac ON ac.tenant_id = a.tenant_id
`

async function sendForRow(row: any): Promise<boolean> {
  return sendAppointmentInvite({
    to: row.customer_email,
    customerName: row.customer_name,
    businessName: row.business_name,
    serviceName: row.service_name,
    professionalName: row.professional_name,
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    location: row.location || row.business_name,
    uid: `appt-${row.id}@agendabot`,
  })
}

/** Invite for a single appointment (used right after booking). */
export async function sendInviteForAppointment(tenantId: string, appointmentId: string): Promise<InviteResult> {
  try {
    const { rows: [row] } = await db.query(
      `${APPT_QUERY} WHERE a.id = $1 AND a.tenant_id = $2`,
      [appointmentId, tenantId]
    )
    if (!row) return { ok: false, reason: 'sem_agendamento' }
    if (!row.customer_email) return { ok: false, reason: 'sem_email' }
    await sendForRow(row)
    return { ok: true, count: 1 }
  } catch (err) {
    console.error('[invite] falha ao enviar invite do agendamento:', err)
    return { ok: false, reason: 'erro' }
  }
}

/** Invites for all of a customer's upcoming (future, not cancelled) appointments. */
export async function sendInvitesForCustomerUpcoming(tenantId: string, customerId: string): Promise<InviteResult> {
  try {
    const { rows } = await db.query(
      `${APPT_QUERY}
       WHERE a.tenant_id = $1 AND a.customer_id = $2
         AND a.status <> 'cancelled' AND a.starts_at > NOW()
       ORDER BY a.starts_at`,
      [tenantId, customerId]
    )
    if (rows.length === 0) return { ok: false, reason: 'sem_agendamento' }
    if (!rows[0].customer_email) return { ok: false, reason: 'sem_email' }

    let sent = 0
    for (const row of rows) {
      if (await sendForRow(row)) sent++
    }
    return { ok: true, count: sent }
  } catch (err) {
    console.error('[invite] falha ao enviar invites do cliente:', err)
    return { ok: false, reason: 'erro' }
  }
}
