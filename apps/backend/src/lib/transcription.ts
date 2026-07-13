import { getAiConfig } from './botConfig'

// Speech-to-text for WhatsApp voice notes. Uses an OpenAI-compatible Whisper
// endpoint (OpenAI or Groq), configured in Root Admin → IA & Custos. Returns the
// transcript, or null when transcription isn't configured / fails (the caller
// then falls back to asking the customer to type).

const PROVIDERS: Record<string, { url: string; model: string }> = {
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1' },
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3' },
}

export async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  const cfg = await getAiConfig()
  const provider = PROVIDERS[cfg.transcription_provider]
  if (!provider || !cfg.transcription_api_key) return null

  try {
    const buf = Buffer.from(base64, 'base64')
    // WhatsApp voice notes are usually audio/ogg (opus). Whisper accepts ogg.
    const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
      : mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3'
      : 'ogg'

    const form = new FormData()
    form.append('file', new Blob([buf], { type: mimeType || 'audio/ogg' }), `audio.${ext}`)
    form.append('model', provider.model)
    form.append('language', 'pt')

    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.transcription_api_key}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      console.error('[transcription] provider error', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = await res.json().catch(() => null) as any
    const text = data?.text?.trim()
    return text || null
  } catch (err) {
    console.error('[transcription] falhou:', err)
    return null
  }
}
