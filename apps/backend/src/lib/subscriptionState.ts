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
}): Promise<void> {
  const subStatus = (MP_STATUSES as readonly string[]).includes(params.mpStatus) ? params.mpStatus : 'pending'
  const tenantStatus =
    subStatus === 'authorized' ? 'active' :
    subStatus === 'cancelled' ? 'cancelled' :
    subStatus === 'paused' ? 'suspended' :
    'trial'

  // Idempotent upsert by mp_subscription_id.
  await db.query(
    `INSERT INTO subscriptions (tenant_id, mp_subscription_id, plan, status, next_billing_date)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (mp_subscription_id) DO UPDATE SET
       status = EXCLUDED.status, plan = EXCLUDED.plan, next_billing_date = EXCLUDED.next_billing_date`,
    [params.tenantId, params.mpSubscriptionId, params.plan, subStatus, params.nextBillingDate ?? null]
  )

  await db.query(
    `UPDATE tenants SET plan = $1, status = $2 WHERE id = $3`,
    [subStatus === 'authorized' ? params.plan : 'free', tenantStatus, params.tenantId]
  )
}
