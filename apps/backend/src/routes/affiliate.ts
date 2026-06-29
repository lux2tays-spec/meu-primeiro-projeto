import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'

export const affiliateRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // Get the affiliate record for the logged-in user (auto-creates if missing)
  app.get('/me', async (request, reply) => {
    const { user_id } = request.user

    const { rows: [user] } = await db.query(
      'SELECT email, name FROM users WHERE id = $1',
      [user_id]
    )

    let { rows: [affiliate] } = await db.query(
      'SELECT * FROM affiliates WHERE user_id = $1',
      [user_id]
    )

    if (!affiliate) {
      const code = Math.random().toString(36).substring(2, 8).toUpperCase()
      const { rows: [created] } = await db.query(
        'INSERT INTO affiliates (user_id, referral_code) VALUES ($1, $2) RETURNING *',
        [user_id, code]
      )
      affiliate = created
    }

    const { rows: referrals } = await db.query(
      'SELECT id, commission_brl, paid_at FROM affiliate_referrals WHERE affiliate_id = $1',
      [affiliate.id]
    )

    const total_referrals = referrals.length
    const pending_count = referrals.filter((r) => !r.paid_at).length
    const pending_earnings = referrals.filter((r) => !r.paid_at).reduce((s, r) => s + Number(r.commission_brl), 0)

    return reply.send({
      ...affiliate,
      name: user?.name,
      email: user?.email,
      total_referrals,
      pending_count,
      pending_earnings,
    })
  })
}
