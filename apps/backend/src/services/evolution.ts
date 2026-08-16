import { getEvolutionConfig } from '../lib/integrationConfig'
import { redis } from '../lib/redis'

// Handoff button identifiers — kept here so the webhook and the sender agree.
export const HANDOFF_BUTTON_ID = 'handoff_specialist'
export const HANDOFF_BUTTON_LABEL = 'Quero ajuda de um especialista'
const SENT_MSG_TTL = 3600 // 1h — long enough to distinguish our echo from a manual reply

// Record a message id WE sent, so the webhook can tell an API echo (fromMe) apart
// from a manual reply typed by the business owner on their own phone.
async function rememberSentMessage(res: any): Promise<void> {
  const id = res?.key?.id
  if (id) { try { await redis.setex(`bot:sent:${id}`, SENT_MSG_TTL, '1') } catch { /* redis hiccup — non-fatal */ } }
}

/** True if this outgoing message id was sent by us (bot/system), not typed by a human. */
export async function wasSentByBot(messageId?: string): Promise<boolean> {
  if (!messageId) return false
  try { return (await redis.get(`bot:sent:${messageId}`)) !== null } catch { return false }
}

// URL and key are resolved per request via getEvolutionConfig() (Root Admin
// panel with env fallback) instead of frozen at module load.
async function evolutionRequest(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const { url, key } = await getEvolutionConfig()
  const res = await fetch(`${url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })

  const text = await res.text()
  let json: any
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    const msg = json?.response?.message?.[0] ?? json?.error ?? json?.message ?? `Evolution API error: ${res.status}`
    throw new Error(msg)
  }
  return json
}

export async function evolutionCreateInstance(instanceName: string, webhookUrl: string) {
  try {
    return await evolutionRequest('/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        url: webhookUrl,
        byEvents: false,   // all events to one URL; event type is in body.event
        base64: true,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    })
  } catch (err: any) {
    // If the instance already exists, that's fine — we'll just get a fresh QR
    const msg: string = err?.message ?? ''
    if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('exists')) {
      return null
    }
    throw err
  }
}

function extractQR(data: any): string | null {
  if (!data) return null
  // v2.3.x: { qrcode: { base64: "data:image/png;base64,..." } }
  if (data?.qrcode?.base64) return data.qrcode.base64
  // v2.x: { base64: "..." }
  if (data?.base64) return data.base64
  // fallback string
  if (typeof data?.qrcode === 'string') return data.qrcode
  return null
}

// Polls Evolution API until QR is available (max ~18s)
export async function evolutionGetQR(instanceName: string): Promise<{ qrcode: string } | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000))
    try {
      const data = await evolutionRequest(`/instance/connect/${instanceName}`)
      const qr = extractQR(data)
      if (qr) return { qrcode: qr }
    } catch {
      // not ready yet
    }
  }
  return null
}

export async function evolutionGetStatus(instanceName: string) {
  try {
    return await evolutionRequest(`/instance/connectionState/${instanceName}`)
  } catch {
    return { state: 'unknown' }
  }
}

// Discriminated connection state — distinguishes a definitive state ("open"/"close")
// from a transient Evolution error (so we never disconnect on a mere outage) and
// from an instance that no longer exists in Evolution.
export type ConnStateResult = { ok: true; state: string } | { ok: false; notFound: boolean }

export async function evolutionConnectionState(instanceName: string): Promise<ConnStateResult> {
  try {
    const data = await evolutionRequest(`/instance/connectionState/${instanceName}`)
    const state = data?.instance?.state ?? data?.state ?? 'unknown'
    return { ok: true, state }
  } catch (err: any) {
    const msg = String(err?.message ?? '').toLowerCase()
    const notFound = msg.includes('does not exist') || msg.includes('not found') ||
      (msg.includes('not') && msg.includes('exist'))
    return { ok: false, notFound }
  }
}

// Logout ends the WhatsApp session (unlinks the device) but keeps the instance.
export async function evolutionLogout(instanceName: string) {
  try {
    return await evolutionRequest(`/instance/logout/${instanceName}`, undefined, 'DELETE')
  } catch { /* ignore */ }
}

export async function evolutionSend(instanceName: string, to: string, text: string) {
  const res = await evolutionRequest(`/message/sendText/${instanceName}`, { number: to, text })
  await rememberSentMessage(res)
  return res
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Presence "digitando…" (best-effort — nem todo build/Baileys suporta; se falhar,
// seguimos com a pausa local, que já dá a sensação humana).
async function evolutionPresence(instanceName: string, to: string, ms: number) {
  try {
    await evolutionRequest(`/chat/sendPresence/${instanceName}`, { number: to, presence: 'composing', delay: ms })
  } catch { /* ignore */ }
}

// Quebra a resposta em bolhas (por parágrafo/linha em branco), no máx. 3 — nunca
// no meio de uma lista de horários (blocos sem linha em branco ficam juntos).
function splitBubbles(text: string): string[] {
  const parts = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return [text.trim()]
  if (parts.length <= 3) return parts
  return [parts[0], parts[1], parts.slice(2).join('\n\n')]
}

// Envia a resposta do bot como um HUMANO: em 1-3 bolhas, com "digitando…" e uma
// pausa proporcional ao tamanho antes de cada bolha (o maior "tell" de robô é a
// resposta longa instantânea em bloco único, a qualquer hora). Falha parcial é
// segura: se uma bolha falhar, paramos (não reenvia fora de ordem).
export async function evolutionSendHuman(instanceName: string, to: string, text: string) {
  const clean = (text || '').trim()
  if (!clean) return null
  const bubbles = splitBubbles(clean)
  let last: any = null
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i]
    // ~30ms/char, entre 0,6s e 2,2s por bolha (total ≤ ~7s no pior caso).
    const typingMs = Math.min(2200, Math.max(600, b.length * 30))
    await evolutionPresence(instanceName, to, typingMs)
    await sleep(typingMs)
    try {
      last = await evolutionRequest(`/message/sendText/${instanceName}`, { number: to, text: b })
      await rememberSentMessage(last)
    } catch (err) {
      console.error(`[evolution] falha ao enviar bolha ${i + 1}/${bubbles.length}:`, err)
      break // não reenvia fora de ordem
    }
    if (i < bubbles.length - 1) await sleep(280)
  }
  return last
}

// Offers a human handoff. Tries an interactive WhatsApp button; if the Evolution
// build / device doesn't support buttons (common with Baileys/QR connections),
// falls back to a plain-text prompt whose reply text is the SAME label, so the
// outcome (a clear "Quero ajuda de um especialista" the owner sees) is identical.
export async function evolutionSendSpecialistOffer(
  instanceName: string, to: string, question: string, buttonLabel: string = HANDOFF_BUTTON_LABEL
) {
  try {
    const res = await evolutionRequest(`/message/sendButtons/${instanceName}`, {
      number: to,
      title: '',
      description: question,
      footer: '',
      buttons: [{ type: 'reply', displayText: buttonLabel, id: HANDOFF_BUTTON_ID }],
    })
    await rememberSentMessage(res)
    return res
  } catch {
    // Fallback: plain text the customer can reply to by typing the label.
    return evolutionSend(instanceName, to, `${question}\n\nSe quiser, responda: *${buttonLabel}* 🙂`)
  }
}

// Fetches a media message (image/audio) as base64. Used when the webhook payload
// doesn't already carry the base64 (webhookBase64). Returns { base64, mimetype }
// or null on failure.
export async function evolutionGetMediaBase64(
  instanceName: string,
  messageKey: unknown
): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const res = await evolutionRequest(
      `/chat/getBase64FromMediaMessage/${instanceName}`,
      { message: { key: messageKey } }
    )
    const base64 = res?.base64 ?? res?.media ?? null
    if (!base64) return null
    return { base64, mimetype: res?.mimetype ?? res?.mimeType ?? '' }
  } catch (err) {
    console.error('[evolution] getBase64FromMediaMessage falhou:', err)
    return null
  }
}

export async function evolutionDeleteInstance(instanceName: string) {
  try {
    return await evolutionRequest(`/instance/delete/${instanceName}`, {}, 'DELETE')
  } catch { /* ignore */ }
}
