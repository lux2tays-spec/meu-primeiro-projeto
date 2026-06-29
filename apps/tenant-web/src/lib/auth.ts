'use client'

export function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function isTenantToken(token: string | null): boolean {
  if (!token) return false
  const p = parseJwt(token)
  if (!p) return false
  if (p.exp && p.exp * 1000 < Date.now()) return false
  return ['owner', 'admin', 'staff'].includes(p.role)
}

export function getTokenPayload(token: string | null) {
  if (!token) return null
  return parseJwt(token)
}
