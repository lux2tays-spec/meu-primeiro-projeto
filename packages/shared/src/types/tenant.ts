export type Plan = 'free' | 'basico' | 'premium' | 'profissional'
export type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled'

export interface Tenant {
  id: string
  name: string
  slug: string
  plan: Plan
  status: TenantStatus
  trial_ends_at: string | null
  max_agendas: number
  max_users: number
  created_at: string
}

export const PLAN_LIMITS: Record<Plan, { max_agendas: number; max_users: number }> = {
  free:           { max_agendas: 1,  max_users: 1  },
  basico:         { max_agendas: 1,  max_users: 1  },
  premium:        { max_agendas: 3,  max_users: 3  },
  profissional:   { max_agendas: 10, max_users: 10 },
}
