export type UserRole = 'root' | 'owner' | 'admin' | 'staff'

export interface User {
  id: string
  name: string
  email: string
  phone: string | null
  created_at: string
}

export interface UserRole_ {
  user_id: string
  tenant_id: string
  role: UserRole
}

export interface JwtPayload {
  user_id: string
  tenant_id: string | null  // null for root users
  role: UserRole
  iat: number
  exp: number
}
