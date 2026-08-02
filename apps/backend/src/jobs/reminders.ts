import { db } from '../lib/db'
import { evolutionSend } from '../services/evolution'
import { getBotConfig } from '../lib/botConfig'
import { renderReminderTemplate } from '../lib/reminderText'

const REMINDER_QUERY = `
  SELECT
    a.id          AS appointment_id,
    a.tenant_id,
    a.customer_id,
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
  JOIN platform_plans   pp ON pp.slug = t.plan
  LEFT JOIN agent_config ac ON ac.tenant_id = a.tenant_id
  JOIN whatsapp_instances wi ON wi.tenant_id = a.tenant_id AND wi.status = 'connected'
  WHERE
    a.status = 'completed'
    -- #10: gating — lembrete de retorno só se o plano inclui o recurso.
    AND COALESCE((pp.capabilities->>'return_reminders')::boolean, false) = TRUE
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
  // Nunca chamar o cliente pelo número: quando o nome ainda é o próprio telefone
  // (cadastro automático do webhook), {cliente} vira vazio — "Olá!" em vez de
  // "Olá 5511999...". Mesma comparação que o bot usa (nameIsKnown).
  const clienteName =
    row.customer_name && row.customer_name !== row.customer_phone ? row.customer_name : ''
  const message = renderReminderTemplate(template, {
    cliente: clienteName,
    servico: row.service_name ?? '',
    negocio: row.business_name ?? '',
    dias: days,
  })
  // Sem nome, o template deixa sobras tipo "Olá , tudo bem?" — compacta espaços órfãos.
  return clienteName ? message : message.replace(/[ \t]+([!,.?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}

/**
 * Persist a sent reminder as an `assistant` message in the customer's
 * conversation (find-or-create, same pattern as the webhook) — so the owner sees
 * it in the chat history and the bot has context when the customer replies.
 */
async function persistReminderMessage(tenantId: string, customerId: string, content: string): Promise<void> {
  const { rows: [created] } = await db.query(
    `INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [tenantId, customerId]
  )
  const conversationId = created?.id ?? (
    await db.query(
      'SELECT id FROM conversations WHERE tenant_id = $1 AND customer_id = $2',
      [tenantId, customerId]
    )
  ).rows[0]?.id
  if (!conversationId) return
  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [tenantId, conversationId, 'assistant', content]
  )
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
      // Keep the reminder in the conversation history (owner visibility + bot context).
      // A persistence failure must not mark the (already sent) reminder as failed.
      try {
        await persistReminderMessage(row.tenant_id, row.customer_id, message)
      } catch (persistErr: any) {
        console.error(`[reminders] persist failed for appointment ${row.appointment_id}:`, persistErr?.message ?? persistErr)
      }
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
