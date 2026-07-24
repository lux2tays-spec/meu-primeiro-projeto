import { db } from '../lib/db'
import { redis } from '../lib/redis'
import { runBot } from './bot'
import { evolutionSend, evolutionSendSpecialistOffer } from './evolution'
import { getHandoffConfig } from '../lib/handoffConfig'
import { getBotConfig } from '../lib/botConfig'

// Message de-duplication + per-conversation debounce.
//
// - dedup: Evolution re-delivers webhooks; we SETNX the message id so the same
//   message is never processed twice (no duplicate replies, no double AI cost).
// - debounce: rapid consecutive messages from the same customer are buffered and
//   answered ONCE after a short quiet window — more human, and it also absorbs
//   any retry that slipped past dedup. Single backend instance, so an in-process
//   timer map is sufficient; the buffer lives in Redis so nothing is lost mid-window.

// Operational limits (dedup TTL, rate limit, debounce) come from bot_config
// (Root Admin, cached 60s). The rate-limit window stays at 1h — the limit is
// defined as "per hour".
const SENDER_RATE_WINDOW = 60 * 60 // 1h

const timers = new Map<string, NodeJS.Timeout>()

export type BotImage = { base64: string; mediaType: string }

export type DispatchCtx = {
  tenantId: string
  conversationId: string
  customerId: string
  customerName: string
  customerLastName?: string | null
  customerPhone: string
  instanceId: string
  image?: BotImage
}

const latestCtx = new Map<string, DispatchCtx>()

/** Returns true if this message id was already seen (and should be ignored). */
export async function isDuplicateMessage(messageId?: string): Promise<boolean> {
  if (!messageId) return false
  const { dedup_ttl_seconds } = await getBotConfig()
  const set = await redis.set(`bot:msg:${messageId}`, '1', 'EX', dedup_ttl_seconds, 'NX')
  return set === null
}

/**
 * Per-sender rate limit: true when this customer phone already triggered too
 * many bot runs for this tenant in the last hour — the caller must DROP the
 * message silently (no bot run, no reply). Logged once, on crossing the limit.
 */
export async function isSenderRateLimited(tenantId: string, customerPhone: string): Promise<boolean> {
  const { sender_rate_limit } = await getBotConfig()
  const key = `bot:rl:${tenantId}:${customerPhone}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, SENDER_RATE_WINDOW)
  if (count === sender_rate_limit + 1) {
    console.warn(`[bot] rate-limit: tenant=${tenantId} phone=${customerPhone} passou de ${sender_rate_limit} mensagens/hora — descartando em silêncio`)
  }
  return count > sender_rate_limit
}

/** Buffer an incoming message and (re)start the debounce window. */
export async function scheduleReply(ctx: DispatchCtx, text: string, image?: BotImage): Promise<void> {
  await redis.rpush(`bot:buf:${ctx.conversationId}`, text)
  await redis.expire(`bot:buf:${ctx.conversationId}`, 600)
  // Preserve an image from an earlier message in the same debounce window if the
  // newest message doesn't carry one.
  const prev = latestCtx.get(ctx.conversationId)
  latestCtx.set(ctx.conversationId, { ...ctx, image: image ?? prev?.image })

  const { debounce_ms } = await getBotConfig()
  const existing = timers.get(ctx.conversationId)
  if (existing) clearTimeout(existing)
  timers.set(
    ctx.conversationId,
    setTimeout(() => { flush(ctx.conversationId).catch((e) => console.error('bot flush error:', e)) }, debounce_ms)
  )
}

async function flush(conversationId: string): Promise<void> {
  timers.delete(conversationId)
  const ctx = latestCtx.get(conversationId)
  latestCtx.delete(conversationId)
  if (!ctx) return

  const parts = await redis.lrange(`bot:buf:${conversationId}`, 0, -1)
  await redis.del(`bot:buf:${conversationId}`)
  if (!parts.length) return
  const combined = parts.join('\n')

  // Run the bot first; only persist once we have a reply so a failure doesn't
  // leave a half-conversation (matches prior behaviour).
  const reply = await runBot({
    tenantId: ctx.tenantId,
    conversationId,
    customerMessage: combined,
    customerId: ctx.customerId,
    customerName: ctx.customerName,
    customerLastName: ctx.customerLastName,
    customerPhone: ctx.customerPhone,
    image: ctx.image,
  })

  // Escalation: the bot decided it can't resolve — send the tenant's configured
  // "specialist?" prompt (interactive button, with a plain-text fallback) instead
  // of a normal reply. The bot pauses only AFTER the customer confirms (webhook).
  // If handoff is DISABLED for this tenant, the button would be dead (its click
  // does nothing) — send a graceful text instead of offering a broken flow.
  const cfg = reply.offerSpecialist ? await getHandoffConfig(ctx.tenantId) : null
  const offerHandoff = !!cfg?.enabled
  const outgoing = cfg
    ? (offerHandoff ? cfg.offer_message : 'Vou verificar isso com a equipe e já te retorno 🙂')
    : reply.text

  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [ctx.tenantId, conversationId, 'user', combined]
  )
  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [ctx.tenantId, conversationId, 'assistant', outgoing]
  )

  if (cfg && offerHandoff) {
    await evolutionSendSpecialistOffer(ctx.instanceId, ctx.customerPhone, cfg.offer_message, cfg.button_label)
  } else {
    await evolutionSend(ctx.instanceId, ctx.customerPhone, outgoing)
  }
}
