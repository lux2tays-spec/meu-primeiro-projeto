'use client'
import { createContext, useContext, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BASE_URL, brandingApi, type Branding, type BrandingAssetSlot } from '@/lib/api'

interface BrandingColors {
  primary: string
  primary_dark: string
  accent: string
  sidebar: string
}

interface BrandingContextValue {
  appName: string
  tagline: string
  assets: Branding['assets']
  colors: BrandingColors
  /** Absolute URL for an uploaded asset slot, or null when not uploaded. */
  logoUrl: (slot: BrandingAssetSlot) => string | null
}

const DEFAULT_COLORS: BrandingColors = {
  primary: '#2CB86E',
  primary_dark: '#1C9DAA',
  accent: '#1D62B5',
  sidebar: '#1E3C66',
}

const DEFAULTS: BrandingContextValue = {
  appName: 'AiConfirma',
  tagline: 'Agendamento Inteligente',
  assets: {},
  colors: DEFAULT_COLORS,
  logoUrl: () => null,
}

const BrandingContext = createContext<BrandingContextValue>(DEFAULTS)

export function useBranding() {
  return useContext(BrandingContext)
}

/** "#2CB86E" → "44 184 110" (space-separated RGB triplet for Tailwind alpha support). */
function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

function setBrandVar(root: HTMLElement, name: string, hex?: string) {
  if (!hex) return
  const rgb = hexToRgbTriplet(hex)
  if (!rgb) return // ignore malformed colors — keep the bundled default
  root.style.setProperty(`--brand-${name}`, hex)
  root.style.setProperty(`--brand-${name}-rgb`, rgb)
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  // Public endpoint; on any failure we silently keep the bundled defaults.
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: brandingApi.get,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (!data?.colors) return
    const root = document.documentElement
    setBrandVar(root, 'primary', data.colors.primary)
    setBrandVar(root, 'primary-dark', data.colors.primary_dark)
    setBrandVar(root, 'sidebar', data.colors.sidebar)
  }, [data])

  const value = useMemo<BrandingContextValue>(() => {
    const assets = data?.assets ?? {}
    return {
      appName: data?.app_name || DEFAULTS.appName,
      tagline: data?.tagline || DEFAULTS.tagline,
      assets,
      colors: { ...DEFAULT_COLORS, ...(data?.colors ?? {}) },
      logoUrl: (slot) => {
        const rel = assets[slot]
        return rel ? `${BASE_URL}${rel}` : null
      },
    }
  }, [data])

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}
