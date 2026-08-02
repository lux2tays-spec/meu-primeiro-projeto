import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'
import { getPaymentConfig } from '../lib/paymentConfig'
import { createPreapproval, cancelPreapproval } from '../services/mercadopago'
import { applyPreapproval } from '../lib/subscriptionState'

// Tenant-facing subscription endpoints. Only `authenticate` (NOT planGuard) —
// an expired-trial tenant must be able to reach checkout to reactivate.

// PAY-1: mapeia os códigos de recusa do Mercado Pago (status_detail / mensagens
// de erro que chegam em result.reason) para orientações específicas em pt-BR.
// A ordem importa: padrões mais específicos primeiro. O texto cru do MP nunca
// vai na resposta HTTP — só nos logs.
const MP_DECLINE_MESSAGES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /insufficient_amount/i,
    message: 'Cartão sem limite disponível para esta compra. Libere limite com seu banco ou use outro cartão.' },
  { pattern: /bad_filled_security_code|security_code/i,
    message: 'Código de segurança (CVV) incorreto. Confira o código no verso do cartão e tente novamente.' },
  { pattern: /bad_filled_date/i,
    message: 'Data de validade incorreta. Confira o mês e o ano de vencimento do cartão.' },
  { pattern: /bad_filled_card_number/i,
    message: 'Número do cartão inválido. Confira os dígitos digitados e tente novamente.' },
  { pattern: /bad_filled_other/i,
    message: 'Alguns dados do cartão parecem incorretos. Revise as informações e tente novamente.' },
  { pattern: /call_for_authorize/i,
    message: 'Seu banco precisa autorizar este pagamento. Ligue para o banco, autorize a compra e tente novamente.' },
  { pattern: /high_risk|blacklist/i,
    message: 'O pagamento não foi autorizado por segurança pelo banco emissor. Tente outro cartão ou fale com seu banco.' },
  { pattern: /card_disabled/i,
    message: 'Este cartão está bloqueado ou desativado. Fale com seu banco para ativá-lo ou use outro cartão.' },
  { pattern: /expired_card|card_expired/i,
    message: 'Este cartão está vencido. Use outro cartão para continuar.' },
  { pattern: /duplicated_payment/i,
    message: 'Identificamos um pagamento repetido com este cartão. Aguarde alguns minutos antes de tentar novamente.' },
  { pattern: /max_attempts/i,
    message: 'Limite de tentativas atingido para este cartão. Aguarde alguns minutos ou use outro cartão.' },
  { pattern: /cc_rejected/i, // catch-all para qualquer outro cc_rejected_*
    message: 'O cartão foi recusado pelo banco emissor. Tente outro cartão ou fale com seu banco para entender o motivo.' },
]

function mapCardDecline(reason: string | undefined | null): string | null {
  if (!reason) return null
  for (const { pattern, message } of MP_DECLINE_MESSAGES) {
    if (pattern.test(reason)) return message
  }
  return null
}

export const subscriptionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // Active plans (from platform_plans, managed by Root Admin). Inclui o desconto
  // anual e o preço anual já calculado (mensal×12×(1−desc/100)) por conveniência.
  app.get('/plans', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT slug, name, description, price_cents, annual_discount_pct, max_agendas, max_users, trial_days, features
       FROM platform_plans WHERE is_active = TRUE ORDER BY sort_order, price_cents`
    )
    const plans = rows.map((p: any) => ({
      ...p,
      annual_price_cents: Math.round(p.price_cents * 12 * (1 - (p.annual_discount_pct || 0) / 100)),
    }))
    return reply.send(plans)
  })

  // Histórico de cobranças da assinatura (para o App e a Web).
  app.get('/payments', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows } = await db.query(
      `SELECT mp_payment_id, plan, amount_cents, status, paid_at
       FROM subscription_payments WHERE tenant_id = $1
       ORDER BY paid_at DESC NULLS LAST, created_at DESC LIMIT 24`,
      [tenant_id]
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
    const { plan, card_token_id, billing_period } = request.body as { plan?: string; card_token_id?: string; billing_period?: string }
    if (!plan) return reply.status(400).send({ error: 'Plano não informado' })
    const period: 'monthly' | 'annual' = billing_period === 'annual' ? 'annual' : 'monthly'

    const { rows: [planRow] } = await db.query(
      'SELECT slug, name, price_cents, annual_discount_pct FROM platform_plans WHERE slug = $1 AND is_active = TRUE',
      [plan]
    )
    if (!planRow) return reply.status(404).send({ error: 'Plano não encontrado' })
    if (planRow.price_cents <= 0) return reply.status(400).send({ error: 'Este plano é gratuito e não requer pagamento' })

    // Valor a cobrar por ciclo: mensal = price_cents; anual = 12×(1−desconto).
    const chargeCents = period === 'annual'
      ? Math.round(planRow.price_cents * 12 * (1 - (planRow.annual_discount_pct || 0) / 100))
      : planRow.price_cents

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
      priceBrl: chargeCents / 100,
      payerEmail: user?.email ?? 'sem-email@aiconfirma.com.br',
      backUrl,
      cardTokenId: card_token_id,
      billingPeriod: period,
    })

    if (!result.ok) {
      request.log.error({ tenant_id, plan: planRow.slug, reason: result.reason }, 'Mercado Pago checkout failed')
      // PAY-1: known decline codes get a specific, actionable pt-BR message.
      // Other card-ish rejections nudge the user to try another card; generic
      // failures get the neutral message.
      const specific = mapCardDecline(result.reason)
      const cardIssue = specific !== null || /card|tarjeta|cartão|payment|token|cvv|security|amount|invalid/i.test(result.reason)
      // The raw MP reason goes only to logs (above) — never in the HTTP response.
      return reply.status(cardIssue ? 402 : 502).send({
        error: specific ?? (cardIssue
          ? 'Não conseguimos aprovar este cartão. Verifique os dados ou tente outro cartão.'
          : 'Não foi possível iniciar o pagamento. Tente novamente.'),
      })
    }

    // Transparent flow: the subscription is already authorized — reflect it now
    // so the UI updates immediately (the webhook will also confirm, idempotently).
    if (card_token_id) {
      if (result.status !== 'authorized') {
        request.log.error({ tenant_id, plan: planRow.slug, status: result.status }, 'transparent checkout not authorized')
        // PAY-1: o status do MP pode carregar o motivo da recusa (cc_rejected_*)
        return reply.status(402).send({
          error: mapCardDecline(result.status)
            ?? 'Não conseguimos aprovar este cartão. Verifique os dados ou tente outro cartão.',
        })
      }
      await applyPreapproval({
        tenantId: tenant_id!,
        plan: planRow.slug,
        mpSubscriptionId: result.id,
        mpStatus: result.status,
        billingPeriod: period,
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
      `SELECT plan, status, mp_subscription_id, next_billing_date, billing_period FROM subscriptions WHERE tenant_id = $1`,
      [tenant_id]
    )
    return reply.send(sub ?? null)
  })
}
