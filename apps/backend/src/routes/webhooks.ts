import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'
import { redis, QR_CODE_TTL } from '../lib/redis'
import { processMessage } from '../services/bot'
import { evolutionSend } from '../services/evolution'

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // Evolution API webhook — receives WhatsApp events
  // Evolution sends to /:instanceId OR /:instanceId/event-name regardless of byEvents setting
  const whatsappHandler = async (request: any, reply: any) => {
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

      // Parse structured action or plain reply (strip markdown code blocks if present)
      let replyText = aiReply
      try {
        const cleaned = aiReply.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
        const parsed = JSON.parse(cleaned)
        if (parsed.reply) replyText = parsed.reply
        if (parsed.action === 'UPDATE_CUSTOMER_INFO' && parsed.data) {
          const { name, email } = parsed.data
          if (name || email) {
            await db.query(
              `UPDATE customers SET
                 name  = COALESCE($1, name),
                 email = COALESCE($2, email)
               WHERE id = $3`,
              [name || null, email || null, customer.id]
            )
          }
        }
      } catch { /* plain text reply */ }

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

  // Mercado Pago webhook
  app.post('/mercadopago', async (request, reply) => {
    const body = request.body as any
    const type = body?.type
    const resourceId = body?.data?.id

    if (type === 'subscription_preapproval') {
      // TODO: fetch subscription from MP and update DB
    }

    return reply.send({ ok: true })
  })
}
