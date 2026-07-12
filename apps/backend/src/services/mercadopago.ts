import type { PaymentConfig } from '../lib/paymentConfig'

// Creates a Mercado Pago preapproval (recurring subscription) and returns the
// checkout URL. external_reference = `${tenantId}:${plan}` so the webhook can map
// the payment back to the tenant + plan (see routes/webhooks.ts).

export type PreapprovalResult =
  | { ok: true; id: string; init_point: string }
  | { ok: false; reason: string }

export async function createPreapproval(cfg: PaymentConfig, params: {
  tenantId: string
  plan: string
  planName: string
  priceBrl: number  // in reais (e.g. 49.00)
  payerEmail: string
  backUrl: string
}): Promise<PreapprovalResult> {
  if (!cfg.mp_access_token) return { ok: false, reason: 'payment_not_configured' }

  const body = {
    reason: `AgendaBot — Plano ${params.planName}`,
    external_reference: `${params.tenantId}:${params.plan}`,
    payer_email: params.payerEmail,
    back_url: params.backUrl,
    auto_recurring: {
      frequency: 1,
      frequency_type: 'months',
      transaction_amount: Number(params.priceBrl.toFixed(2)),
      currency_id: 'BRL',
    },
  }

  const res = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.mp_access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('MP preapproval error:', res.status, data)
    return { ok: false, reason: (data as any)?.message || `mp_error_${res.status}` }
  }
  const initPoint = (data as any).init_point || (data as any).sandbox_init_point
  if (!initPoint) return { ok: false, reason: 'no_init_point' }
  return { ok: true, id: (data as any).id, init_point: initPoint }
}
