import { db } from '../lib/db'
import { decrypt } from '../lib/crypto'
import { evolutionSend } from './evolution'

// #3 — Pagamentos de CLIENTES do tenant (cobrança de vendas via link do Mercado
// Pago). Usa a conta MP do PRÓPRIO tenant (tenants.mp_access_token). Diferente da
// assinatura da plataforma (getPaymentConfig), que é a conta MP da plataforma.

const publicApiBase = () =>
  (process.env.WEBHOOK_BASE_URL ?? process.env.BACKEND_URL ?? '').replace(/\/$/, '')
const tenantWebBase = () => (process.env.TENANT_WEB_URL ?? '').replace(/\/$/, '')

export type PreferenceResult =
  | { ok: true; id: string; url: string }
  | { ok: false; reason: string }

/**
 * Cria uma preferência de checkout na conta MP do tenant, amarrada a uma venda
 * (external_reference) e com notification_url para o webhook por tenant marcar
 * como pago automaticamente.
 */
export async function createSalePreference(tenantId: string, params: {
  appointmentId: string
  title: string
  amount: number
  notifyBase?: string  // base pública da API (derivada da requisição); tem prioridade sobre a env
}): Promise<PreferenceResult> {
  const { rows: [t] } = await db.query('SELECT mp_access_token FROM tenants WHERE id = $1', [tenantId])
  if (!t?.mp_access_token) return { ok: false, reason: 'mp_not_configured' }

  let token: string
  try { token = decrypt(t.mp_access_token) } catch { return { ok: false, reason: 'mp_token_invalid' } }

  // notification_url: usa a base derivada da requisição (robusto, sem depender de
  // env) e, se não vier, cai na env WEBHOOK_BASE_URL/BACKEND_URL.
  const apiBase = (params.notifyBase || publicApiBase() || '').replace(/\/$/, '')
  const webBase = tenantWebBase()
  const body: Record<string, unknown> = {
    items: [{ title: params.title, quantity: 1, currency_id: 'BRL', unit_price: Number(params.amount.toFixed(2)) }],
    external_reference: `venda:${params.appointmentId}`,
    ...(webBase ? { back_urls: { success: `${webBase}/financeiro`, failure: `${webBase}/financeiro` } } : {}),
    ...(apiBase ? { notification_url: `${apiBase}/webhook/mp-tenant/${tenantId}` } : {}),
  }

  try {
    const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[tenantPayments] preference error', res.status, data)
      return { ok: false, reason: (data as any)?.message || `mp_error_${res.status}` }
    }
    const url = (data as any).init_point || (data as any).sandbox_init_point
    if (!url) return { ok: false, reason: 'no_init_point' }
    return { ok: true, id: (data as any).id, url }
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'TimeoutError' ? 'mp_timeout' : 'mp_network_error' }
  }
}

/** Envia o link de pagamento no WhatsApp do cliente (se houver instância conectada). */
export async function sendPaymentLinkWhatsApp(tenantId: string, customerId: string, link: string, title: string, amount: number): Promise<boolean> {
  const { rows: [row] } = await db.query(
    `SELECT c.name AS customer_name, c.phone AS customer_phone, t.name AS business_name, wi.instance_name
     FROM customers c
     JOIN tenants t ON t.id = c.tenant_id
     JOIN whatsapp_instances wi ON wi.tenant_id = c.tenant_id AND wi.status = 'connected'
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [customerId, tenantId]
  )
  if (!row?.customer_phone) return false
  const cliente = row.customer_name && row.customer_name !== row.customer_phone ? ` ${row.customer_name}` : ''
  const valor = Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const msg = `Olá${cliente}! 💳 Segue o link para pagamento de *${title}* (${valor}):\n${link}\n\nAssim que o pagamento for confirmado, está tudo certo. — ${row.business_name}`
  try {
    await evolutionSend(row.instance_name, row.customer_phone, msg)
    // Registra na conversa (histórico + contexto do bot).
    const { rows: [conv] } = await db.query(
      `INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
      [tenantId, customerId]
    )
    const conversationId = conv?.id ?? (
      await db.query('SELECT id FROM conversations WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId])
    ).rows[0]?.id
    if (conversationId) {
      await db.query('INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)', [tenantId, conversationId, 'assistant', msg])
    }
    return true
  } catch (e: any) {
    console.error('[tenantPayments] sendPaymentLinkWhatsApp falhou:', e?.message ?? e)
    return false
  }
}

/**
 * Marca uma venda (appointment) como paga a partir de um pagamento aprovado no
 * MP do tenant. Idempotente. Retorna true se marcou/estava paga.
 */
export async function markSalePaid(tenantId: string, appointmentId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE appointments
       SET status = 'completed', payment_status = 'paid',
           price_snapshot = COALESCE(price_snapshot, (SELECT s.price FROM services s WHERE s.id = appointments.service_id))
     WHERE id = $1 AND tenant_id = $2 AND source = 'quick_sale'`,
    [appointmentId, tenantId]
  )
  return (rowCount ?? 0) > 0
}
