import { FastifyPluginAsync } from 'fastify'
import crypto from 'node:crypto'
import { db } from '../lib/db'
import { redis, QR_CODE_TTL } from '../lib/redis'
import { isDuplicateMessage, scheduleReply } from '../services/botDispatcher'
import { logBotError } from '../services/bot'
import { getPaymentConfig } from '../lib/paymentConfig'
import { applyPreapproval } from '../lib/subscriptionState'
import { tenantMediaEnabled } from '../lib/planMedia'
import { transcribeAudio } from '../lib/transcription'
import { evolutionGetMediaBase64, evolutionSend, wasSentByBot, HANDOFF_BUTTON_ID } from '../services/evolution'
import { base64Bytes, isAllowedAudioType, normalizeImageType, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from '../lib/mediaGuard'
import { getEvolutionConfig } from '../lib/integrationConfig'
import { getHandoffConfig } from '../lib/handoffConfig'
import { SUPPORT_INSTANCE, updateSupportBotConfig } from '../lib/supportBotConfig'
import { runSupportBot } from '../services/supportBot'
import { notifyTenantManagers } from '../lib/notifications'
import { decrypt } from '../lib/crypto'
import { syncCommissionForAppointment } from '../lib/commissions'
import { markSalePaid } from '../services/tenantPayments'

// Validate the shared secret Evolution must send with every webhook.
// Enabled only when a webhook secret is configured (Root Admin panel, with
// EVOLUTION_WEBHOOK_SECRET env fallback) — so existing instances keep working
// until they are re-registered with the token. Accepts the secret via
// ?token= query, or the `apikey` / `x-webhook-token` header.
// NEVER silently drop a real WhatsApp message. A booking bot that goes quiet
// while the panel still says "connected" is the worst possible failure — the
// owner thinks all is well while clients get ignored. So we PROCESS by default
// and only reject a request that carries an EXPLICITLY WRONG token (a forgery
// attempt), which we log. Missing token or unconfigured secret → process + warn.
let warnedWebhookAuth = false
function warnWebhookOnce(msg: string) {
  if (!warnedWebhookAuth) { warnedWebhookAuth = true; console.warn(msg) }
}
async function webhookAuthorized(request: any): Promise<boolean> {
  const { webhook_secret: secret } = await getEvolutionConfig()
  const provided =
    (request.query as any)?.token ||
    request.headers['x-webhook-token'] ||
    request.headers['apikey']

  if (!secret) {
    warnWebhookOnce('[webhook] sem segredo configurado — processando mensagens sem autenticação (defina EVOLUTION_WEBHOOK_SECRET p/ endurecer).')
    return true
  }
  if (!provided) {
    // Instance was registered before the secret existed → no token in the URL.
    // Process anyway (don't drop the customer's message); re-register to enable auth.
    warnWebhookOnce('[webhook] requisição sem token — processando mesmo assim; reconecte a instância para ativar a autenticação por token.')
    return true
  }
  // A token WAS sent → it must match. Only an active mismatch (likely forged) is rejected.
  const a = Buffer.from(String(provided))
  const b = Buffer.from(secret)
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!ok) console.warn('[webhook] token inválido — requisição rejeitada (possível forjada).')
  return ok
}

