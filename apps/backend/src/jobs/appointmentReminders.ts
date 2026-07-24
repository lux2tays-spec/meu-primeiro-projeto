import { db } from '../lib/db'
import { evolutionSend } from '../services/evolution'
import { getBotConfig } from '../lib/botConfig'
import { renderReminderTemplate } from '../lib/reminderText'

const TZ = 'America/Sao_Paulo'

// For every tenant with appointment reminders enabled AND a connected WhatsApp
// instance, find upcoming (pending/confirmed) appointments whose starts_at is
// inside one of the reminder windows [starts_at - N minutes, starts_at) and
// that haven't had that reminder kind logged yet. Each appointment yields up
// to two rows (kind 'r1' / 'r2') via the LATERAL VALUES join.
const DUE_REMINDERS_QUERY = `
  SELECT
    a.id          AS appointment_id,
    a.starts_at,
    c.name        AS customer_name,
    c.phone       AS customer_phone,
    s.name        AS service_name,
    t.name        AS business_name,
    ac.reminder_appointment_template,
    wi.instance_name,
    k.kind
  FROM appointments a
  JOIN agent_config      ac ON ac.tenant_id = a.tenant_id AND ac.appointment_reminders_enabled = TRUE
  JOIN services          s  ON s.id = a.service_id
  JOIN customers         c  ON c.id = a.customer_id
  JOIN tenants           t  ON t.id = a.tenant_id
  JOIN whatsapp_instances wi ON wi.tenant_id = a.tenant_id AND wi.status = 'connected'
  CROSS JOIN LATERAL (
    VALUES ('r1', ac.reminder1_minutes), ('r2', ac.reminder2_minutes)
  ) AS k(kind, minutes)
  WHERE
    a.status IN ('pending', 'confirmed')
    AND k.minutes > 0
    AND a.starts_at > NOW()
    AND NOW() >= a.starts_at - make_interval(mins => k.minutes)
    AND NOT EXISTS (
      SELECT 1 FROM appointment_reminder_log l
      WHERE l.appointment_id = a.id AND l.kind = k.kind
    )
  ORDER BY a.starts_at
`

// Template resolution: per-tenant override (agent_config) → global (bot_config).
function buildMessage(row: any, startsAt: Date, globalTemplate: string): string {
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(startsAt)
  const dayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' })

  const apptDay = dayFmt.format(startsAt)
  const now = new Date()
  const today = dayFmt.format(now)
  const tomorrow = dayFmt.format(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  const when =
    apptDay === today ? 'hoje' :
    apptDay === tomorrow ? 'amanhã' :
    `no dia ${apptDay}`

  const template = (row.reminder_appointment_template?.trim()) || globalTemplate
  return renderReminderTemplate(template, {
    cliente: row.customer_name ?? '',
    servico: row.service_name ?? '',
    negocio: row.business_name ?? '',
    quando: when,
    hora: time,
  })
}

export async function runAppointmentReminders() {
  const { rows } = await db.query(DUE_REMINDERS_QUERY)
  if (rows.length === 0) return

  const botCfg = await getBotConfig()

  // If both r1 and r2 became due at the same time (e.g. appointment booked at
  // the last minute), send a single message but log both kinds so the customer
  // isn't pinged twice back-to-back.
  const byAppointment = new Map<string, any[]>()
  for (const row of rows) {
    const list = byAppointment.get(row.appointment_id) ?? []
    list.push(row)
    byAppointment.set(row.appointment_id, list)
  }

  let sent = 0
  let failed = 0

  for (const dueRows of byAppointment.values()) {
    // Idempotency: claim every due kind first (INSERT ... ON CONFLICT DO NOTHING).
    // Only send if at least one insert actually created a row — this guarantees
    // exactly-once even with overlapping runs or multiple instances.
    let claimed = false
    for (const row of dueRows) {
      const { rowCount } = await db.query(
        `INSERT INTO appointment_reminder_log (appointment_id, kind)
         VALUES ($1, $2)
         ON CONFLICT (appointment_id, kind) DO NOTHING`,
        [row.appointment_id, row.kind],
      )
      if (rowCount && rowCount > 0) claimed = true
    }
    if (!claimed) continue

    const row = dueRows[0]
    const message = buildMessage(row, new Date(row.starts_at), botCfg.reminder_appointment_template)

    try {
      await evolutionSend(row.instance_name, row.customer_phone, message)
      sent++
    } catch (err: any) {
      failed++
      console.error(`[appointment-reminders] send failed for appointment ${row.appointment_id}:`, err?.message ?? err)
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`[appointment-reminders] ${sent} sent, ${failed} failed`)
  }
}

// Runs once shortly after boot, then every 5 minutes
export function startAppointmentReminders() {
  setTimeout(() => {
    runAppointmentReminders().catch((err) => console.error('[appointment-reminders] startup run error:', err))
    setInterval(() => {
      runAppointmentReminders().catch((err) => console.error('[appointment-reminders] scheduled run error:', err))
    }, 5 * 60 * 1000)
  }, 15_000)
}
