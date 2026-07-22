import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { isStaff, canManage, resolveStaffProfessionalId } from '../lib/roles'

const listQuerySchema = z.object({
  professional_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'paid']).optional(),
  from: z.string().optional(), // ISO date/datetime — filters appointment starts_at
  to: z.string().optional(),
})

const paySchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  professional_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)

  // ── List commissions + totals ───────────────────────────────────────────────
  // Owner/admin: all professionals (optional professional_id filter).
  // Staff: FORCED to their own linked professional; no link → empty list.
  app.get('/', async (request, reply) => {
    const user = request.user
    const q = listQuerySchema.parse(request.query)

    let professionalId = q.professional_id ?? null
    if (isStaff(user)) {
      const own = await resolveStaffProfessionalId(user)
      if (!own) {
        return reply.send({
          data: [],
          totals: { pending_amount: 0, paid_amount: 0, count: 0 },
        })
      }
      professionalId = own // staff can never widen the filter
    }

    let where = 'WHERE co.tenant_id = $1'
    const params: unknown[] = [user.tenant_id]
    let i = 2

    if (professionalId) { where += ` AND co.professional_id = $${i++}`; params.push(professionalId) }
    if (q.status)       { where += ` AND co.status = $${i++}`; params.push(q.status) }
    if (q.from)         { where += ` AND a.starts_at >= $${i++}`; params.push(q.from) }
    if (q.to)           { where += ` AND a.starts_at <= $${i++}`; params.push(q.to) }

    const [rows, totals] = await Promise.all([
      db.query(
        `SELECT co.id, co.appointment_id, co.professional_id, co.service_id,
                co.service_price, co.commission_type, co.commission_value,
                co.amount, co.status, co.created_at, co.paid_at,
                p.name AS professional_name,
                s.name AS service_name,
                c.name AS customer_name, c.last_name AS customer_last_name,
                a.starts_at
         FROM commissions co
         JOIN appointments a ON a.id = co.appointment_id
         JOIN professionals p ON p.id = co.professional_id
         LEFT JOIN services s ON s.id = co.service_id
         JOIN customers c ON c.id = a.customer_id
         ${where}
         ORDER BY a.starts_at DESC`,
        params
      ),
      db.query(
        `SELECT
           COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'pending'), 0)::float AS pending_amount,
           COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0)::float    AS paid_amount,
           COUNT(*)::int AS count
         FROM commissions co
         JOIN appointments a ON a.id = co.appointment_id
         ${where}`,
        params
      ),
    ])

    return reply.send({ data: rows.rows, totals: totals.rows[0] })
  })

  // ── Pay pending commissions (owner/admin only) ──────────────────────────────
  // Marks matching *pending* commissions of this tenant as paid.
  // Filters: explicit ids, and/or professional_id + appointment date range.
  app.post('/pay', async (request, reply) => {
    const user = request.user
    if (!canManage(user)) {
      return reply.status(403).send({ error: 'Apenas proprietário ou administrador podem pagar comissões' })
    }
    const body = paySchema.parse(request.body ?? {})

    let where = `co.tenant_id = $1 AND co.status = 'pending'`
    const params: unknown[] = [user.tenant_id]
    let i = 2

    if (body.ids?.length)     { where += ` AND co.id = ANY($${i++}::uuid[])`; params.push(body.ids) }
    if (body.professional_id) { where += ` AND co.professional_id = $${i++}`; params.push(body.professional_id) }
    if (body.from)            { where += ` AND a.starts_at >= $${i++}`; params.push(body.from) }
    if (body.to)              { where += ` AND a.starts_at <= $${i++}`; params.push(body.to) }

    const { rowCount } = await db.query(
      `UPDATE commissions co SET status = 'paid', paid_at = NOW()
       FROM appointments a
       WHERE a.id = co.appointment_id AND ${where}`,
      params
    )

    return reply.send({ paid_count: rowCount ?? 0 })
  })
}
