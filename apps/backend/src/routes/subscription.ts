import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'
import { getPaymentConfig } from '../lib/paymentConfig'
import { createPreapproval } from '../services/mercadopago'

// Tenant-facing subscription endpoints. Only `authenticate` (NOT planGuard) —
// an expired-trial tenant must be able to reach checkout to reactivate.

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // Active plans (from platform_plans, managed by Root Admin)
  app.get('/plans', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT slug, name, description, price_cents, max_agendas, max_users, trial_days, features
       FROM platform_plans WHERE is_active = TRUE ORDER BY sort_order, price_cents`
    )
    return reply.send(rows)
  })

  // Create a checkout for a paid plan → returns the provider checkout URL
  app.post('/checkout', async (request, reply) => {
    const { tenant_id, user_id } = request.user
    const { plan } = request.body as { plan?: string }
    if (!plan) return reply.status(400).send({ error: 'Plano não informado' })

    const { rows: [planRow] } = await db.query(
      'SELECT slug, name, price_cents FROM platform_plans WHERE slug = $1 AND is_active = TRUE',
      [plan]
    )
    if (!planRow) return reply.status(404).send({ error: 'Plano não encontrado' })
    if (planRow.price_cents <= 0) return reply.status(400).send({ error: 'Este plano é gratuito e não requer pagamento' })

    const cfg = await getPaymentConfig()
    if (cfg.provider !== 'mercadopago' || !cfg.mp_access_token) {
      return reply.status(503).send({ error: 'Pagamentos ainda não foram configurados pelo administrador.' })
    }

    // Mercado Pago rejects non-HTTPS back_url ("Invalid value for back_url"), so
    // never fall back to a localhost/http default — that's a platform-config issue.
    const backUrl = (cfg.back_url ?? '').trim()
    if (!backUrl.startsWith('https://')) {
      request.log.error({ tenant_id, back_url: backUrl }, 'checkout blocked: payment back_url missing or not HTTPS')
      return reply.status(503).send({
        error: 'Pagamentos não configurados: defina uma URL de retorno HTTPS no painel de Pagamentos.',
      })
    }

    const { rows: [user] } = await db.query('SELECT email FROM users WHERE id = $1', [user_id])

    const result = await createPreapproval(cfg, {
      tenantId: tenant_id!,
      plan: planRow.slug,
      planName: planRow.name,
      priceBrl: planRow.price_cents / 100,
      payerEmail: user?.email ?? 'sem-email@agendabot.com.br',
      backUrl,
    })

    if (!result.ok) {
      request.log.error({ tenant_id, plan: planRow.slug, reason: result.reason }, 'Mercado Pago checkout failed')
      return reply.status(502).send({
        error: 'Não foi possível iniciar o pagamento. Tente novamente.',
        detail: result.reason, // MP failure reason, for platform-admin diagnosis
      })
    }
    return reply.send({ init_point: result.init_point })
  })

  // Current subscription (if any)
  app.get('/me', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [sub] } = await db.query(
      `SELECT plan, status, mp_subscription_id, next_billing_date FROM subscriptions WHERE tenant_id = $1`,
      [tenant_id]
    )
    return reply.send(sub ?? null)
  })
}
