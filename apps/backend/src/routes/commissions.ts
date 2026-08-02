import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { isStaff, canManage, resolveStaffProfessionalId } from '../lib/roles'
import { capabilityGuard } from '../lib/planCapabilities'

const listQuerySchema = z.object({
  professional_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'paid']).optional(),
  from: z.string().optional(), // ISO date/datetime — filters appointment starts_at
  to: z.string().optional(),
})

// Usado tanto para pagar (pending → paid) quanto para estornar (paid → pending):
// aceita ids explícitos e/ou professional_id + período (data do agendamento).
const paySchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  professional_id: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const commissionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)
  app.addHook('preHandler', capabilityGuard('commissions'))

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

    // SAL-10/SAL-2: LEFT JOIN em appointments/customers — comissão paga com
    // appointment_id NULL (cliente/agendamento excluído, FK ON DELETE SET NULL,
    // migration 034) é histórico e precisa continuar aparecendo na lista e nos
    // totais. Obs.: filtros from/to seguem sobre a.starts_at, então omitem as
    // órfãs (não há data de agendamento para comparar).
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
         LEFT JOIN appointments a ON a.id = co.appointment_id
         JOIN professionals p ON p.id = co.professional_id
         LEFT JOIN services s ON s.id = co.service_id
         LEFT JOIN customers c ON c.id = a.customer_id
         ${where}
         ORDER BY a.starts_at DESC NULLS LAST, co.created_at DESC`,
        params
      ),
      db.query(
        `SELECT
           COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'pending'), 0)::float AS pending_amount,
           COALESCE(SUM(co.amount) FILTER (WHERE co.status = 'paid'), 0)::float    AS paid_amount,
           COUNT(*)::int AS count
         FROM commissions co
         LEFT JOIN appointments a ON a.id = co.appointment_id
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

    // SAL-2/SAL-10: sem INNER JOIN em appointments — comissão pendente com
    // appointment_id NULL (histórico órfão) também pode ser paga por ids.
    // Filtro de período usa EXISTS (só se aplica a comissões com agendamento).
    let where = `co.tenant_id = $1 AND co.status = 'pending'`
    const params: unknown[] = [user.tenant_id]
    let i = 2

    if (body.ids?.length)     { where += ` AND co.id = ANY($${i++}::uuid[])`; params.push(body.ids) }
    if (body.professional_id) { where += ` AND co.professional_id = $${i++}`; params.push(body.professional_id) }
    if (body.from || body.to) {
      let dateCond = 'a.id = co.appointment_id'
      if (body.from) { dateCond += ` AND a.starts_at >= $${i++}`; params.push(body.from) }
      if (body.to)   { dateCond += ` AND a.starts_at <= $${i++}`; params.push(body.to) }
      where += ` AND EXISTS (SELECT 1 FROM appointments a WHERE ${dateCond})`
    }

    // TODO(SAL-10): registrar quem pagou em `paid_by` (user_id do JWT) quando a
    // coluna existir — requer migration (ALTER TABLE commissions ADD COLUMN
    // paid_by UUID REFERENCES users(id)); sem migration neste escopo.
    const { rowCount } = await db.query(
      `UPDATE commissions co SET status = 'paid', paid_at = NOW()
       WHERE ${where}`,
      params
    )

    return reply.send({ paid_count: rowCount ?? 0 })
  })

  // ── Refund / estorno (owner/admin only) ────────────────────────────────────
  // SAL-10: reverte comissões pagas por engano (paid → pending). Exige ao menos
  // um critério (ids, profissional ou período) para nunca estornar tudo por
  // acidente. Mesmos filtros do /pay.
  app.post('/refund', async (request, reply) => {
    const user = request.user
    if (!canManage(user)) {
      return reply.status(403).send({ error: 'Apenas proprietário ou administrador podem estornar comissões' })
    }
    const body = paySchema.parse(request.body ?? {})
    if (!body.ids?.length && !body.professional_id && !body.from && !body.to) {
      return reply.status(400).send({ error: 'Informe quais comissões deseja estornar' })
    }

    let where = `co.tenant_id = $1 AND co.status = 'paid'`
    const params: unknown[] = [user.tenant_id]
    let i = 2

    if (body.ids?.length)     { where += ` AND co.id = ANY($${i++}::uuid[])`; params.push(body.ids) }
    if (body.professional_id) { where += ` AND co.professional_id = $${i++}`; params.push(body.professional_id) }
    if (body.from || body.to) {
      let dateCond = 'a.id = co.appointment_id'
      if (body.from) { dateCond += ` AND a.starts_at >= $${i++}`; params.push(body.from) }
      if (body.to)   { dateCond += ` AND a.starts_at <= $${i++}`; params.push(body.to) }
      where += ` AND EXISTS (SELECT 1 FROM appointments a WHERE ${dateCond})`
    }

    const { rowCount } = await db.query(
      `UPDATE commissions co SET status = 'pending', paid_at = NULL
       WHERE ${where}`,
      params
    )

    return reply.send({ refunded_count: rowCount ?? 0 })
  })
}
