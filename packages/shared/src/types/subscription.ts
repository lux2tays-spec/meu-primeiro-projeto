export type SubscriptionStatus = 'authorized' | 'paused' | 'cancelled' | 'pending'

export interface Subscription {
  id: string
  tenant_id: string
  mp_subscription_id: string    // Mercado Pago ID
  plan: string
  status: SubscriptionStatus
  next_billing_date: string
  created_at: string
}

export interface Affiliate {
  id: string
  user_id: string
  referral_code: string
  total_referrals: number
  pending_earnings: number      // BRL cents
  paid_earnings: number
  created_at: string
}
