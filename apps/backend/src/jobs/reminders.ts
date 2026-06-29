import { db } from '../lib/db'
import { evolutionSend } from '../services/evolution'

const REMINDER_QUERY = `
  SELECT
    a.id          AS appointment_id,
    a.starts_at,
    c.name        AS customer_name,
    c.phone       AS customer_phone,
    s.name        AS service_name,
    s.reminder_days,
    t.name        AS business_name,
    wi.instance_name
  FROM appointments a
  JOIN services         s  ON s.id = a.service_id
  JOIN customers        c  ON c.id = a.customer_id
  JOIN tenants          t  ON t.id = a.tenant_id
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

function buildMessage(customerName: string, serviceName: string, reminderDays: number, businessName: string): string {
  return (
    `Olá, ${customerName}! 😊\n\n` +
    `Tudo bem? Notamos que já faz ${reminderDays} ${reminderDays === 1 ? 'dia' : 'dias'} desde o seu último ` +
    `*${serviceName}* aqui na *${businessName}*.\n\n` +
    `Que tal agendar um novo atendimento? Estamos à disposição! 📅\n\n` +
    `Responda esta mensagem para marcar seu horário. 😊`
  )
}

export async function runReminderJob() {
  let sent = 0
  let failed = 0

  const { rows } = await db.query(REMINDER_QUERY)
  if (rows.length === 0) return

  for (const row of rows) {
    const message = buildMessage(
      row.customer_name,
      row.service_name,
      row.reminder_days,
      row.business_name,
    )

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
