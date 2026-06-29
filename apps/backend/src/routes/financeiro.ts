import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'

const paymentLinkSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
})

export const financeiroRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // ── Resumo financeiro ─────────────────────────────────────────────────────
  app.get('/resumo', async (request, reply) => {
    const { tenant_id } = request.user
    const { month, year } = request.query as { month?: string; year?: string }

    const now = new Date()
    const y = Number(year ?? now.getFullYear())
    const m = Number(month ?? now.getMonth() + 1)
    const start = new Date(y, m - 1, 1).toISOString()
    const end   = new Date(y, m, 1).toISOString()

    const { rows: [totals] } = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed') AS total_vendas,
         COALESCE(SUM(s.price) FILTER (WHERE a.status = 'completed'), 0) AS receita_total,
         COUNT(*) FILTER (WHERE status = 'pending' OR status = 'confirmed') AS agendamentos_abertos
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       WHERE a.tenant_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3`,
      [tenant_id, start, end]
    )

    return reply.send({
      mes: m,
      ano: y,
      total_vendas: Number(totals.total_vendas),
      receita_total: Number(totals.receita_total),
      agendamentos_abertos: Number(totals.agendamentos_abertos),
    })
  })

  // ── Lista de vendas (appointments completed) ──────────────────────────────
  app.get('/vendas', async (request, reply) => {
    const { tenant_id } = request.user
    const { month, year, page = '1' } = request.query as { month?: string; year?: string; page?: string }

    const now = new Date()
    const y = Number(year ?? now.getFullYear())
    const m = Number(month ?? now.getMonth() + 1)
    const start  = new Date(y, m - 1, 1).toISOString()
    const end    = new Date(y, m, 1).toISOString()
    const offset = (Number(page) - 1) * 50

    const { rows } = await db.query(
      `SELECT
         a.id,
         a.starts_at,
         a.status,
         a.notes,
         c.name  AS cliente_nome,
         c.phone AS cliente_telefone,
         s.name  AS servico_nome,
         s.price AS valor,
         p.name  AS profissional_nome
       FROM appointments a
       JOIN customers    c ON c.id = a.customer_id
       JOIN services     s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id
       WHERE a.tenant_id = $1 AND a.status = 'completed'
         AND a.starts_at >= $2 AND a.starts_at < $3
       ORDER BY a.starts_at DESC
       LIMIT 50 OFFSET $4`,
      [tenant_id, start, end, offset]
    )

    return reply.send(rows)
  })

  // ── Links de pagamento ────────────────────────────────────────────────────
  app.get('/payment-links', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows } = await db.query(
      'SELECT * FROM payment_links WHERE tenant_id = $1 AND active = TRUE ORDER BY created_at DESC',
      [tenant_id]
    )
    return reply.send(rows)
  })

  app.post('/payment-links', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = paymentLinkSchema.parse(request.body)

    // Fetch tenant MP token
    const { rows: [tenant] } = await db.query(
      'SELECT mp_access_token FROM tenants WHERE id = $1',
      [tenant_id]
    )

    let mp_id: string | null = null
    let mp_url: string | null = null

    if (tenant?.mp_access_token) {
      try {
        const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tenant.mp_access_token}`,
          },
          body: JSON.stringify({
            items: [{
              title: body.title,
              description: body.description ?? '',
              quantity: 1,
              currency_id: 'BRL',
              unit_price: body.amount,
            }],
            back_urls: {
              success: `${process.env.TENANT_WEB_URL}/financeiro`,
              failure: `${process.env.TENANT_WEB_URL}/financeiro`,
            },
          }),
        })
        if (mpRes.ok) {
          const mpData = await mpRes.json() as { id: string; init_point: string }
          mp_id  = mpData.id
          mp_url = mpData.init_point
        }
      } catch {
        // MP error: still save the link without mp_url
      }
    }

    const { rows: [link] } = await db.query(
      `INSERT INTO payment_links (tenant_id, title, description, amount, mp_id, mp_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenant_id, body.title, body.description ?? null, body.amount, mp_id, mp_url]
    )

    return reply.status(201).send(link)
  })

  app.delete<{ Params: { id: string } }>('/payment-links/:id', async (request, reply) => {
    const { tenant_id } = request.user
    await db.query(
      'UPDATE payment_links SET active = FALSE WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    return reply.send({ deleted: true })
  })
}
