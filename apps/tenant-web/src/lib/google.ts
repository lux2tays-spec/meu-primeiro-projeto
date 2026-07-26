'use client'
import { useEffect, useState } from 'react'
import { BASE_URL } from './api'

// Single source of truth for the Google Sign-In "Web" client ID: the Root Admin
// config (Integrações → Google → Client ID), fetched at runtime from the public
// /google-client-id endpoint. So the platform owner changes it with no redeploy.
// NEXT_PUBLIC_GOOGLE_CLIENT_ID (if set) wins, for local dev.
export function useGoogleClientId(): string | null {
  const [id, setId] = useState<string | null>(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null)
  useEffect(() => {
    if (id) return
    let alive = true
    fetch(`${BASE_URL}/google-client-id`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.client_id) setId(d.client_id) })
      .catch(() => {})
    return () => { alive = false }
  }, [id])
  return id
}
