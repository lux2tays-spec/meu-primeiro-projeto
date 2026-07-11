import { FastifyPluginAsync } from 'fastify'
import crypto from 'node:crypto'
import { db } from '../lib/db'
import { redis, QR_CODE_TTL } from '../lib/redis'
import { processMessage } from '../services/bot'
import { evolutionSend } from '../services/evolution'

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

      // Only process text messages from customers (not echo)
      if (body?.data?.key?.fromMe) return reply.send({ ok: true })
      if (body?.event !== 'messages.upsert') return reply.send({ ok: true })

      const customerPhone = body.data?.key?.remoteJid?.replace('@s.whatsapp.net', '')
      const messageText = body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text
      if (!customerPhone || !messageText) return reply.send({ ok: true })

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

      // Get AI response — user message is NOT saved to DB yet to avoid duplication
      // when Redis expires and history is loaded from DB mid-conversation
      const aiReply = await processMessage({
        tenantId,
        conversationId,
        customerMessage: messageText,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
      })

      // Extract JSON action from AI reply — handles pure JSON, markdown-wrapped, or JSON appended after text
      let replyText = aiReply
      let parsedAction: any = null

      const tryParse = (str: string) => {
        try { return JSON.parse(str.trim()) } catch { return null }
      }

      // 1. Pure JSON (entire reply is JSON)
      parsedAction = tryParse(aiReply)

      // 2. Markdown-wrapped: ```json {...} ```
      if (!parsedAction) {
        const noFences = aiReply.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim()
        parsedAction = tryParse(noFences)
      }

      // 3. JSON block anywhere in reply — find last complete {...} block with "action" key
      if (!parsedAction) {
        const lastBrace = aiReply.lastIndexOf('}')
        if (lastBrace !== -1) {
          for (let i = lastBrace - 1; i >= 0; i--) {
            if (aiReply[i] === '{') {
              const candidate = aiReply.slice(i, lastBrace + 1)
              const parsed = tryParse(candidate)
              if (parsed?.action) {
                parsedAction = parsed
                // text before the JSON block (strip trailing 'json' label if present)
                replyText = aiReply.slice(0, i).replace(/\s*\bjson\b\s*$/i, '').trim()
                break
              }
            }
          }
        }
      }

      // Apply parsed action
      if (parsedAction) {
        if (parsedAction.reply) replyText = parsedAction.reply
        if (parsedAction.action === 'UPDATE_CUSTOMER_INFO') {
          const name = parsedAction.data?.name || parsedAction.name || null
          const email = parsedAction.data?.email || parsedAction.email || null
          if (name || email) {
            await db.query(
              `UPDATE customers SET
                 name  = COALESCE($1, name),
                 email = COALESCE($2, email)
               WHERE id = $3`,
              [name, email, customer.id]
            )
          }
        }
      }

      // Persist both messages only after successful AI response
      await db.query(
        'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
        [tenantId, conversationId, 'user', messageText]
      )
      await db.query(
        'INSERT INTO messages (tenant_id, conversation_id, role, content) VALUES ($1,$2,$3,$4)',
        [tenantId, conversationId, 'assistant', replyText]
      )

      // Send via Evolution API
      await evolutionSend(instanceId, customerPhone, replyText)

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

    // 1. Verify HMAC signature (skipped only if secret not configured)
    const secret = process.env.MP_WEBHOOK_SECRET
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
    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN
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

    // MP status → our subscription/tenant status
    const subStatus = ['authorized', 'paused', 'cancelled', 'pending'].includes(sub.status) ? sub.status : 'pending'
    const tenantStatus = subStatus === 'authorized' ? 'active'
      : subStatus === 'cancelled' ? 'cancelled'
      : subStatus === 'paused' ? 'suspended'
      : 'trial'

    // 4. Idempotent upsert by mp_subscription_id + reflect on tenant
    await db.query(
      `INSERT INTO subscriptions (tenant_id, mp_subscription_id, plan, status, next_billing_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (mp_subscription_id) DO UPDATE SET
         status = EXCLUDED.status, plan = EXCLUDED.plan, next_billing_date = EXCLUDED.next_billing_date`,
      [tenantId, sub.id, plan, subStatus, sub.next_payment_date?.slice(0, 10) ?? null]
    )
    await db.query(
      `UPDATE tenants SET plan = $1, status = $2 WHERE id = $3`,
      [subStatus === 'authorized' ? plan : 'free', tenantStatus, tenantId]
    )

    return reply.send({ ok: true })
  })
}
