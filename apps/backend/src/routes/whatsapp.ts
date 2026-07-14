import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'
import { redis, QR_CODE_TTL } from '../lib/redis'
import {
  evolutionCreateInstance,
  evolutionGetQR,
  evolutionGetStatus,
  evolutionDeleteInstance,
} from '../services/evolution'

export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)

  // Connect WhatsApp — creates Evolution instance (idempotent) then polls for QR.
  // Stricter rate limit: each call holds a slow (~18s) QR poll upstream.
  app.post('/connect', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { tenant_id } = request.user
    if (!tenant_id) return reply.status(400).send({ error: 'No tenant' })

    const instanceName = `tenant_${tenant_id.replace(/-/g, '')}`
    const webhookBase = process.env.WEBHOOK_BASE_URL ?? process.env.BACKEND_URL ?? 'http://localhost:3000'
    // When a webhook secret is configured, embed it as ?token= so Evolution sends
    // it back and webhookAuthorized() can reject forged/unauthenticated calls.
    const secret = process.env.EVOLUTION_WEBHOOK_SECRET
    const webhookUrl = `${webhookBase}/webhook/whatsapp/${instanceName}${secret ? `?token=${encodeURIComponent(secret)}` : ''}`

    // Upsert DB record
    await db.query(
      `INSERT INTO whatsapp_instances (tenant_id, instance_name, status)
       VALUES ($1, $2, 'qr_pending')
       ON CONFLICT (tenant_id) DO UPDATE SET instance_name = $2, status = 'qr_pending'`,
      [tenant_id, instanceName]
    )

    // Create Evolution instance (handles already-exists gracefully)
    await evolutionCreateInstance(instanceName, webhookUrl)

    // Poll for QR code (Evolution generates it async — takes 2–12s)
    const qrData = await evolutionGetQR(instanceName)

    if (qrData) {
      await redis.setex(`whatsapp:qr:${tenant_id}`, QR_CODE_TTL, JSON.stringify(qrData))
      return reply.send(qrData)
    }

    // QR not ready yet — frontend should poll GET /whatsapp/qr
    return reply.send({ qr_pending: true })
  })

  // Poll QR code (called by frontend every 30s)
  app.get('/qr', async (request, reply) => {
    const { tenant_id } = request.user

    // Check cache first
    const cached = await redis.get(`whatsapp:qr:${tenant_id}`)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.qrcode) return reply.send(parsed)
    }

    const { rows: [instance] } = await db.query(
      'SELECT instance_name FROM whatsapp_instances WHERE tenant_id = $1',
      [tenant_id]
    )
    if (!instance) return reply.status(404).send({ error: 'No instance' })

    const qrData = await evolutionGetQR(instance.instance_name)
    if (qrData) {
      await redis.setex(`whatsapp:qr:${tenant_id}`, QR_CODE_TTL, JSON.stringify(qrData))
      return reply.send(qrData)
    }

    return reply.status(202).send({ qr_pending: true })
  })

  // Get connection status
  app.get('/status', async (request, reply) => {
    const { tenant_id } = request.user

    const { rows: [instance] } = await db.query(
      'SELECT instance_name, status, phone_number FROM whatsapp_instances WHERE tenant_id = $1',
      [tenant_id]
    )
    if (!instance) return reply.send({ status: 'disconnected' })

    const liveStatus = await evolutionGetStatus(instance.instance_name)
    const state = liveStatus?.instance?.state ?? liveStatus?.state ?? 'unknown'

    // Sync DB with Evolution's real state.
    if (state === 'open') {
      if (instance.status !== 'connected') {
        await db.query(`UPDATE whatsapp_instances SET status = 'connected' WHERE tenant_id = $1`, [tenant_id])
        instance.status = 'connected'
      }
    } else if (state === 'close') {
      // Definitive: the WhatsApp session ended (phone unlinked) — finalize, even
      // if we were 'connected'. 'unknown' (transient Evolution error) is NOT
      // treated as a disconnect for a live connection.
      if (instance.status !== 'disconnected') {
        await db.query(
          `UPDATE whatsapp_instances SET status = 'disconnected', phone_number = NULL WHERE tenant_id = $1`,
          [tenant_id]
        )
        await redis.del(`whatsapp:qr:${tenant_id}`)
        instance.status = 'disconnected'
        instance.phone_number = null
      }
    } else if (state === 'unknown' && instance.status === 'qr_pending') {
      // Only a pending (not yet live) connection is cleared on an unknown state.
      await db.query(`UPDATE whatsapp_instances SET status = 'disconnected' WHERE tenant_id = $1`, [tenant_id])
      instance.status = 'disconnected'
    }

    return reply.send({ ...instance, live: { state } })
  })

  // Disconnect WhatsApp
  app.post('/disconnect', async (request, reply) => {
    const { tenant_id } = request.user

    const { rows: [instance] } = await db.query(
      'SELECT instance_name FROM whatsapp_instances WHERE tenant_id = $1',
      [tenant_id]
    )

    if (instance) {
      await evolutionDeleteInstance(instance.instance_name)
    }

    await db.query(
      `UPDATE whatsapp_instances SET status = 'disconnected', phone_number = NULL WHERE tenant_id = $1`,
      [tenant_id]
    )
    await redis.del(`whatsapp:qr:${tenant_id}`)
    return reply.send({ disconnected: true })
  })
}
