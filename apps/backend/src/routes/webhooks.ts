import { FastifyPluginAsync } from 'fastify'
import crypto from 'node:crypto'
import { db } from '../lib/db'
import { redis, QR_CODE_TTL } from '../lib/redis'
import { isDuplicateMessage, scheduleReply } from '../services/botDispatcher'
import { getPaymentConfig } from '../lib/paymentConfig'
import { applyPreapproval } from '../lib/subscriptionState'
import { tenantMediaEnabled } from '../lib/planMedia'
import { transcribeAudio } from '../lib/transcription'
import { evolutionGetMediaBase64, evolutionSend } from '../services/evolution'

// Validate the shared secret Evolution must send with every webhook.
// Enabled only when EVOLUTION_WEBHOOK_SECRET is set — so existing instances keep
// working until they are re-registered with the token. Accepts the secret via
// ?token= query, or the `apikey` / `x-webhook-token` header.
function webhookAuthorized(request: any): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!secret) return true // not configured yet — allow (logged as a warning at boot)
  const provided =
    (request.query as any)?.token ||
    request.headers['x-webhook-token'] ||
    request.headers['apikey']
  if (!provided) return false
  const a = Buffer.from(String(provided))
  const b = Buffer.from(secret)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  if (!process.env.EVOLUTION_WEBHOOK_SECRET) {
    app.log.warn('EVOLUTION_WEBHOOK_SECRET not set — WhatsApp webhook is UNAUTHENTICATED. Set it and re-register instances.')
  }

  // Evolution API webhook — receives WhatsApp events
  // Evolution sends to /:instanceId OR /:instanceId/event-name regardless of byEvents setting
  const whatsappHandler = async (request: any, reply: any) => {
      if (!webhookAuthorized(request)) return reply.status(401).send({ error: 'unauthorized' })
      const instanceId = (request.params as any).instanceId
      const body = request.body as any

      // Cache QR code when Evolution delivers it via webhook
      if (body?.event === 'qrcode.updated') {
        const qrBase64 = body?.data?.qrcode?.base64 ?? body?.data?.base64
        if (qrBase64) {
          const { rows: [instance] } = await db.query(
            'SELECT tenant_id FROM whatsapp_instances WHERE instance_name = $1',
            [instanceId]
          )
          if (instance) {
            await redis.setex(`whatsapp:qr:${instance.tenant_id}`, QR_CODE_TTL, JSON.stringify({ qrcode: qrBase64 }))
          }
        }
        return reply.send({ ok: true })
      }

      // Handle connection status updates
      if (body?.event === 'connection.update') {
        const state = body?.data?.state
        if (state === 'open') {
          const phone = body?.data?.instance?.wuid?.replace('@s.whatsapp.net', '') ?? null
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

      // Ignore our own echoes and non-message events.
      if (body?.data?.key?.fromMe) return reply.send({ ok: true })
      if (body?.event !== 'messages.upsert') return reply.send({ ok: true })

      const customerPhone = body.data?.key?.remoteJid?.replace('@s.whatsapp.net', '')
      const messageId = body.data?.key?.id as string | undefined
      const msg = body.data?.message ?? {}

      // Classify the message. Text is always handled; image/audio only when the
      // tenant's plan allows (checked below, after the tenant is resolved).
      const textContent = msg.conversation || msg.extendedTextMessage?.text || ''
      const imageMsg = msg.imageMessage
      const audioMsg = msg.audioMessage || msg.pttMessage
      const kind: 'text' | 'image' | 'audio' | 'other' =
        textContent ? 'text' : imageMsg ? 'image' : audioMsg ? 'audio' : 'other'

      if (!customerPhone || kind === 'other') return reply.send({ ok: true })

      // De-duplicate — Evolution re-delivers webhooks; never process the same message twice
      if (await isDuplicateMessage(messageId)) return reply.send({ ok: true, dedup: true })

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

      // Find or create customer — never overwrite a real name with the phone number
      let customer: { id: string; name: string; phone: string }
      const existing = await db.query(
        'SELECT id, name, phone FROM customers WHERE tenant_id = $1 AND phone = $2',
        [tenantId, customerPhone]
      )
      if (existing.rows[0]) {
        customer = existing.rows[0]
      } else {
        const { rows: [c] } = await db.query(
          `INSERT INTO customers (tenant_id, name, phone) VALUES ($1, $2, $3) RETURNING id, name, phone`,
          [tenantId, customerPhone, customerPhone]
        )
        customer = c
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

        if (kind === 'image') {
          botImage = { base64: rawB64, mediaType: media.mimetype || imageMsg?.mimetype || 'image/jpeg' }
          finalText = imageMsg?.caption || ''
        } else {
          const transcript = await transcribeAudio(rawB64, media.mimetype || audioMsg?.mimetype || 'audio/ogg')
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
        { tenantId, conversationId, customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, instanceId },
        finalText,
        botImage
      )
      return reply.send({ ok: true })
  }

  app.post<{ Params: { instanceId: string } }>('/whatsapp/:instanceId', whatsappHandler)
  // Evolution v2 appends event name to URL even with byEvents:false
  app.post<{ Params: { instanceId: string; '*': string } }>('/whatsapp/:instanceId/*', whatsappHandler)

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
}
