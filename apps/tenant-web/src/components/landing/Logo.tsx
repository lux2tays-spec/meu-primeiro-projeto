/**
 * Static brand lockup for the public landing page.
 * Server-safe (no hooks): each instance receives a unique gradient `id`
 * so multiple logos on the same page don't collide.
 */
export const LP_FONT = '"SF Pro Rounded","Arial Rounded MT Bold","Nunito",system-ui,sans-serif'

const BUBBLE_PATH =
  'M36 13 C22.7 13 12 22.8 12 34.9 C12 41.4 15 47.2 19.8 51.2 C19.4 54.7 18 58 15.8 60.7 C15.3 61.3 15.7 62.1 16.5 62 C21.7 61.4 26.5 59.4 30.5 56.4 C32.2 56.8 34.1 57 36 57 C49.3 57 60 47.2 60 34.9 C60 22.8 49.3 13 36 13 Z'
const CHECK_PATH = 'M24 35.5 L32 43.5 L52 19'

export function LogoMark({ size = 36, id }: { size?: number; id: string }) {
  const stroke = `url(#${id})`
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={id} x1="12" y1="13" x2="60" y2="62" gradientUnits="userSpaceOnUse">
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

export default function Logo({
  id,
  size = 34,
  className = '',
}: {
  /** Unique gradient id for this instance (e.g. "lp-grad-header"). */
  id: string
  size?: number
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <LogoMark size={size} id={id} />
      <span
        className="font-bold leading-none tracking-tight"
        style={{ fontFamily: LP_FONT, fontSize: Math.round(size * 0.62) }}
      >
        <span className="text-[#2CB86E]">Aí</span>
        <span className="text-[#1E3C66] dark:text-white">Confirma</span>
      </span>
    </span>
  )
}
