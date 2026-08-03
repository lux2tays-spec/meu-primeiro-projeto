import { db } from './db'
import { evolutionSend } from '../services/evolution'

// #2 — Quando um agendamento é confirmado manualmente, envia imediatamente a
// confirmação no WhatsApp do cliente. Best-effort: nunca lança (não derruba a
// resposta da rota). Sem WhatsApp conectado → simplesmente não envia.

const QUERY = `
  SELECT a.starts_at, a.source,
         c.name  AS customer_name,
         c.phone AS customer_phone,
         s.name  AS service_name,
         p.name  AS professional_name,
         t.name  AS business_name,
         wi.instance_name
  FROM appointments a
  JOIN customers c ON c.id = a.customer_id
  JOIN services  s ON s.id = a.service_id
  LEFT JOIN professionals p ON p.id = a.professional_id
  JOIN tenants   t ON t.id = a.tenant_id
  JOIN whatsapp_instances wi ON wi.tenant_id = a.tenant_id AND wi.status = 'connected'
  WHERE a.id = $1
`

function buildMessage(row: any): string {
  const dt = new Date(row.starts_at)
  const data = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })
  const hora = dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  // Nunca chamar o cliente pelo número (cadastro automático usa o telefone como nome).
  const cliente = row.customer_name && row.customer_name !== row.customer_phone ? ` ${row.customer_name}` : ''
  const comProf = row.professional_name ? ` com ${row.professional_name}` : ''
  return `Olá${cliente}! ✅ Seu agendamento de *${row.service_name}* está confirmado para ${data} às ${hora}${comProf}. ` +
    `Qualquer imprevisto, é só nos avisar por aqui. — ${row.business_name}`
}

async function persistMessage(tenantId: string, appointmentId: string, content: string): Promise<void> {
  const { rows: [a] } = await db.query('SELECT customer_id FROM appointments WHERE id = $1', [appointmentId])
  const customerId = a?.customer_id
  if (!customerId) return
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

export async function sendAppointmentConfirmation(tenantId: string, appointmentId: string): Promise<void> {
  try {
    const { rows: [row] } = await db.query(QUERY, [appointmentId])
    if (!row || !row.customer_phone || row.source === 'quick_sale') return
    const message = buildMessage(row)
    await evolutionSend(row.instance_name, row.customer_phone, message)
    try { await persistMessage(tenantId, appointmentId, message) }
    catch (e: any) { console.error(`[confirmation] persist falhou appt=${appointmentId}:`, e?.message ?? e) }
  } catch (err: any) {
    console.error(`[confirmation] envio falhou appt=${appointmentId}:`, err?.message ?? err)
  }
}
