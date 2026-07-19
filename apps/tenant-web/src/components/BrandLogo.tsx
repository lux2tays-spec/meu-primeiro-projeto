'use client'
import { useId } from 'react'
import { useBranding } from './BrandingProvider'

const ROUNDED_FONT_STACK = '"SF Pro Rounded","Arial Rounded MT Bold","Nunito",system-ui,sans-serif'

const BUBBLE_PATH =
  'M36 13 C22.7 13 12 22.8 12 34.9 C12 41.4 15 47.2 19.8 51.2 C19.4 54.7 18 58 15.8 60.7 C15.3 61.3 15.7 62.1 16.5 62 C21.7 61.4 26.5 59.4 30.5 56.4 C32.2 56.8 34.1 57 36 57 C49.3 57 60 47.2 60 34.9 C60 22.8 49.3 13 36 13 Z'
const CHECK_PATH = 'M24 35.5 L32 43.5 L52 19'

interface BrandLogoProps {
  variant?: 'full' | 'mark'
  /** Height of the mark (or uploaded logo) in px. */
  size?: number
  /** Use on dark backgrounds (sidebar/auth): light wordmark + logo_dark asset. */
  dark?: boolean
  className?: string
}

function Mark({ size, gradientId }: { size: number; gradientId: string }) {
  const stroke = `url(#${gradientId})`
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={gradientId} x1="12" y1="13" x2="60" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2CB86E" />
          <stop offset="0.5" stopColor="#1C9DAA" />
          <stop offset="1" stopColor="#1D62B5" />
        </linearGradient>
      </defs>
      <path d={BUBBLE_PATH} stroke={stroke} strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={CHECK_PATH} stroke={stroke} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function BrandLogo({ variant = 'full', size, dark = false, className = '' }: BrandLogoProps) {
  const { appName, tagline, logoUrl } = useBranding()
  // Unique gradient id per instance so multiple logos on a page don't collide.
  const gradientId = `brand-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const markSize = size ?? (variant === 'mark' ? 40 : 56)

  // Uploaded logo (runtime branding) wins over the bundled SVG lockup.
  const uploaded = (dark ? logoUrl('logo_dark') : null) ?? logoUrl('logo')
  if (uploaded) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={uploaded}
        alt={appName}
        style={{ height: markSize }}
        className={`w-auto ${variant === 'full' ? 'mx-auto' : ''} ${className}`.trim()}
      />
    )
  }

  if (variant === 'mark') {
    return (
      <span className={`inline-flex ${className}`.trim()}>
        <Mark size={markSize} gradientId={gradientId} />
      </span>
    )
  }

  // Wordmark: "Aí" green + rest navy (white on dark). Falls back to the full
  // app name in a single color when it doesn't start with "Aí"/"Ai".
  const displayName = appName === 'AiConfirma' ? 'AíConfirma' : appName
  const split = /^([AaÁá][IiÍí])(.+)$/.exec(displayName)
  const restColor = dark ? '#FFFFFF' : '#1E3C66'

  return (
    <div className={`inline-flex flex-col items-center ${className}`.trim()}>
      <Mark size={markSize} gradientId={gradientId} />
      <p
        className="mt-2 font-bold leading-tight"
        style={{ fontFamily: ROUNDED_FONT_STACK, fontSize: Math.round(markSize * 0.46) }}
      >
        {split ? (
          <>
            <span style={{ color: '#2CB86E' }}>{split[1]}</span>
            <span style={{ color: restColor }}>{split[2]}</span>
          </>
        ) : (
          <span style={{ color: restColor }}>{displayName}</span>
        )}
      </p>
      <p
        className={`mt-0.5 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}
        style={{ fontFamily: ROUNDED_FONT_STACK }}
      >
        {tagline}
      </p>
    </div>
  )
}
