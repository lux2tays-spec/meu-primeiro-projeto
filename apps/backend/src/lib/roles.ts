import { db } from './db'

// Role helpers for tenant-scoped routes. JWT payload: { tenant_id, user_id, role }.

type JwtUser = {
  user_id: string
  tenant_id: string | null
  role: 'root' | 'owner' | 'admin' | 'staff'
}

export function isStaff(user: JwtUser): boolean {
  return user.role === 'staff'
}

/** Owners and admins manage the tenant (e.g. can pay commissions). */
export function canManage(user: JwtUser): boolean {
  return user.role === 'owner' || user.role === 'admin'
}

/**
 * For a 'staff' user, resolves the professional record linked to their user
 * account (professionals.user_id). Returns:
 * - the professional id → staff may only see THAT professional's data;
 * - null for staff with no linked professional (caller should return empty);
 * - null for owner/admin/root, meaning "no restriction".
 * Use isStaff() to distinguish the two null meanings.
 */
export async function resolveStaffProfessionalId(user: JwtUser): Promise<string | null> {
  if (user.role !== 'staff') return null
  const { rows: [prof] } = await db.query(
    `SELECT id FROM professionals WHERE tenant_id = $1 AND user_id = $2`,
    [user.tenant_id, user.user_id]
  )
  return prof?.id ?? null
}
