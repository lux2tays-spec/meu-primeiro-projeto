import fp from 'fastify-plugin'
import { db } from '../lib/db'

// planGuard — blocks tenant-scoped requests when the tenant is suspended,
// cancelled, or its trial has expired. Use as a preHandler AFTER authenticate.
// Root users (tenant_id null) bypass. Read-only GET requests are allowed even
// when blocked, so owners can still see their data and re-subscribe; mutations
// are rejected with 402.

const planGuardPlugin = fp(async (app) => {
  app.decorate('planGuard', async (request: any, reply: any) => {
    const { tenant_id, role } = request.user ?? {}
    if (role === 'root' || !tenant_id) return

    const { rows: [tenant] } = await db.query(
      'SELECT status, trial_ends_at FROM tenants WHERE id = $1',
      [tenant_id]
    )
    if (!tenant) return reply.status(404).send({ error: 'Tenant não encontrado' })

    const blocked =
      tenant.status === 'suspended' ||
      tenant.status === 'cancelled' ||
      (tenant.status === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at) < new Date())

    if (blocked && request.method !== 'GET') {
      return reply.status(402).send({
        error: 'subscription_required',
        message: 'Seu período de teste terminou ou a assinatura está inativa. Reative para continuar.',
      })
    }
  })
})

export { planGuardPlugin }
