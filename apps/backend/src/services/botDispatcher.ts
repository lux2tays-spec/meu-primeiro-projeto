import { db } from '../lib/db'
import { redis } from '../lib/redis'
import { runBot, logBotError } from './bot'
import { evolutionSend, evolutionSendHuman, evolutionSendSpecialistOffer } from './evolution'
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
//   The minimal dispatch ctx is persisted alongside the buffer (bot:bufctx:*) so a
//   restart/deploy mid-debounce can resume pending flushes (resumePendingBotFlushes,
//   called at boot) instead of dropping the customer's messages.

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

// Buffer + persisted ctx share the same 10-min TTL. The ctx key deliberately
// does NOT match the `bot:buf:*` scan pattern (no trailing colon after "bufctx").
const BUFFER_TTL_SECONDS = 600
const bufCtxKey = (conversationId: string) => `bot:bufctx:${conversationId}`

/** Returns true if this message id was already seen (and should be ignored). */
export async function isDuplicateMessage(messageId?: string): Promise<boolean> {
  if (!messageId) return false
  const { dedup_ttl_seconds } = await getBotConfig()
  const set = await redis.set(`bot:msg:${messageId}`, '1', 'EX', dedup_ttl_seconds, 'NX')
  return set === null
}

/**
 * Per-sender rate limit, counted ONCE per bot EXECUTION (called from flush) —
 * not per received message, so a burst grouped by the debounce costs 1, not N.
 * When limited the caller must still PERSIST the customer's message (owner
 * visibility) and send a single notice on `justCrossed` — never drop silently.
 */