// True when the customer is EXPLICITLY asking to be transferred to a human —
// the handoff button was clicked (id), the typed text is EXACTLY the configured
// label, or the phrase is an unambiguous transfer request ("falar com um
// atendente", "me passa para", "atendente humano"). Deliberately strict: a
// merely related phrase ("quero remarcar com a atendente Paula") must flow to
// the bot normally — the model itself offers the specialist when it gets stuck.
function normalizeHandoffText(text: string): string {
  return (text || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function isHandoffRequest(buttonId: string, text: string, buttonLabel: string): boolean {
  if (buttonId === HANDOFF_BUTTON_ID) return true
  const t = normalizeHandoffText(text)
  if (!t) return false
  // Deterministic shortcut ONLY for the exact label (some clients echo the
  // button click as plain text) — never a fuzzy "contains".
  if (buttonLabel && t === normalizeHandoffText(buttonLabel)) return true
  return (
    // "quero falar/conversar com um atendente/humano/especialista/uma pessoa/alguém"
    /\b(falar|conversar)\s+com\s+(um[a]?\s+|o\s+|a\s+)?(atendente|humano|humana|especialista|pessoa|alguem)\b/.test(t) ||
    // "me passa/transfere/encaminha para ..."
    /\bme\s+(passa|passe|transfere|transfira|encaminha|encaminhe)\s+(para|pra|pro)\b/.test(t) ||
    // "atendente humano", "atendimento humano", "pessoa de verdade", "pessoa real"
    /\b(atendente|atendimento|pessoa)\s+(humano|humana|de\s+verdade|real)\b/.test(t) ||
    // "quero/preciso de um humano"
    /\b(quero|preciso\s+de)\s+(um\s+)?humano\b/.test(t)
  )
}

// A `fromMe` event is EITHER our own API echo (the bot's reply) or a message the
// business owner typed manually from their own phone. The latter either resumes
// the bot (if it matches the configured keyword) or pauses it (owner taking over).
async function maybePauseOnOwnerReply(instanceId: string, body: any): Promise<void> {
  if (body?.event !== 'messages.upsert') return
  const key = body?.data?.key
  const remoteJid: string = key?.remoteJid ?? ''
  if (!remoteJid.endsWith('@s.whatsapp.net')) return // 1:1 customer chats only
  const m = body?.data?.message ?? {}
  const text = (m.conversation || m.extendedTextMessage?.text || '').trim()
  // BOT-13: mídia enviada manualmente pelo dono (áudio, imagem, vídeo,
  // documento) também significa "humano assumiu a conversa" — deve pausar o
  // bot igual a uma resposta em texto. O bot só envia texto, então mídia
  // fromMe nunca é echo nosso (e o wasSentByBot abaixo cobre os echos).
  const mediaLabel =
    m.imageMessage ? '[imagem]' :
    (m.audioMessage || m.pttMessage) ? '[áudio]' :
    m.videoMessage ? '[vídeo]' :
    m.documentMessage ? '[documento]' :
    m.stickerMessage ? '[figurinha]' : ''
  if (!text && !mediaLabel) return             // nothing actionable (reactions, etc.)
  if (await wasSentByBot(key?.id)) return       // our own bot/system echo — ignore

  const { rows: [inst] } = await db.query('SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1', [instanceId])
  if (!inst) return
  const tenantId = inst.tenant_id
  const cfg = await getHandoffConfig(tenantId)
  if (!cfg.enabled) return

  const phone = remoteJid.replace('@s.whatsapp.net', '')
  const { rows: [conv] } = await db.query(
    `SELECT c.id FROM conversations c JOIN customers cu ON cu.id = c.customer_id
     WHERE c.tenant_id = $1 AND cu.phone = $2`,
    [tenantId, phone]
  )
  if (!conv) return // owner messaged someone with no conversation yet — nothing to do

  // Owner typed the configured keyword → hand this conversation BACK to the bot now.
  // (Only meaningful for text — media never matches the keyword.)
  if (text && cfg.owner_resume_keyword && text.toLowerCase() === cfg.owner_resume_keyword.toLowerCase()) {
    await db.query('UPDATE conversations SET bot_paused_until = NULL WHERE id = $1', [conv.id])
    if (cfg.resume_message) await evolutionSend(instanceId, phone, cfg.resume_message)
    return
  }

  if (!cfg.pause_on_owner_reply) return // auto-pause on manual reply is disabled

  const until = new Date(Date.now() + cfg.timeout_min * 60_000)
  await db.query('UPDATE conversations SET bot_paused_until = $1 WHERE id = $2', [until, conv.id])
  // Keep the owner's manual reply in history so the bot has context when it
  // resumes (media becomes a placeholder like '[áudio]', same as elsewhere).
  await db.query(
    'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
    [tenantId, conv.id, 'assistant', text || mediaLabel]
  )
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Boot-time warning (non-blocking): checks the effective secret (panel + env fallback).
  getEvolutionConfig()
    .then((cfg) => {
      if (!cfg.webhook_secret) {
        app.log.warn('Evolution webhook secret not set (panel/EVOLUTION_WEBHOOK_SECRET) — WhatsApp webhook is UNAUTHENTICATED. Set it and re-register instances.')
      }
    })
    .catch(() => {
      if (!process.env.EVOLUTION_WEBHOOK_SECRET) {
        app.log.warn('EVOLUTION_WEBHOOK_SECRET not set — WhatsApp webhook is UNAUTHENTICATED. Set it and re-register instances.')
      }
    })

  // Evolution API webhook — receives WhatsApp events
  // Evolution sends to /:instanceId OR /:instanceId/event-name regardless of byEvents setting
  const whatsappHandler = async (request: any, reply: any) => {
      if (!(await webhookAuthorized(request))) return reply.status(401).send({ error: 'unauthorized' })
      const instanceId = (request.params as any).instanceId
      const body = request.body as any

      // Cache QR code when Evolution delivers it via webhook
      if (body?.event === 'qrcode.updated') {
        const qrBase64 = body?.data?.qrcode?.base64 ?? body?.data?.base64
        if (qrBase64) {
          if (instanceId === SUPPORT_INSTANCE) {
            await redis.setex(`support:qr`, QR_CODE_TTL, JSON.stringify({ qrcode: qrBase64 }))
          } else {
            const { rows: [instance] } = await db.query(
              'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1',
              [instanceId]
            )
            if (instance) {
              await redis.setex(`whatsapp:qr:${instance.tenant_id}`, QR_CODE_TTL, JSON.stringify({ qrcode: qrBase64 }))
            }
          }
        }
        return reply.send({ ok: true })
      }

      // Handle connection status updates
      if (body?.event === 'connection.update') {
        const state = body?.data?.state
        const phone = body?.data?.instance?.wuid?.replace('@s.whatsapp.net', '') ?? null
        if (instanceId === SUPPORT_INSTANCE) {
          if (state === 'open') await updateSupportBotConfig(phone ? { status: 'connected', phone_number: phone } : { status: 'connected' })
          else if (state === 'close') await updateSupportBotConfig({ status: 'disconnected' })
          return reply.send({ ok: true })
        }
        if (state === 'open') {
          await db.query(
            `UPDATE whatsapp_instances
             SET status = 'connected', phone_number = COALESCE($1, phone_number)
             WHERE instance_name = $2`,
            [phone, instanceId]
          )
        } else if (state === 'close') {
          await db.query(
            `UPDATE whatsapp_instances SET status = 'disconnected' WHERE instance_name = $1`,
            [instanceId]
          )
        }
        return reply.send({ ok: true })
      }

      // A message we sent (bot echo) or the owner's own manual reply. The latter
      // pauses the bot so the human takes over; the former is ignored.
      if (body?.data?.key?.fromMe) {
        try { await maybePauseOnOwnerReply(instanceId, body) } catch (e) { app.log.warn({ e }, 'maybePauseOnOwnerReply falhou') }
        return reply.send({ ok: true })
      }
      if (body?.event !== 'messages.upsert') return reply.send({ ok: true })

      const customerPhone = body.data?.key?.remoteJid?.replace('@s.whatsapp.net', '')
      const messageId = body.data?.key?.id as string | undefined
      const msg = body.data?.message ?? {}

      // Interactive-button reply (handoff): treat its label as text so it flows
      // through the normal pipeline and is visible to the owner.
      const buttonId: string = msg.buttonsResponseMessage?.selectedButtonId || msg.templateButtonReplyMessage?.selectedId || ''
      const buttonText: string = msg.buttonsResponseMessage?.selectedDisplayText || msg.templateButtonReplyMessage?.selectedDisplayText || ''

      // Classify the message. Text is always handled; image/audio only when the
      // tenant's plan allows (checked below, after the tenant is resolved).
      const textContent = msg.conversation || msg.extendedTextMessage?.text || buttonText || ''
      const imageMsg = msg.imageMessage
      const audioMsg = msg.audioMessage || msg.pttMessage
      const kind: 'text' | 'image' | 'audio' | 'other' =
        textContent ? 'text' : imageMsg ? 'image' : audioMsg ? 'audio' : 'other'

      if (!customerPhone || kind === 'other') return reply.send({ ok: true })

      // De-duplicate — Evolution re-delivers webhooks; never process the same message twice
      if (await isDuplicateMessage(messageId)) return reply.send({ ok: true, dedup: true })

      // System support/sales bot (platform's own number) — not a tenant. Answer
      // with the support engine and return before any tenant resolution.
      if (instanceId === SUPPORT_INSTANCE) {
        if (kind === 'text' && textContent) {
          try {
            const answer = await runSupportBot(customerPhone, textContent)
            await evolutionSend(instanceId, customerPhone, answer)
          } catch (e) {
            app.log.error({ e }, 'support bot falhou')
          }
        }
        return reply.send({ ok: true })
      }

      // Resolve tenant from instance
      const { rows: [instance] } = await db.query(
        'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1',
        [instanceId]
      )
      if (!instance) return reply.status(404).send({ error: 'Instance not found' })
      const tenantId = instance.tenant_id

      // Don't run the bot (and incur AI cost) for suspended/cancelled tenants or expired trials
      const { rows: [tenantStatus] } = await db.query(
        'SELECT status, trial_ends_at FROM tenants WHERE id = $1',
        [tenantId]
      )
      const botBlocked = !tenantStatus ||
        tenantStatus.status === 'suspended' ||
        tenantStatus.status === 'cancelled' ||
        (tenantStatus.status === 'trial' && tenantStatus.trial_ends_at && new Date(tenantStatus.trial_ends_at) < new Date())
      if (botBlocked) return reply.send({ ok: true, skipped: 'tenant_inactive' })

      // Per-sender rate limit: consumed no botDispatcher (1x por EXECUÇÃO do bot,
      // no flush do debounce — não por mensagem recebida). Lá a mensagem é
      // persistida e o cliente recebe um único aviso, nunca um descarte silencioso.

      // Find or create customer — never overwrite a real name with the phone number
      let customer: { id: string; name: string; last_name: string | null; phone: string }
      const existing = await db.query(
        'SELECT id, name, last_name, phone FROM customers WHERE tenant_id = $1 AND phone = $2',
        [tenantId, customerPhone]
      )
      if (existing.rows[0]) {
        customer = existing.rows[0]
      } else {
        const { rows: [c] } = await db.query(
          `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING id, name, last_name, phone`,
          [tenantId, customerPhone, customerPhone]
        )
        customer = c
        // Aviso: novo cliente iniciou conversa no WhatsApp (ponto 4).
        notifyTenantManagers(tenantId, {
          type: 'new_customer',
          title: 'Novo cliente no WhatsApp',
          body: `Um novo contato (${customerPhone}) iniciou uma conversa.`,
          link: '/customers',
          data: { customer_id: c.id },
        }).catch((e) => console.error('[notifications] new_customer falhou:', e))
      }

      // Find or create conversation
      const { rows: [conversation] } = await db.query(
        `INSERT INTO conversations (tenant_id, customer_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantId, customer.id]
      )
      const conversationId = conversation?.id ?? (
        await db.query(
          'SELECT id FROM conversations WHERE tenant_id=$1 AND customer_id=$2',
          [tenantId, customer.id]
        )
      ).rows[0].id

      // ── Human handoff ────────────────────────────────────────────────────────
      const handoff = await getHandoffConfig(tenantId)

      // Customer confirmed they want a human → pause the bot and go quiet. Their
      // message ("Quero ajuda de um especialista") stays visible in the owner's
      // WhatsApp, which is the signal for the owner to take over.
      if (handoff.enabled && isHandoffRequest(buttonId, textContent, handoff.button_label)) {
        const until = new Date(Date.now() + handoff.timeout_min * 60_000)
        await db.query('UPDATE conversations SET bot_paused_until = $1 WHERE id = $2', [until, conversationId])
        await db.query(
          'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
          [tenantId, conversationId, 'user', textContent || handoff.button_label]
        )
        // O ack diz "já avisei a equipe" — então AVISE de fato: registra o evento
        // (visível ao tenant/Root Admin via bot_errors) além da mensagem do
        // cliente que já fica no WhatsApp do dono.
        // TODO: enviar push (mobile) / e-mail ao dono quando houver mecanismo de
        // notificação ativa — hoje o registro abaixo é o aviso persistido.
        await logBotError(
          tenantId, 'handoff_solicitado',
          `Cliente ${customerPhone} pediu atendimento humano — bot pausado até ${until.toISOString()}. Um humano precisa assumir esta conversa.`,
          conversationId
        )
        await db.query(
          'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
          [tenantId, conversationId, 'assistant', handoff.ack_message]
        )
        await evolutionSend(instanceId, customerPhone, handoff.ack_message)
        return reply.send({ ok: true, handoff: 'confirmed' })
      }

      // Handoff pause state: while active the bot stays silent; once it expires the
      // bot resumes (optionally announcing it with the configured resume message).
      const { rows: [pauseRow] } = await db.query('SELECT bot_paused_until FROM conversations WHERE id = $1', [conversationId])
      if (pauseRow?.bot_paused_until) {
        if (new Date(pauseRow.bot_paused_until) > new Date()) {
          // Still paused (a human is handling) → record the message but do NOT reply.
          await db.query(
            'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
            [tenantId, conversationId, 'user', textContent || '[mídia]']
          )
          return reply.send({ ok: true, paused: true })
        }
        // Pause expired → the bot takes over again for this message.
        await db.query('UPDATE conversations SET bot_paused_until = NULL WHERE id = $1', [conversationId])
        if (handoff.resume_message) await evolutionSend(instanceId, customerPhone, handoff.resume_message)
      }

      // Resolve the message text + optional image the bot will actually receive.
      // For audio/image, gate on the plan and download/transcribe as needed.
      let finalText = textContent
      let botImage: { base64: string; mediaType: string } | undefined

      if (kind === 'image' || kind === 'audio') {
        if (!(await tenantMediaEnabled(tenantId))) {
          await evolutionSend(instanceId, customerPhone,
            kind === 'audio'
              ? 'Recebi seu áudio! 😊 Por aqui consigo te ajudar melhor por texto — pode me escrever?'
              : 'Recebi sua imagem! 😊 Me conta por texto o que você precisa que eu já te ajudo.')
          return reply.send({ ok: true, media: 'disabled' })
        }

        // webhookBase64 may already carry the media; otherwise fetch it.
        const inlineB64 = (msg as any).base64 || body.data?.base64
        const media = inlineB64
          ? { base64: inlineB64 as string, mimetype: (imageMsg?.mimetype || audioMsg?.mimetype || '') as string }
          : await evolutionGetMediaBase64(instanceId, body.data?.key)

        if (!media?.base64) {
          await evolutionSend(instanceId, customerPhone, 'Não consegui abrir seu arquivo 😕 Pode me mandar por texto o que você precisa?')
          return reply.send({ ok: true, media: 'download_failed' })
        }
        // Evolution may return a data URI; Claude and Buffer need raw base64.
        const rawB64 = media.base64.replace(/^data:[^;]+;base64,/, '')
        const mediaType = (media.mimetype || imageMsg?.mimetype || audioMsg?.mimetype || '') as string

        // Type allowlist — never feed unexpected formats to Claude/Whisper.
        const imageType = kind === 'image' ? normalizeImageType(mediaType) : null
        if ((kind === 'image' && !imageType) || (kind === 'audio' && !isAllowedAudioType(mediaType))) {
          await evolutionSend(instanceId, customerPhone, 'Não consigo abrir esse tipo de arquivo 😊 Pode me mandar por texto?')
          return reply.send({ ok: true, media: 'type_not_allowed' })
        }

        // Size ceiling — reject oversized media before it costs anything (image 5 MB, audio 12 MB).
        if (base64Bytes(rawB64) > (kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES)) {
          await evolutionSend(instanceId, customerPhone, 'Seu arquivo é muito grande 😅 Me manda por texto o que você precisa?')
          return reply.send({ ok: true, media: 'too_large' })
        }

        if (kind === 'image') {
          botImage = { base64: rawB64, mediaType: imageType! }
          finalText = imageMsg?.caption || ''
        } else {
          const transcript = await transcribeAudio(rawB64, mediaType)
          if (!transcript) {
            await evolutionSend(instanceId, customerPhone, 'Recebi seu áudio, mas não consegui entender agora 😊 Pode me mandar por texto?')
            return reply.send({ ok: true, media: 'transcribe_failed' })
          }
          finalText = transcript
        }
      }

      // Buffer + debounce: reply ONCE after a short quiet window (runs async).
      // Respond 200 immediately so Evolution never times out and retries.
      await scheduleReply(
        { tenantId, conversationId, customerId: customer.id, customerName: customer.name, customerLastName: customer.last_name, customerPhone: customer.phone, instanceId },
        finalText,
        botImage
      )
      return reply.send({ ok: true })
  }

  // rateLimit: false — Evolution sends ALL tenants' events from ONE IP; the
  // global per-IP limit would 429 the webhook and silence every bot at once.
  // Abuse is contained downstream by dedup + per-sender rate limit + plan caps.
  app.post<{ Params: { instanceId: string } }>('/whatsapp/:instanceId', { config: { rateLimit: false } }, whatsappHandler)
  // Evolution v2 appends event name to URL even with byEvents:false
  app.post<{ Params: { instanceId: string; '*': string } }>('/whatsapp/:instanceId/*', { config: { rateLimit: false } }, whatsappHandler)

  // Mercado Pago webhook — validates x-signature, then always re-fetches the
  // resource from MP (never trusts the request body) and updates plan/status.
  //
  // Convention: the checkout that creates the preapproval MUST set
  // external_reference = `${tenant_id}:${plan}` so we can map it back here.
  app.post('/mercadopago', async (request, reply) => {
    const body = request.body as any
    const type = body?.type ?? body?.topic
    const resourceId = body?.data?.id ?? (request.query as any)?.id

    // Platform payment credentials come from the Root Admin panel (payment_config).
    const payCfg = await getPaymentConfig()

    // 1. Verify HMAC signature (skipped only if secret not configured)
    const secret = payCfg.mp_webhook_secret
    if (secret) {
      const sig = String(request.headers['x-signature'] ?? '')
      const requestId = String(request.headers['x-request-id'] ?? '')
      const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=').map((s) => s.trim())))
      const ts = parts['ts']
      const v1 = parts['v1']
      const manifest = `id:${resourceId};request-id:${requestId};ts:${ts};`
      const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
      const ok = v1 && expected.length === v1.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))
      if (!ok) return reply.status(401).send({ error: 'invalid signature' })
    } else {
      app.log.warn('MP_WEBHOOK_SECRET not set — Mercado Pago webhook signature NOT verified.')
    }

    // 2a. Payment events → registra no histórico de cobranças (best-effort).
    if (type === 'payment') {
      const accessToken = payCfg.mp_access_token
      if (accessToken && resourceId) {
        try {
          const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${resourceId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(15_000),
          })
          if (payRes.ok) {
            const pay = await payRes.json() as any
            const [tenantId, plan] = String(pay.external_reference ?? '').split(':')
            if (tenantId) {
              await db.query(
                `INSERT INTO subscription_payments (tenant_id, mp_payment_id, plan, amount_cents, status, paid_at)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (mp_payment_id) DO UPDATE SET
                   status = EXCLUDED.status, amount_cents = EXCLUDED.amount_cents, paid_at = EXCLUDED.paid_at`,
                [tenantId, String(pay.id), plan ?? null,
                 Math.round((Number(pay.transaction_amount) || 0) * 100),
                 pay.status ?? null, pay.date_approved ?? pay.date_created ?? null]
              )
            }
          }
        } catch (e) { app.log.error({ e }, 'MP payment webhook record failed') }
      }
      return reply.send({ ok: true })
    }

    // 2. Only handle subscription events
    if (type !== 'subscription_preapproval' && type !== 'preapproval') {
      return reply.send({ ok: true })
    }
    const accessToken = payCfg.mp_access_token
    if (!accessToken || !resourceId) return reply.send({ ok: true })

    // 3. Re-fetch the authoritative resource from Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/preapproval/${resourceId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!mpRes.ok) {
      app.log.error(`MP preapproval fetch failed: ${mpRes.status}`)
      return reply.send({ ok: true })
    }
    const sub = await mpRes.json() as {
      id: string; status: string; external_reference?: string
      next_payment_date?: string
    }

    const [tenantId, plan] = (sub.external_reference ?? '').split(':')
    if (!tenantId || !plan) {
      app.log.warn(`MP preapproval ${sub.id} missing external_reference tenant:plan`)
      return reply.send({ ok: true })
    }

    // 4. Reflect on subscriptions + tenant (idempotent) — same mapping the
    // transparent checkout uses, so the two paths never diverge.
    await applyPreapproval({
      tenantId,
      plan,
      mpSubscriptionId: sub.id,
      mpStatus: sub.status,
      nextBillingDate: sub.next_payment_date?.slice(0, 10) ?? null,
    })

    return reply.send({ ok: true })
  })

  // #3 — Webhook de pagamentos de CLIENTES por tenant (venda com link de
  // pagamento). A preferência é criada com notification_url apontando pra cá. Ao
  // receber um pagamento aprovado, marca a venda como paga (entra na receita).
  // Autoridade: re-busca o pagamento na conta MP do tenant (não confia no corpo).
  app.post<{ Params: { tenantId: string } }>('/mp-tenant/:tenantId', { config: { rateLimit: false } }, async (request, reply) => {
    const tenantId = request.params.tenantId
    const body = request.body as any
    const type = body?.type ?? body?.topic
    const paymentId = body?.data?.id ?? (request.query as any)?.id ?? (request.query as any)?.['data.id']
    // Só tratamos eventos de pagamento; o resto respondemos 200 pra não reenviar.
    if (type !== 'payment' || !paymentId) return reply.send({ ok: true })

    const { rows: [t] } = await db.query('SELECT mp_access_token FROM tenants WHERE id = $1', [tenantId])
    if (!t?.mp_access_token) return reply.send({ ok: true })
    let token: string
    try { token = decrypt(t.mp_access_token) } catch { return reply.send({ ok: true }) }

    try {
      const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!payRes.ok) return reply.send({ ok: true })
      const pay = await payRes.json() as any
      const [kind, appointmentId] = String(pay.external_reference ?? '').split(':')
      if (kind === 'venda' && appointmentId && pay.status === 'approved') {
        const marked = await markSalePaid(tenantId, appointmentId)
        if (marked) {
          syncCommissionForAppointment(appointmentId).catch(() => {})
          notifyTenantManagers(tenantId, {
            type: 'confirmation',
            title: 'Pagamento recebido 💰',
            body: `Uma venda com link de pagamento foi paga (${Number(pay.transaction_amount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`,
            link: '/financeiro',
          }).catch(() => {})
        }
      }
    } catch (e) {
      app.log.error({ e }, 'mp-tenant webhook falhou')
    }
    return reply.send({ ok: true })
  })
}
