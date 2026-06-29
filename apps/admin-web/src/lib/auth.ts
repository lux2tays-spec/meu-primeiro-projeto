'use client'

export function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function isRootToken(token: string | null): boolean {
  if (!token) return false
  const p = parseJwt(token)
  if (!p) return false
  if (p.exp && p.exp * 1000 < Date.now()) return false
  return p.role === 'root'
}
