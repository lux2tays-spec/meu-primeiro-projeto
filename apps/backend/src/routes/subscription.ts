import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'
import { getPaymentConfig } from '../lib/paymentConfig'
import { createPreapproval, cancelPreapproval } from '../services/mercadopago'
import { applyPreapproval } from '../lib/subscriptionState'

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

  // Public info the transparent-checkout card form needs: the platform's MP
  // public key (safe to expose) and whether subscriptions are available at all.
  // The public key is only returned when payments are fully configured, so the
  // client can decide whether to render the card form.
  app.get('/payment-info', async (_request, reply) => {
    const cfg = await getPaymentConfig()
    const backUrlOk = (cfg.back_url ?? '').trim().startsWith('https://')
    const available = cfg.provider === 'mercadopago' && !!cfg.mp_access_token && backUrlOk && !!cfg.mp_public_key
    return reply.send({
      available,
      public_key: available ? cfg.mp_public_key : null,
    })
  })

  // Create a checkout for a paid plan.
  //  - With `card_token_id` (transparent): charges immediately, activates the
  //    subscription and returns { status: 'authorized' } — no redirect.
  //  - Without it (fallback): returns { init_point } for the hosted MP page.
  app.post('/checkout', async (request, reply) => {
    const { tenant_id, user_id } = request.user
    const { plan, card_token_id } = request.body as { plan?: string; card_token_id?: string }
    if (!plan) return reply.status(400).send({ error: 'Plano não informado' })

    const { rows: [planRow] } = await db.query(
      'SELECT slug, name, price_cents FROM platform_plans WHERE slug = $1 AND is_active = TRUE',
      [plan]
    )
    if (!planRow) return reply.status(404).send({ error: 'Plano não encontrado' })
    if (planRow.price_cents <= 0) return reply.status(400).send({ error: 'Este plano é gratuito e não requer pagamento' })

    // Payment availability is a PLATFORM-side concern (the platform owner's
    // Mercado Pago config). The tenant can't fix it and must never see the
    // technical reason — return a generic, friendly message and log the detail.
    const UNAVAILABLE_MSG = 'As assinaturas estão temporariamente indisponíveis. Tente novamente mais tarde ou fale com o suporte.'

    const cfg = await getPaymentConfig()
    if (cfg.provider !== 'mercadopago' || !cfg.mp_access_token) {
      request.log.error({ tenant_id }, 'checkout blocked: platform payment provider not configured')
      return reply.status(503).send({ error: UNAVAILABLE_MSG })
    }

    // Mercado Pago rejects non-HTTPS back_url ("Invalid value for back_url"), so
    // never fall back to a localhost/http default — that's a platform-config issue.
    const backUrl = (cfg.back_url ?? '').trim()
    if (!backUrl.startsWith('https://')) {
      request.log.error({ tenant_id, back_url: backUrl }, 'checkout blocked: payment back_url missing or not HTTPS')
      return reply.status(503).send({ error: UNAVAILABLE_MSG })
    }

    const { rows: [user] } = await db.query('SELECT email FROM users WHERE id = $1', [user_id])

    const result = await createPreapproval(cfg, {
      tenantId: tenant_id!,
      plan: planRow.slug,
      planName: planRow.name,
      priceBrl: planRow.price_cents / 100,
      payerEmail: user?.email ?? 'sem-email@agendabot.com.br',
      backUrl,
      cardTokenId: card_token_id,
    })

    if (!result.ok) {
      request.log.error({ tenant_id, plan: planRow.slug, reason: result.reason }, 'Mercado Pago checkout failed')
      // Card-specific rejections (declined, invalid data) should nudge the user
      // to try another card; generic failures get the neutral message.
      const cardIssue = /card|tarjeta|cartão|payment|token|cvv|security|amount|invalid/i.test(result.reason)
      // The raw MP reason goes only to logs (above) — never in the HTTP response.
      return reply.status(cardIssue ? 402 : 502).send({
        error: cardIssue
          ? 'Não conseguimos aprovar este cartão. Verifique os dados ou tente outro cartão.'
          : 'Não foi possível iniciar o pagamento. Tente novamente.',
      })
    }

    // Transparent flow: the subscription is already authorized — reflect it now
    // so the UI updates immediately (the webhook will also confirm, idempotently).
    if (card_token_id) {
      if (result.status !== 'authorized') {
        request.log.error({ tenant_id, plan: planRow.slug, status: result.status }, 'transparent checkout not authorized')
        return reply.status(402).send({
          error: 'Não conseguimos aprovar este cartão. Verifique os dados ou tente outro cartão.',
        })
      }
      await applyPreapproval({
        tenantId: tenant_id!,
        plan: planRow.slug,
        mpSubscriptionId: result.id,
        mpStatus: result.status,
      })
      return reply.send({ status: 'authorized' })
    }

    return reply.send({ init_point: result.init_point })
  })

  // Cancel the current subscription. Cancels the preapproval on Mercado Pago
  // first; only on MP success do we reflect it locally (tenant drops to
  // free/cancelled immediately — the webhook will also confirm, idempotently).
  app.post('/cancel', async (request, reply) => {
    const { tenant_id } = request.user

    const { rows: [sub] } = await db.query(
      `SELECT plan, status, mp_subscription_id FROM subscriptions WHERE tenant_id = $1`,
      [tenant_id]
    )
    if (!sub || !sub.mp_subscription_id || sub.status === 'cancelled') {
      return reply.status(400).send({ error: 'Você não tem uma assinatura ativa.' })
    }

    const cfg = await getPaymentConfig()
    const result = await cancelPreapproval(cfg, sub.mp_subscription_id)

    if (!result.ok) {
      // The raw MP reason goes only to logs — never in the HTTP response.
      request.log.error({ tenant_id, reason: result.reason }, 'Mercado Pago subscription cancel failed')
      return reply.status(502).send({ error: 'Não foi possível cancelar agora. Tente novamente ou fale com o suporte.' })
    }

    await applyPreapproval({
      tenantId: tenant_id!,
      plan: sub.plan,
      mpSubscriptionId: sub.mp_subscription_id,
      mpStatus: 'cancelled',
    })

    return reply.send({ ok: true })
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
