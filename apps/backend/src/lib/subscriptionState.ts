import { db } from './db'
import { notifyTenantManagers } from './notifications'

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

  // Estado anterior para detectar TRANSIÇÃO (evita avisar de novo a cada webhook).
  const { rows: [prev] } = await db.query('SELECT status FROM tenants WHERE id = $1', [params.tenantId])

  await db.query(
    `UPDATE tenants SET plan = $1, status = $2 WHERE id = $3`,
    [subStatus === 'authorized' ? params.plan : 'free', tenantStatus, params.tenantId]
  )

  // Suspensão por falha de cobrança (MP "paused") NÃO foi o dono que pediu — avisa
  // NA HORA (push/in-app/e-mail) para ele atualizar o pagamento antes de o
  // assistente parar. Cancelamento em geral é ação do próprio dono → não notifica.
  if (tenantStatus === 'suspended' && prev?.status !== 'suspended') {
    notifyTenantManagers(params.tenantId, {
      type: 'subscription',
      title: 'Pagamento não aprovado',
      body: 'Não conseguimos renovar sua assinatura e o serviço será suspenso em breve. Atualize seu pagamento para manter o assistente ativo.',
      link: '/settings/subscription',
      channelsOverride: ['inapp', 'push', 'email'],
    }).catch((e) => console.error('[subscription] falha ao notificar suspensão:', e))
  }
}
