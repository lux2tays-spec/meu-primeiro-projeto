import { db } from './db'

// Single source of truth for turning a Mercado Pago preapproval status into our
// subscriptions row + tenant plan/status. Used by BOTH the transparent checkout
// (immediate activation) and the webhook (idempotent, MP-verified). Keeping the
// mapping here guarantees the two paths never diverge.

const MP_STATUSES = ['authorized', 'paused', 'cancelled', 'pending'] as const

export async function applyPreapproval(params: {
  tenantId: string
  plan: string
  mpSubscriptionId: string
  mpStatus: string
  nextBillingDate?: string | null
  billingPeriod?: 'monthly' | 'annual'
}): Promise<void> {
  const subStatus = (MP_STATUSES as readonly string[]).includes(params.mpStatus) ? params.mpStatus : 'pending'
  const tenantStatus =
    subStatus === 'authorized' ? 'active' :
    subStatus === 'cancelled' ? 'cancelled' :
    subStatus === 'paused' ? 'suspended' :
    'trial'

  // Idempotent upsert by mp_subscription_id. billing_period só é sobrescrito
  // quando informado (o webhook não sabe o período; o checkout sim).
  await db.query(
    `INSERT INTO subscriptions (tenant_id, mp_subscription_id, plan, status, next_billing_date, billing_period)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'monthly'))
     ON CONFLICT (mp_subscription_id) DO UPDATE SET
       status = EXCLUDED.status, plan = EXCLUDED.plan, next_billing_date = EXCLUDED.next_billing_date,
       billing_period = COALESCE($6, subscriptions.billing_period)`,
    [params.tenantId, params.mpSubscriptionId, params.plan, subStatus, params.nextBillingDate ?? null, params.billingPeriod ?? null]
  )

  await db.query(
    `UPDATE tenants SET plan = $1, status = $2 WHERE id = $3`,
    [subStatus === 'authorized' ? params.plan : 'free', tenantStatus, params.tenantId]
  )
}
