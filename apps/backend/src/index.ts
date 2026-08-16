import Fastify from 'fastify'
import { ZodError, type ZodIssue } from 'zod'
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
import { supportRoutes } from './routes/support'
import { rootRoutes } from './routes/root'
import { affiliateRoutes } from './routes/affiliate'
import { financeiroRoutes } from './routes/financeiro'
import { commissionRoutes } from './routes/commissions'
import { subscriptionRoutes } from './routes/subscription'
import { brandingRoutes } from './routes/branding'
import { notificationRoutes } from './routes/notifications'
import { resumePendingBotFlushes } from './services/botDispatcher'
import { startReminderJob } from './jobs/reminders'
import { startAppointmentReminders } from './jobs/appointmentReminders'
import { startSubscriptionEnforcer } from './jobs/subscriptionEnforcer'
import { startWhatsappReconciler } from './jobs/whatsappReconciler'
import { startTrialEndingNotifier } from './jobs/trialEndingNotifier'
import { startServiceCompletionNotifier } from './jobs/serviceCompletion'
import { startBirthdayReminderJob } from './jobs/birthdayReminders'
import { startMessageLimitWarner } from './jobs/messageLimitWarner'
import { startMpCancellationRetry } from './jobs/mpCancellationRetry'

// Validate required environment variables at boot — fail fast before binding to port
const REQUIRED_ENVS = ['JWT_SECRET', 'DATABASE_URL', 'REDIS_URL', 'ANTHROPIC_API_KEY'] as const
for (const key of REQUIRED_ENVS) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}
if (process.env.JWT_SECRET!.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters')
}

const isProd = process.env.NODE_ENV === 'production'

// CFG-13: erro de validação com mensagem amigável em pt-BR por CAMPO, em vez do
// "Dados inválidos" genérico — o usuário precisa saber O QUE corrigir. Mapeia o
// primeiro issue do Zod (campo + motivo); os issues completos seguem em
// `details` para depuração/uso programático.
const FIELD_LABELS: Record<string, string> = {
  name: 'nome', last_name: 'sobrenome', email: 'e-mail', password: 'senha',
  phone: 'telefone', business_name: 'nome do estabelecimento', title: 'título',
  description: 'descrição', amount: 'valor', price: 'preço',
  duration_minutes: 'duração (minutos)', date: 'data', starts_at: 'data/hora',
  from: 'data inicial', to: 'data final', time: 'hora', status: 'status',
  role: 'função', message: 'mensagem', reason: 'motivo',
  customer_id: 'cliente', professional_id: 'profissional', service_id: 'serviço',
  start_time: 'horário de abertura', end_time: 'horário de fechamento',
  contact_email: 'e-mail de contato', contact_phone: 'telefone de contato',
  responsible_name: 'nome do responsável', notes: 'observações',
}

function friendlyValidationMessage(issue: ZodIssue | undefined): string {
  if (!issue) return 'Dados inválidos. Confira as informações e tente novamente.'
  const rawField = issue.path.length ? String(issue.path[issue.path.length - 1]) : ''
  const field = FIELD_LABELS[rawField] ?? rawField
  const label = field ? `O campo "${field}"` : 'Um dos campos'

  switch (issue.code) {
    case 'invalid_type':
      if (issue.received === 'undefined' || issue.received === 'null') return `${label} é obrigatório.`
      return `${label} está com um formato inválido.`
    case 'too_small':
      if (issue.type === 'string') {
        return Number(issue.minimum) <= 1
          ? `${label} é obrigatório.`
          : `${label} é muito curto (mínimo de ${issue.minimum} caracteres).`
      }
      if (issue.type === 'number') return `${label} deve ser no mínimo ${issue.minimum}.`
      if (issue.type === 'array') return `${label} precisa de pelo menos ${issue.minimum} item(ns).`
      return `${label} é muito pequeno.`
    case 'too_big':
      if (issue.type === 'string') return `${label} é muito longo (máximo de ${issue.maximum} caracteres).`
      if (issue.type === 'number') return `${label} deve ser no máximo ${issue.maximum}.`
      return `${label} é muito grande.`
    case 'invalid_string':
      if (issue.validation === 'email') return `${label} não é um e-mail válido.`
      if (issue.validation === 'uuid') return `${label} é inválido.`
      if (issue.validation === 'datetime') return `${label} não é uma data/hora válida.`
      return `${label} está com um formato inválido.`
    case 'invalid_enum_value':
      return `${label} tem um valor não permitido.`
    default:
      // Zod .refine() custom messages are already written in pt-BR in the
      // schemas (e.g. "O horário de abertura deve ser antes do fechamento").
      if (issue.code === 'custom' && issue.message) return issue.message
      return `${label} é inválido. Confira e tente novamente.`
  }
}

