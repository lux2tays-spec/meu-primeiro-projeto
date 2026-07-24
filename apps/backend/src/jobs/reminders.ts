import { db } from '../lib/db'
import { evolutionSend } from '../services/evolution'
import { getBotConfig } from '../lib/botConfig'
import { renderReminderTemplate } from '../lib/reminderText'

const REMINDER_QUERY = `
  SELECT
    a.id          AS appointment_id,
    a.starts_at,
    c.name        AS customer_name,
    c.phone       AS customer_phone,
    s.name        AS service_name,
    s.reminder_days,
    t.name        AS business_name,
    ac.reminder_return_template,
    wi.instance_name
  FROM appointments a
  JOIN services         s  ON s.id = a.service_id
  JOIN customers        c  ON c.id = a.customer_id
  JOIN tenants          t  ON t.id = a.tenant_id
  LEFT JOIN agent_config ac ON ac.tenant_id = a.tenant_id
  JOIN whatsapp_instances wi ON wi.tenant_id = a.tenant_id AND wi.status = 'connected'
  WHERE
    a.status = 'completed'
    AND s.reminder_days IS NOT NULL
    AND s.reminder_days > 0
    AND (NOW()::date - a.starts_at::date) = s.reminder_days
    AND NOT EXISTS (
      SELECT 1 FROM appointment_reminders ar WHERE ar.appointment_id = a.id
    )
`

// Template resolution: per-tenant override (agent_config) → global (bot_config).
function buildMessage(row: any, globalTemplate: string): string {
  const template = (row.reminder_return_template?.trim()) || globalTemplate
  const days = `${row.reminder_days} ${row.reminder_days === 1 ? 'dia' : 'dias'}`
  return renderReminderTemplate(template, {
    cliente: row.customer_name ?? '',
    servico: row.service_name ?? '',
    negocio: row.business_name ?? '',
    dias: days,
  })
}

export async function runReminderJob() {
  let sent = 0
  let failed = 0

  const { rows } = await db.query(REMINDER_QUERY)
  if (rows.length === 0) return

  const botCfg = await getBotConfig()

  for (const row of rows) {
    const message = buildMessage(row, botCfg.reminder_return_template)

    let status = 'sent'
    let errorMessage: string | null = null

    try {
      await evolutionSend(row.instance_name, row.customer_phone, message)
      sent++
    } catch (err: any) {
      status = 'failed'
      errorMessage = err?.message ?? 'Unknown error'
      failed++
    }

    // Record the attempt (even failures) to prevent retry loops
    await db.query(
      `INSERT INTO appointment_reminders (appointment_id, status, error_message)
       VALUES ($1, $2, $3)
       ON CONFLICT (appointment_id) DO NOTHING`,
      [row.appointment_id, status, errorMessage],
    )
  }

  if (sent > 0 || failed > 0) {
    console.log(`[reminders] ${sent} sent, ${failed} failed`)
  }
}

// Runs once at startup then every 24h
export function startReminderJob() {
  // Small initial delay so the server is fully booted
  setTimeout(() => {
    runReminderJob().catch((err) => console.error('[reminders] startup run error:', err))
    setInterval(() => {
      runReminderJob().catch((err) => console.error('[reminders] scheduled run error:', err))
    }, 24 * 60 * 60 * 1000)
  }, 10_000)
}