async function consumeSenderRateLimit(
  tenantId: string,
  customerPhone: string
): Promise<{ limited: boolean; justCrossed: boolean }> {
  const { sender_rate_limit } = await getBotConfig()
  const key = `bot:rl:${tenantId}:${customerPhone}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, SENDER_RATE_WINDOW)
  const justCrossed = count === sender_rate_limit + 1
  if (justCrossed) {
    console.warn(`[bot] rate-limit: tenant=${tenantId} phone=${customerPhone} passou de ${sender_rate_limit} execuções do bot/hora — pausando respostas (mensagens seguem registradas)`)
  }
  return { limited: count > sender_rate_limit, justCrossed }
}

/** Buffer an incoming message and (re)start the debounce window. */
export async function scheduleReply(ctx: DispatchCtx, text: string, image?: BotImage): Promise<void> {
  await redis.rpush(`bot:buf:${ctx.conversationId}`, text)
  await redis.expire(`bot:buf:${ctx.conversationId}`, BUFFER_TTL_SECONDS)
  // Preserve an image from an earlier message in the same debounce window if the
  // newest message doesn't carry one.
  const prev = latestCtx.get(ctx.conversationId)
  const merged: DispatchCtx = { ...ctx, image: image ?? prev?.image }
  latestCtx.set(ctx.conversationId, merged)

  // Persist the minimal ctx next to the buffer (WITHOUT the image — base64 is
  // too heavy for Redis and not worth surviving a restart) so a deploy in the
  // middle of the debounce window can resume the pending flush at boot.
  const { image: _image, ...persistable } = merged
  await redis.set(bufCtxKey(ctx.conversationId), JSON.stringify(persistable), 'EX', BUFFER_TTL_SECONDS)

  const { debounce_ms } = await getBotConfig()
  const existing = timers.get(ctx.conversationId)
  if (existing) clearTimeout(existing)
  timers.set(
    ctx.conversationId,
    setTimeout(() => { flush(ctx.conversationId).catch((e) => console.error('bot flush error:', e)) }, debounce_ms)
  )
}

/**
 * Boot-time recovery: re-schedule the flush of every debounce buffer that
 * survived a restart/deploy in Redis. Without this, messages received right
 * before a restart would sit buffered and unanswered until the customer wrote
 * again. The ctx is rebuilt inside flush() from the persisted bot:bufctx:* key.
 */
export async function resumePendingBotFlushes(): Promise<void> {
  const { debounce_ms } = await getBotConfig()
  let cursor = '0'
  let resumed = 0
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'bot:buf:*', 'COUNT', 100)
    cursor = next
    for (const key of keys) {
      const conversationId = key.slice('bot:buf:'.length)
      if (timers.has(conversationId)) continue          // already scheduled on this instance
      if ((await redis.llen(key)) === 0) continue       // nothing pending
      if (!(await redis.exists(bufCtxKey(conversationId)))) {
        // Buffer from before ctx persistence existed (or ctx expired) — can't
        // rebuild; the messages are retried together with the customer's next one.
        console.warn(`[bot] buffer pendente sem contexto persistido (conversa=${conversationId}) — aguardando próxima mensagem do cliente para retomar`)
        continue
      }
      timers.set(
        conversationId,
        setTimeout(() => { flush(conversationId).catch((e) => console.error('bot flush error:', e)) }, debounce_ms)
      )
      resumed++
    }
  } while (cursor !== '0')
  if (resumed > 0) console.log(`[bot] ${resumed} resposta(s) pendente(s) de debounce retomada(s) após restart`)
}

// Deterministic reminder confirmation — exact "sim"/"confirmo"/etc. (normalized:
// trim, lowercase, no accents; trailing punctuation tolerated). Anything else is
// ambiguous and falls through to the normal bot flow.
const CONFIRMATION_RE = /^(sim|confirmo|confirmar|confirmado|ok|pode ser|isso mesmo)[\s!.?]*$/

function normalizeConfirmationText(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * If the message is exactly a confirmation ("SIM" etc.) AND the customer has an
 * upcoming appointment still `pending`, confirm it deterministically — no LLM
 * call. Conservative by design: any ambiguity (other text, image attached, no
 * pending appointment) returns false so the normal bot flow handles it.
 * Returns true when the message was fully handled here (persisted + replied).
 */
async function handleReminderConfirmation(ctx: DispatchCtx, combined: string): Promise<boolean> {
  if (ctx.image) return false
  if (!CONFIRMATION_RE.test(normalizeConfirmationText(combined))) return false

  const { rows: [appt] } = await db.query(
    `SELECT id,
            to_char(starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM') AS day_fmt,
            to_char(starts_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS time_fmt
     FROM appointments
     WHERE tenant_id = $1 AND customer_id = $2 AND status = 'pending' AND starts_at >= now()
     ORDER BY starts_at ASC LIMIT 1`,
    [ctx.tenantId, ctx.customerId]
  )
  if (!appt) return false

  await db.query(
    `UPDATE appointments SET status = 'confirmed' WHERE id = $1 AND tenant_id = $2`,
    [appt.id, ctx.tenantId]
  )

  const botCfg = await getBotConfig()
  const replyText = botCfg.use_emojis
    ? `Confirmado! Te esperamos no dia ${appt.day_fmt} às ${appt.time_fmt} 👍`
    : `Confirmado! Te esperamos no dia ${appt.day_fmt} às ${appt.time_fmt}.`

  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [ctx.tenantId, ctx.conversationId, 'user', combined]
  )
  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [ctx.tenantId, ctx.conversationId, 'assistant', replyText]
  )
  await evolutionSend(ctx.instanceId, ctx.customerPhone, replyText)
  console.log(`[bot] confirmação determinística: appointment=${appt.id} confirmado via "${combined.trim()}" (tenant=${ctx.tenantId})`)
  return true
}

/** Drop the persisted ctx once the buffer is fully drained (best-effort tidy-up). */
async function cleanupCtxIfDrained(conversationId: string, bufKey: string): Promise<void> {
  try {
    if ((await redis.llen(bufKey)) === 0) await redis.del(bufCtxKey(conversationId))
  } catch { /* non-fatal */ }
}

async function flush(conversationId: string): Promise<void> {
  timers.delete(conversationId)
  let ctx = latestCtx.get(conversationId)
  latestCtx.delete(conversationId)
  if (!ctx) {
    // Restarted mid-debounce: rebuild the ctx from the persisted copy (the image,
    // if any, was intentionally not persisted — text still gets answered).
    const raw = await redis.get(bufCtxKey(conversationId))
    if (raw) { try { ctx = JSON.parse(raw) as DispatchCtx } catch { /* corrupted — fall through */ } }
  }
  if (!ctx) return

  const bufKey = `bot:buf:${conversationId}`
  const parts = await redis.lrange(bufKey, 0, -1)
  if (!parts.length) return
  const combined = parts.join('\n')

  // Deterministic "SIM" reminder confirmation — handled without the LLM.
  if (await handleReminderConfirmation(ctx, combined)) {
    await redis.ltrim(bufKey, parts.length, -1)
    await cleanupCtxIfDrained(conversationId, bufKey)
    return
  }

  // Per-sender rate limit — consumed ONCE per bot execution (not per message).
  // Over the limit: the customer's message is PERSISTED (the owner still sees it
  // in the panel/WhatsApp) and a single honest notice is sent when the limit is
  // first crossed — never a silent drop.
  const rl = await consumeSenderRateLimit(ctx.tenantId, ctx.customerPhone)
  if (rl.limited) {
    await redis.ltrim(bufKey, parts.length, -1)
    await cleanupCtxIfDrained(conversationId, bufKey)
    await db.query(
      'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
      [ctx.tenantId, conversationId, 'user', combined]
    )
    if (rl.justCrossed) {
      const botCfg = await getBotConfig()
      const notice = botCfg.use_emojis
        ? 'Recebi bastante mensagens suas em pouco tempo, então vou dar uma pausa por aqui, tá? 🙏 Suas mensagens ficaram registradas e alguém da nossa equipe pode continuar seu atendimento.'
        : 'Recebi bastante mensagens suas em pouco tempo, então vou dar uma pausa por aqui, tá? Suas mensagens ficaram registradas e alguém da nossa equipe pode continuar seu atendimento.'
      await db.query(
        'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
        [ctx.tenantId, conversationId, 'assistant', notice]
      )
      await evolutionSend(ctx.instanceId, ctx.customerPhone, notice)
    }
    return
  }

  // Run the bot first. The buffer is only trimmed AFTER a successful run — if
  // runBot throws, the messages stay queued in Redis (retried together with the
  // customer's next message) instead of vanishing unanswered.
  let reply: Awaited<ReturnType<typeof runBot>>
  try {
    reply = await runBot({
      tenantId: ctx.tenantId,
      conversationId,
      customerMessage: combined,
      customerId: ctx.customerId,
      customerName: ctx.customerName,
      customerLastName: ctx.customerLastName,
      customerPhone: ctx.customerPhone,
      image: ctx.image,
    })
  } catch (err) {
    console.error(`[bot] runBot falhou (conversa=${conversationId}, tenant=${ctx.tenantId}) — mensagem mantida no buffer:`, err)
    try {
      // Keep the customer's message visible to the owner even though the bot failed,
      // and send an honest short fallback instead of going silent.
      await db.query(
        'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
        [ctx.tenantId, conversationId, 'user', combined]
      )
      const botCfg = await getBotConfig()
      const fallback = botCfg.use_emojis
        ? 'Recebi sua mensagem! Já te respondo, tá? 🙌'
        : 'Recebi sua mensagem! Já te respondo, tá?'
      await db.query(
        'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
        [ctx.tenantId, conversationId, 'assistant', fallback]
      )
      await evolutionSend(ctx.instanceId, ctx.customerPhone, fallback)
    } catch (fallbackErr) {
      console.error(`[bot] fallback após falha do runBot também falhou (conversa=${conversationId}):`, fallbackErr)
    }
    return
  }

  // Success: remove only the entries we processed — messages that arrived while
  // runBot was running stay buffered for their own debounce flush.
  await redis.ltrim(bufKey, parts.length, -1)
  await cleanupCtxIfDrained(conversationId, bufKey)

  // Deliberate silence (e.g. cost-cap notice already sent in this conversation):
  // record the customer's message for the owner and send nothing.
  if (!reply.text && !reply.offerSpecialist) {
    await db.query(
      'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
      [ctx.tenantId, conversationId, 'user', combined]
    )
    return
  }

  // Escalation: the bot decided it can't resolve — send the tenant's configured
  // "specialist?" prompt (interactive button, with a plain-text fallback) instead
  // of a normal reply. The bot pauses only AFTER the customer confirms (webhook).
  // If handoff is DISABLED for this tenant, the button would be dead (its click
  // does nothing) — send a graceful text instead of offering a broken flow.
  const cfg = reply.offerSpecialist ? await getHandoffConfig(ctx.tenantId) : null
  const offerHandoff = !!cfg?.enabled
  let outgoing: string
  if (!cfg) {
    outgoing = reply.text
  } else if (offerHandoff) {
    outgoing = cfg.offer_message
  } else {
    // BOT-15: o modelo pediu handoff, mas o recurso está DESATIVADO para este
    // tenant — ninguém vai "retornar" automaticamente. Nada de prometer um
    // retorno que não acontece: texto honesto (a mensagem fica registrada e
    // visível ao dono no WhatsApp/painel) + evento persistido em bot_errors
    // para o tenant/Root Admin enxergarem o pedido não atendido.
    const botCfg = await getBotConfig()
    outgoing = botCfg.use_emojis
      ? 'Essa parte eu não consigo resolver por aqui 😕 Sua mensagem ficou registrada para a nossa equipe, tá bom?'
      : 'Essa parte eu não consigo resolver por aqui. Sua mensagem ficou registrada para a nossa equipe, tá bom?'
    await logBotError(
      ctx.tenantId, 'handoff_desativado',
      `O bot quis encaminhar o cliente ${ctx.customerPhone} a um especialista, mas o handoff está DESATIVADO nas configurações — nenhum humano foi acionado automaticamente. A mensagem do cliente está registrada na conversa; considere ativar o handoff ou responder manualmente.`,
      conversationId
    )
  }

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
    // Entrega humana: quebra em bolhas + "digitando…" + pausa proporcional.
    await evolutionSendHuman(ctx.instanceId, ctx.customerPhone, outgoing)
  }
}
