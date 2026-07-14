import type { PaymentConfig } from '../lib/paymentConfig'

// Creates a Mercado Pago preapproval (recurring subscription) and returns the
// checkout URL. external_reference = `${tenantId}:${plan}` so the webhook can map
// the payment back to the tenant + plan (see routes/webhooks.ts).
//
// Two modes:
//  - TRANSPARENT (cardTokenId present): the card is tokenized client-side with the
//    platform public key; MP charges immediately and returns status 'authorized'.
//    No redirect and no Mercado Pago login for the payer.
//  - REDIRECT (no cardTokenId): MP returns an init_point the payer completes on
//    Mercado Pago's hosted page. Kept as a fallback.

export type PreapprovalResult =
  | { ok: true; id: string; status: string; init_point: string | null }
  | { ok: false; reason: string }

export async function createPreapproval(cfg: PaymentConfig, params: {
  tenantId: string
  plan: string
  planName: string
  priceBrl: number  // in reais (e.g. 49.00)
  payerEmail: string
  backUrl: string
  cardTokenId?: string
}): Promise<PreapprovalResult> {
  if (!cfg.mp_access_token) return { ok: false, reason: 'payment_not_configured' }

  const transparent = !!params.cardTokenId

  const body: Record<string, unknown> = {
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

  // Transparent flow: charge immediately with the tokenized card.
  if (transparent) {
    body.card_token_id = params.cardTokenId
    body.status = 'authorized'
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

  const status = (data as any).status as string | undefined
  const initPoint = (data as any).init_point || (data as any).sandbox_init_point || null

  // Redirect flow needs an init_point; transparent flow needs an authorized status.
  if (!transparent && !initPoint) return { ok: false, reason: 'no_init_point' }

  return { ok: true, id: (data as any).id, status: status ?? 'pending', init_point: initPoint }
}

export type CancelPreapprovalResult =
  | { ok: true }
  | { ok: false; reason: string }

// Cancels a preapproval on Mercado Pago. The caller is responsible for
// reflecting the cancellation locally (applyPreapproval) — the webhook will
// also confirm it idempotently. Never log the access token.
export async function cancelPreapproval(cfg: PaymentConfig, mpSubscriptionId: string): Promise<CancelPreapprovalResult> {
  if (!cfg.mp_access_token) return { ok: false, reason: 'payment_not_configured' }

  let res: Response
  try {
    res = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(mpSubscriptionId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.mp_access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'cancelled' }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'mp_timeout' : 'mp_network_error' }
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('MP preapproval cancel error:', res.status, data)
    return { ok: false, reason: (data as any)?.message || `mp_error_${res.status}` }
  }

  return { ok: true }
}
