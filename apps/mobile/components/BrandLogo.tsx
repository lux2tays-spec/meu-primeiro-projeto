import { View, Text, Image, StyleSheet } from 'react-native'
import Svg, { Defs, LinearGradient, Stop, Path } from 'react-native-svg'
import { useBrandingStore, resolveAssetUrl } from '@/lib/branding'
import { colors, font, spacing } from '@/lib/theme'

// AíConfirma brand constants (bundled fallback — no network needed)
const BRAND_GREEN = '#2CB86E'
const BRAND_TEAL = '#1C9DAA'
const BRAND_BLUE = '#1D62B5'
const BRAND_NAVY = '#1E3C66'

const BUBBLE_PATH =
  'M36 13 C22.7 13 12 22.8 12 34.9 C12 41.4 15 47.2 19.8 51.2 C19.4 54.7 18 58 15.8 60.7 C15.3 61.3 15.7 62.1 16.5 62 C21.7 61.4 26.5 59.4 30.5 56.4 C32.2 56.8 34.1 57 36 57 C49.3 57 60 47.2 60 34.9 C60 22.8 49.3 13 36 13 Z'
const CHECK_PATH = 'M24 35.5 L32 43.5 L52 19'

interface BrandLogoProps {
  variant?: 'full' | 'mark'
  size?: number
}

/** Bundled gradient SVG mark: chat bubble + check (green → teal → blue). */
function BrandMark({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72">
      <Defs>
        <LinearGradient id="brandGradient" x1="0" y1="0" x2="72" y2="72" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={BRAND_GREEN} />
          <Stop offset="0.5" stopColor={BRAND_TEAL} />
          <Stop offset="1" stopColor={BRAND_BLUE} />
        </LinearGradient>
      </Defs>
      <Path
        d={BUBBLE_PATH}
        fill="none"
        stroke="url(#brandGradient)"
        strokeWidth={5.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d={CHECK_PATH}
        fill="none"
        stroke="url(#brandGradient)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

/** Two-tone wordmark: "Aí" green + "Confirma" navy. Custom names render single-tone. */
function Wordmark({ appName }: { appName: string }) {
  const isDefaultName = /^a[ií]confirma$/i.test(appName.replace(/\s+/g, ''))
  if (isDefaultName) {
    return (
      <Text style={styles.wordmark}>
        <Text style={styles.wordmarkAccent}>Aí</Text>
        <Text style={styles.wordmarkBase}>Confirma</Text>
      </Text>
    )
  }
  return (
    <Text style={styles.wordmark}>
      <Text style={styles.wordmarkBase}>{appName}</Text>
    </Text>
  )
}

export function BrandLogo({ variant = 'mark', size = 56 }: BrandLogoProps) {
  const appName = useBrandingStore((s) => s.appName)
  const tagline = useBrandingStore((s) => s.tagline)
  const logoAsset = useBrandingStore((s) => s.assets.logo)
  const logoUri = resolveAssetUrl(logoAsset)

  const mark = logoUri ? (
    <Image
      source={{ uri: logoUri }}
      style={variant === 'full' ? { width: size * 3, height: size } : { width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel={appName}
    />
  ) : (
    <BrandMark size={size} />
  )

  if (variant === 'mark') {
    return <View style={styles.markContainer}>{mark}</View>
  }

  return (
    <View style={styles.fullContainer}>
      {mark}
      {/* When a custom uploaded logo exists it usually already carries the
          wordmark — skip the text to avoid duplicating the name. */}
      {!logoUri && <Wordmark appName={appName} />}
      {!!tagline && <Text style={styles.tagline}>{tagline}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  markContainer: { alignItems: 'center', justifyContent: 'center' },
  fullContainer: { alignItems: 'center', gap: spacing.sm },
  wordmark: { fontSize: font.title, fontWeight: '800' },
  wordmarkAccent: { color: BRAND_GREEN },
  wordmarkBase: { color: BRAND_NAVY },
  tagline: { fontSize: font.md, color: colors.textSecondary, textAlign: 'center' },
})