// In production the API should sit behind a TLS reverse proxy with a known
// origin allowlist. If ALLOWED_ORIGINS isn't set we warn loudly but keep
// booting (reflecting origin) so a deploy never breaks on a missing var —
// set ALLOWED_ORIGINS to harden CORS.
if (isProd && !process.env.ALLOWED_ORIGINS) {
  console.warn('[SECURITY] ALLOWED_ORIGINS not set in production — CORS is reflecting any origin. Set it to a comma-separated allowlist.')
}

// trustProxy so per-IP rate limiting and HTTPS detection work behind the proxy.
// Logger redaction: secrets and PII must never reach the logs (pino redact).
const app = Fastify({
  logger: {
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.apikey',
        'req.headers.cookie',
        'password',
        'password_hash',
        'mp_access_token',
        'mp_webhook_secret',
        'api_key',
        'token',
        'id_token',
        'card_token_id',
        'access_token',
        'refresh_token',
        'phone',
        'customer_phone',
      ],
      censor: '[REDACTED]',
    },
  },
  trustProxy: true,
})

async function start() {
  // CORS — restrict to known origins in production via ALLOWED_ORIGINS env
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : true
  // exposedHeaders: the admin panel reads Content-Disposition to name CSV exports.
  await app.register(cors, { origin: allowedOrigins, credentials: true, exposedHeaders: ['Content-Disposition'] })

  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(jwt, { secret: process.env.JWT_SECRET! })
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

  await app.register(securityHeadersPlugin)
  await app.register(authPlugin)
  await app.register(planGuardPlugin)

  // Global error handler — validation → 400, never expose stack traces in prod
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      // CFG-13: primeira falha traduzida para o usuário; issues completos em details.
      return reply.status(400).send({ error: friendlyValidationMessage(error.issues[0]), details: error.issues })
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

  // Public branding (no auth) — apps fetch name/colors/logo at runtime
  await app.register(brandingRoutes)

  // Tenant-scoped routes (require JWT)
  await app.register(tenantRoutes, { prefix: '/tenant' })
  await app.register(appointmentRoutes, { prefix: '/appointments' })
  await app.register(whatsappRoutes, { prefix: '/whatsapp' })
  await app.register(agentRoutes, { prefix: '/agent' })
  await app.register(notificationRoutes, { prefix: '/notifications' })
  await app.register(supportRoutes, { prefix: '/support' })

  // Affiliate routes (any authenticated user)
  await app.register(affiliateRoutes, { prefix: '/affiliate' })

  // Financial routes (tenant-scoped)
  await app.register(financeiroRoutes, { prefix: '/financeiro' })

  // Commissions per professional (tenant-scoped; staff see only their own)
  await app.register(commissionRoutes, { prefix: '/commissions' })

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

  // Um deploy/restart no meio da janela de debounce não pode descartar mensagens:
  // reagenda o flush de todo buffer bot:buf:* que sobreviveu no Redis.
  resumePendingBotFlushes().catch((err) => app.log.error({ err }, 'resumePendingBotFlushes falhou'))

  startReminderJob()
  startAppointmentReminders()
  startSubscriptionEnforcer()
  startWhatsappReconciler()
  startTrialEndingNotifier()
  startServiceCompletionNotifier()
  startBirthdayReminderJob()
  startMessageLimitWarner()
  startMpCancellationRetry()
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
