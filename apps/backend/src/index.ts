import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'

import { db } from './lib/db'
import { redis } from './lib/redis'
import { authPlugin } from './plugins/auth'
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
import { startReminderJob } from './jobs/reminders'

const app = Fastify({ logger: true })

async function start() {
  await app.register(cors, { origin: true })
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }) // 10 MB

  await app.register(authPlugin)

  // Public routes
  await app.register(authRoutes, { prefix: '/auth' })
  await app.register(googleRoutes)              // mounts /auth/google + /google-calendar/*
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

  // Root admin routes (require role=root)
  await app.register(rootRoutes, { prefix: '/root' })

  app.get('/health', async () => ({ ok: true }))

  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })

  startReminderJob()
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
