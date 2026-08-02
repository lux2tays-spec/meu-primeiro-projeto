import { db } from '../lib/db'
import { evolutionSend } from '../services/evolution'

// #3 — Lembrete de aniversário: prospecta agendamentos de quem faz aniversário.
// Roda 1x/dia. Para cada tenant com o recurso LIGADO e WhatsApp conectado, busca
// clientes cujo aniversário cai daqui a `birthday_reminder_days_before` dias
// (0 = hoje) e envia a mensagem configurada. Dedup por (cliente, ano).

const BIRTHDAY_QUERY = `
  SELECT
    c.id            AS customer_id,
    c.tenant_id,
    c.name          AS customer_name,
    c.phone         AS customer_phone,
    t.name          AS business_name,
    ac.birthday_reminder_message,
    ac.birthday_reminder_days_before,
    wi.instance_name
  FROM customers c
  JOIN tenants t              ON t.id = c.tenant_id
  JOIN agent_config ac        ON ac.tenant_id = c.tenant_id
  JOIN whatsapp_instances wi  ON wi.tenant_id = c.tenant_id AND wi.status = 'connected'
  WHERE
    c.deleted_at IS NULL
    AND c.birth_date IS NOT NULL
    AND ac.birthday_reminder_enabled = TRUE
    AND t.status IN ('active', 'trial')
    -- Aniversário (mês/dia) daqui a N dias (N = days_before), ignorando o ano.
    AND EXTRACT(MONTH FROM c.birth_date) = EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'America/Sao_Paulo')::date + ac.birthday_reminder_days_before)
    AND EXTRACT(DAY   FROM c.birth_date) = EXTRACT(DAY   FROM (NOW() AT TIME ZONE 'America/Sao_Paulo')::date + ac.birthday_reminder_days_before)
    -- Ainda não enviado neste ano.
    AND NOT EXISTS (
      SELECT 1 FROM birthday_reminders br
      WHERE br.customer_id = c.id
        AND br.year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
    )
`

const DEFAULT_MESSAGE =
  'Olá {cliente}! 🎉 A equipe do {negocio} passou aqui para desejar um feliz aniversário! ' +
  'Que tal comemorar com a gente? Responda esta mensagem para agendar um horário especial. 🎁'

function buildMessage(row: any): string {
  const template = (row.birthday_reminder_message?.trim()) || DEFAULT_MESSAGE
  // Nunca chamar o cliente pelo número (cadastro automático usa o telefone como nome).
  const cliente = row.customer_name && row.customer_name !== row.customer_phone ? row.customer_name : ''
  const msg = template
    .replaceAll('{cliente}', cliente)
    .replaceAll('{negocio}', row.business_name ?? '')
  // Sem nome, compacta sobras tipo "Olá , ".
  return cliente ? msg : msg.replace(/[ \t]+([!,.?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}

// Registra o envio na conversa (visível para o dono + contexto p/ o bot).
async function persistMessage(tenantId: string, customerId: string, content: string): Promise<void> {
  const { rows: [created] } = await db.query(
    `INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [tenantId, customerId]
  )
  const conversationId = created?.id ?? (
    await db.query('SELECT id FROM conversations WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId])
  ).rows[0]?.id
  if (!conversationId) return
  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [tenantId, conversationId, 'assistant', content]
  )
}

export async function runBirthdayReminderJob() {
  let sent = 0, failed = 0
  const { rows } = await db.query(BIRTHDAY_QUERY)
  if (rows.length === 0) return

  const year = new Date().getFullYear()

  for (const row of rows) {
    const message = buildMessage(row)
    let status = 'sent'
    try {
      await evolutionSend(row.instance_name, row.customer_phone, message)
      sent++
      try { await persistMessage(row.tenant_id, row.customer_id, message) }
      catch (e: any) { console.error(`[birthday] persist falhou cliente ${row.customer_id}:`, e?.message ?? e) }
    } catch (err: any) {
      status = 'failed'
      failed++
    }
    // Marca (mesmo falha) para não repetir no mesmo ano.
    await db.query(
      `INSERT INTO birthday_reminders (customer_id, year, status) VALUES ($1, $2, $3)
       ON CONFLICT (customer_id, year) DO NOTHING`,
      [row.customer_id, year, status]
    )
  }

  if (sent > 0 || failed > 0) console.log(`[birthday] ${sent} enviados, ${failed} falharam`)
}

// Roda 10s após o boot e depois a cada 24h.
export function startBirthdayReminderJob() {
  setTimeout(() => {
    runBirthdayReminderJob().catch((err) => console.error('[birthday] startup run error:', err))
    setInterval(() => {
      runBirthdayReminderJob().catch((err) => console.error('[birthday] scheduled run error:', err))
    }, 24 * 60 * 60 * 1000)
  }, 12_000)
}
