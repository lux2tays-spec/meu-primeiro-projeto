import Fastify from 'fastify'
import { ZodError } from 'zod'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'

import { db } from './lib/db'
import { redis } from './lib/redis'
import { authPlugin } from './plugins/auth'
import { planGuardPlugin } from './plugins/planGuard'
import { securityHeadersPlugin } from './plugins/securityHeaders'
import { authRoutes } from './routes/auth'
import { googleRoutes } from './routes/google'
import { tenantRoutes } from './routes/tenants'
import { appointmentRoutes } from './routes/appointments'
import { whatsappRoutes } from './routes/whatsapp'
import { webhookRoutes } from './routes/webhooks'
import { agentRoutes } from './routes/agent'
import { rootRoutes } from './routes/root'
import { affiliateRoutes } from './routes/affiliate'
import { financeiroRoutes } from './routes/financeiro'
import { subscriptionRoutes } from './routes/subscription'
import { startReminderJob } from './jobs/reminders'
import { startSubscriptionEnforcer } from './jobs/subscriptionEnforcer'

// Validate required environment variables at boot — fail fast before binding to port
const REQUIRED_ENVS = ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL', 'ANTHROPIC_API_KEY'] as const
for (const key of REQUIRED_ENVS) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}
if (process.env.JWT_SECRET!.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters')
}

const isProd = process.env.NODE_ENV === 'production'

// In production the API should sit behind a TLS reverse proxy with a known
// origin allowlist. If ALLOWED_ORIGINS isn't set we warn loudly but keep
// booting (reflecting origin) so a deploy never breaks on a missing var —
// set ALLOWED_ORIGINS to harden CORS.
if (isProd && !process.env.ALLOWED_ORIGINS) {
  console.warn('[SECURITY] ALLOWED_ORIGINS not set in production — CORS is reflecting any origin. Set it to a comma-separated allowlist.')
}

// trustProxy so per-IP rate limiting and HTTPS detection work behind the proxy.
const app = Fastify({ logger: true, trustProxy: true })

async function start() {
  // CORS — restrict to known origins in production via ALLOWED_ORIGINS env
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : true
  await app.register(cors, { origin: allowedOrigins, credentials: true })

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  await app.register(securityHeadersPlugin)
  await app.register(authPlugin)
  await app.register(planGuardPlugin)

  // Global error handler — validation → 400, never expose stack traces in prod
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({ error: 'Dados inválidos', details: error.issues })
    }
    app.log.error(error)
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message })
    }
    return reply.status(500).send({ error: isProd ? 'Erro interno. Tente novamente.' : error.message })
  })

  // Public routes
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(googleRoutes)
  await app.register(webhookRoutes, { prefix: '/webhook' })

  // Tenant-scoped routes (require JWT)
  await app.register(tenantRoutes, { prefix: '/tenant' })
  await app.register(appointmentRoutes, { prefix: '/appointments' })
  await app.register(whatsappRoutes, { prefix: '/whatsapp' })
  await app.register(agentRoutes, { prefix: '/agent' })

  // Affiliate routes (any authenticated user)
  await app.register(affiliateRoutes, { prefix: '/affiliate' })

  // Financial routes (tenant-scoped)
  await app.register(financeiroRoutes, { prefix: '/financeiro' })

  // Subscription/checkout (authenticated, NOT plan-guarded — expired tenants must subscribe)
  await app.register(subscriptionRoutes, { prefix: '/subscription' })

  // Root admin routes (require role=root)
  await app.register(rootRoutes, { prefix: '/root' })

  // Real health check — verifies DB and Redis are reachable
  app.get('/health', async (_request, reply) => {
    try {
      await db.query('SELECT 1')
      await redis.ping()
      return reply.send({ ok: true })
    } catch (err) {
      app.log.error(err)
      return reply.status(503).send({ ok: false })
    }
  })

  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })

  startReminderJob()
  startSubscriptionEnforcer()
}

// Graceful shutdown — drain in-flight requests before exiting
const shutdown = async (signal: string) => {
  app.log.info(`${signal} received — shutting down`)
  await app.close()
  await db.end()
  redis.disconnect()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
