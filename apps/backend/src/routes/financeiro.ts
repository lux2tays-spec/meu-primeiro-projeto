import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { decrypt } from '../lib/crypto'

const paymentLinkSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
})

// SAL-3: os limites do mês são montados no fuso do negócio (America/Sao_Paulo),
// nunca no fuso do servidor — uma venda às 22h de 31/07 em SP pertence a julho,
// mesmo que em UTC já seja 01/08. O SQL converte a data local para timestamptz
// com `$n::date::timestamp AT TIME ZONE 'America/Sao_Paulo'` (mesmo padrão de
// appointments.ts).
const SP_MONTH_START = `($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`
const SP_MONTH_END = `($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`

function monthBoundsSP(month?: string, year?: string): { y: number; m: number; start: string; end: string } {
  // "Agora" também no fuso de São Paulo, para o mês default correto na virada.
  const spNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const y = Number(year ?? spNow.getFullYear())
  const m = Number(month ?? spNow.getMonth() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  const start = `${y}-${pad(m)}-01`
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
  return { y, m, start, end }
}

export const financeiroRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)

  // ── Resumo financeiro ─────────────────────────────────────────────────────
  app.get('/resumo', async (request, reply) => {
    const { tenant_id, role } = request.user
    // SAL-11: staff não vê o faturamento do negócio (mesmo padrão de tenants.ts)
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { month, year } = request.query as { month?: string; year?: string }
    const { y, m, start, end } = monthBoundsSP(month, year)
    const params = [tenant_id, start, end]

    // SAL-8: além dos totais, KPIs de gestão — ticket médio, receita por
    // profissional, ranking de serviços e taxa de cancelamento do período.
    // SAL-14: receita usa COALESCE(a.price_snapshot, s.price) — o preço
    // congelado na CONCLUSÃO do agendamento (migration 037). Reajustar o preço
    // do serviço não muda mais a receita de meses passados; vendas concluídas
    // antes da migration (snapshot NULL) seguem com o preço atual, como antes.
    const [totalsRes, porProfissionalRes, porServicoRes] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE a.status = 'completed') AS total_vendas,
           COALESCE(SUM(COALESCE(a.price_snapshot, s.price)) FILTER (WHERE a.status = 'completed'), 0) AS receita_total,
           COUNT(*) FILTER (WHERE a.status = 'pending' OR a.status = 'confirmed') AS agendamentos_abertos,
           COUNT(*) FILTER (WHERE a.status = 'cancelled') AS agendamentos_cancelados,
           COUNT(*) AS total_agendamentos
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         WHERE a.tenant_id = $1 AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}`,
        params
      ),
      db.query(
        `SELECT p.id AS professional_id, p.name AS professional_nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(COALESCE(a.price_snapshot, s.price)), 0)::float AS receita
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         JOIN professionals p ON p.id = a.professional_id
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}
         GROUP BY p.id, p.name
         ORDER BY receita DESC, p.name`,
        params
      ),
      db.query(
        `SELECT s.id AS service_id, s.name AS servico_nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(COALESCE(a.price_snapshot, s.price)), 0)::float AS receita
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}
         GROUP BY s.id, s.name
         ORDER BY vendas DESC, receita DESC
         LIMIT 10`,
        params
      ),
    ])

    const totals = totalsRes.rows[0]
    const totalVendas = Number(totals.total_vendas)
    const receitaTotal = Number(totals.receita_total)
    const cancelados = Number(totals.agendamentos_cancelados)
    const totalAgendamentos = Number(totals.total_agendamentos)

    return reply.send({
      mes: m,
      ano: y,
      total_vendas: totalVendas,
      receita_total: receitaTotal,
      agendamentos_abertos: Number(totals.agendamentos_abertos),
      // SAL-8 — novos KPIs (campos aditivos; os existentes acima não mudam):
      ticket_medio: totalVendas > 0 ? Math.round((receitaTotal / totalVendas) * 100) / 100 : 0,
      agendamentos_cancelados: cancelados,
      total_agendamentos: totalAgendamentos,
      // % de agendamentos do período que foram cancelados (inclui no-show,
      // que hoje é registrado como cancelamento).
      taxa_cancelamento: totalAgendamentos > 0 ? Math.round((cancelados / totalAgendamentos) * 1000) / 10 : 0,
      receita_por_profissional: porProfissionalRes.rows,
      servicos_mais_vendidos: porServicoRes.rows,
    })
  })

  // ── Lista de vendas (appointments completed) ──────────────────────────────
  app.get('/vendas', async (request, reply) => {
    const { tenant_id, role } = request.user
    // SAL-11: staff não vê a lista de vendas do negócio
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { month, year, page = '1', limit = '50' } = request.query as {
      month?: string; year?: string; page?: string; limit?: string
    }

    const { start, end } = monthBoundsSP(month, year)
    // SAL-5: paginação real com `total` no payload, para o frontend paginar e
    // conferir a soma com o KPI de receita do /resumo.
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100)
    const pg = Math.max(Number(page) || 1, 1)
    const offset = (pg - 1) * lim

    const [dataRes, countRes] = await Promise.all([
      db.query(
        `SELECT
           a.id,
           a.starts_at,
           a.status,
           a.notes,
           c.name  AS cliente_nome,
           c.phone AS cliente_telefone,
           s.name  AS servico_nome,
           COALESCE(a.price_snapshot, s.price) AS valor, -- SAL-14: preço congelado na conclusão
           p.name  AS profissional_nome
         FROM appointments a
         JOIN customers    c ON c.id = a.customer_id
         JOIN services     s ON s.id = a.service_id
         JOIN professionals p ON p.id = a.professional_id
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}
         ORDER BY a.starts_at DESC
         LIMIT $4 OFFSET $5`,
        [tenant_id, start, end, lim, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total
         FROM appointments a
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}`,
        [tenant_id, start, end]
      ),
    ])

    return reply.send({
      data: dataRes.rows,
      total: Number(countRes.rows[0].total),
      page: pg,
      limit: lim,
    })
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
            Authorization: `Bearer ${decrypt(tenant.mp_access_token)}`,
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
    const { tenant_id, role } = request.user
    // SAL-11: staff não pode excluir links de pagamento
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    await db.query(
      'UPDATE payment_links SET active = FALSE WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    return reply.send({ deleted: true })
  })
}
