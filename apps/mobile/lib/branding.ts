import { create } from 'zustand'
import { brandingApi, BASE_URL } from './api'

export interface BrandingColors {
  primary?: string
  primary_dark?: string
  accent?: string
  sidebar?: string
}

export interface BrandingAssets {
  logo?: string
  logo_dark?: string
  favicon?: string
  icon?: string
}

interface BrandingState {
  appName: string
  tagline: string
  colors: BrandingColors
  assets: BrandingAssets
  loaded: boolean
  loadBranding: () => Promise<void>
}

// Bundled fallback — used when the backend is unreachable or returns garbage.
const DEFAULT_APP_NAME = 'AiConfirma'
const DEFAULT_TAGLINE = 'Agendamento Inteligente'

/** Resolves a backend-relative asset path (e.g. "/uploads/logo.png") to an absolute URL. */
export function resolveAssetUrl(path?: string | null): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  return `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`
}

export const useBrandingStore = create<BrandingState>((set) => ({
  appName: DEFAULT_APP_NAME,
  tagline: DEFAULT_TAGLINE,
  colors: {},
  assets: {},
  loaded: false,

  // Best-effort runtime branding: on ANY failure we silently keep the bundled
  // defaults (green palette + SVG logo + 'AiConfirma'). Never throws.
  loadBranding: async () => {
    try {
      const b = await brandingApi.get()
      set({
        appName: (b?.app_name ?? '').trim() || DEFAULT_APP_NAME,
        tagline: (b?.tagline ?? '').trim() || DEFAULT_TAGLINE,
        colors: b?.colors ?? {},
        assets: {
          logo: b?.assets?.logo ?? undefined,
          logo_dark: b?.assets?.logo_dark ?? undefined,
          favicon: b?.assets?.favicon ?? undefined,
          icon: b?.assets?.icon ?? undefined,
        },
      })
    } catch {
      // Keep bundled defaults — branding must never break app startup.
    } finally {
      set({ loaded: true })
    }
  },
}))
