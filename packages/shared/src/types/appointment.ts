export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled'

export interface Service {
  id: string
  tenant_id: string
  name: string
  description: string | null
  duration_minutes: number
  price: number
  active: boolean
}

export interface Professional {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  bio: string | null
  active: boolean
}

export interface Appointment {
  id: string
  tenant_id: string
  customer_id: string
  professional_id: string
  service_id: string
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  notes: string | null
  created_at: string
}

export interface Customer {
  id: string
  tenant_id: string
  name: string
  phone: string       // WhatsApp number
  email: string | null
  created_at: string
}
