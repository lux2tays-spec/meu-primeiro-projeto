// Guards for inbound WhatsApp media: size ceilings + mime-type allowlists so
// oversized or unexpected files are rejected BEFORE any Claude/Whisper cost.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024 // 12 MB

// The only image types Claude's vision API supports.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

const ALLOWED_AUDIO_TYPES = [
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/amr', 'audio/wav', 'audio/aac',
] as const

/** Approximate decoded byte size of a raw (headerless) base64 payload. */
export function base64Bytes(rawB64: string): number {
  return Math.floor(rawB64.length * 3 / 4)
}

/**
 * Normalizes an image mime type (may carry parameters, e.g. "image/jpeg; q=x")
 * to the canonical Claude-supported type. Returns null when not allowed.
 */
export function normalizeImageType(mediaType: string | undefined): string | null {
  const mt = (mediaType || '').toLowerCase().trim()
  for (const allowed of ALLOWED_IMAGE_TYPES) {
    if (mt.startsWith(allowed)) return allowed
  }
  // Common alias: "image/jpg" is really jpeg — safe to coerce.
  if (mt.startsWith('image/jpg')) return 'image/jpeg'
  return null
}

/** True when the audio mime type is one we accept for transcription. */
export function isAllowedAudioType(mediaType: string | undefined): boolean {
  const mt = (mediaType || '').toLowerCase().trim()
  return ALLOWED_AUDIO_TYPES.some((allowed) => mt.startsWith(allowed))
}
