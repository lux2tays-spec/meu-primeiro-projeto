import { createContext, useContext, useMemo, ReactNode } from 'react'
import { useBrandingStore } from './branding'
import { colors as baseColors } from './theme'

/**
 * Tema dinâmico (white-label): espelha o BrandingProvider da web (CSS vars).
 * A cor primária vem de /branding (branding.colors.primary) e é aplicada em
 * runtime nos componentes que consomem `useTheme()`. Sem cor custom (ou cor
 * inválida), cai no verde padrão de `lib/theme.ts` — nunca quebra a UI.
 */
export interface ThemeColors {
  primary: string
  primaryDark: string
  /** Fundo suave derivado da primária (chips, avatares, cards de destaque). */
  primaryLight: string
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function safeHex(v: string | undefined, fallback: string): string {
  const t = (v ?? '').trim()
  return HEX_RE.test(t) ? t : fallback
}

/** #RGB → #RRGGBB (RN aceita ambos, mas normalizamos para derivar variantes). */
function expandHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return hex
}

/** Tinta clara (~12% de opacidade) da cor primária — equivalente ao primaryLight. */
function toLightTint(hex: string): string {
  return `${expandHex(hex)}1F`
}

const DEFAULT_THEME: ThemeColors = {
  primary: baseColors.primary,
  primaryDark: baseColors.primaryDark,
  primaryLight: baseColors.primaryLight,
}

const ThemeContext = createContext<ThemeColors>(DEFAULT_THEME)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const brand = useBrandingStore((s) => s.colors)

  const value = useMemo<ThemeColors>(() => {
    const primary = safeHex(brand?.primary, baseColors.primary)
    const isCustom = primary.toLowerCase() !== baseColors.primary.toLowerCase()
    if (!isCustom) return DEFAULT_THEME
    return {
      primary,
      // Sem primary_dark custom, a própria primária serve de tom escuro.
      primaryDark: safeHex(brand?.primary_dark, primary),
      primaryLight: toLightTint(primary),
    }
  }, [brand?.primary, brand?.primary_dark])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Cores de marca do tenant em runtime (fallback: verde padrão do app). */
export function useTheme(): ThemeColors {
  return useContext(ThemeContext)
}
