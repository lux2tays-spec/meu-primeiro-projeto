import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { decrypt } from '../lib/crypto'
import { resolveDespesas, applyPercentValues, computeFinanceExtras } from '../lib/financeiroCalc'
import { syncCommissionForAppointment } from '../lib/commissions'
import { deleteCalendarEvent } from '../services/google-calendar'
import { logTenantActivity } from '../lib/tenantActivity'

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

// #4: valor LÍQUIDO da venda = bruto × (1 − taxa%/100), onde a taxa é a
// configurada pelo tenant para a forma de pagamento da venda (tenant_payment_fees).
// A receita exibida (vendas + financeiro) já vem líquida. Sem taxa/sem método → bruto.
const FEES_JOIN = `LEFT JOIN tenant_payment_fees pf ON pf.tenant_id = a.tenant_id AND pf.method_key = a.payment_method`
const NET_VALOR = `ROUND(COALESCE(a.price_snapshot, s.price) * (1 - COALESCE(pf.pct, 0) / 100), 2)`

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
           COALESCE(SUM(${NET_VALOR}) FILTER (WHERE a.status = 'completed'), 0) AS receita_total,
           COUNT(*) FILTER (WHERE a.status = 'pending' OR a.status = 'confirmed') AS agendamentos_abertos,
           COUNT(*) FILTER (WHERE a.status = 'cancelled') AS agendamentos_cancelados,
           COUNT(*) AS total_agendamentos
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         ${FEES_JOIN}
         WHERE a.tenant_id = $1 AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}`,
        params
      ),
      db.query(
        // LEFT JOIN: vendas avulsas sem profissional entram num bucket "Sem
        // profissional", para a soma do breakdown bater com receita_total.
        `SELECT COALESCE(p.id::text, 'none') AS professional_id,
                COALESCE(p.name, 'Sem profissional') AS professional_nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(${NET_VALOR}), 0)::float AS receita
         FROM appointments a
         JOIN services s ON s.id = a.service_id
         ${FEES_JOIN}
         LEFT JOIN professionals p ON p.id = a.professional_id
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}
         GROUP BY p.id, p.name
         ORDER BY receita DESC, professional_nome`,
        params
      ),
      db.query(
        // Vendas com vários serviços gravam itens em appointment_services; cada
        // item conta +1 e recebe sua fatia do valor. Vendas de 1 serviço e
        // agendamentos da agenda não têm itens → caem no service_id do próprio
        // agendamento (COALESCE). A taxa da forma de pagamento é aplicada por item.
        `SELECT COALESCE(asvc.service_id, a.service_id) AS service_id,
                COALESCE(MAX(asvc.service_name), MAX(s0.name)) AS servico_nome,
                COUNT(*)::int AS vendas,
                COALESCE(SUM(ROUND(COALESCE(asvc.price_snapshot, a.price_snapshot, s0.price)
                  * (1 - COALESCE(pf.pct, 0) / 100), 2)), 0)::float AS receita
         FROM appointments a
         LEFT JOIN appointment_services asvc ON asvc.appointment_id = a.id
         LEFT JOIN services s0 ON s0.id = COALESCE(asvc.service_id, a.service_id)
         LEFT JOIN tenant_payment_fees pf ON pf.tenant_id = a.tenant_id AND pf.method_key = a.payment_method
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}
         GROUP BY COALESCE(asvc.service_id, a.service_id)
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
    const ticketMedio = totalVendas > 0 ? Math.round((receitaTotal / totalVendas) * 100) / 100 : 0

    // Extensão financeira (migration 042): despesas, meta de lucro e a fórmula
    // de margem de contribuição para a meta de vendas. receita_total aqui é a
    // receita de VENDAS (agendamentos concluídos); receita_outras é aditiva.
    const extras = await computeFinanceExtras(tenant_id!, y, m, receitaTotal, totalVendas, ticketMedio)

    return reply.send({
      mes: m,
      ano: y,
      total_vendas: totalVendas,
      receita_total: receitaTotal,
      agendamentos_abertos: Number(totals.agendamentos_abertos),
      // SAL-8 — novos KPIs (campos aditivos; os existentes acima não mudam):
      ticket_medio: ticketMedio,
      agendamentos_cancelados: cancelados,
      total_agendamentos: totalAgendamentos,
      // % de agendamentos do período que foram cancelados (inclui no-show,
      // que hoje é registrado como cancelamento).
      taxa_cancelamento: totalAgendamentos > 0 ? Math.round((cancelados / totalAgendamentos) * 1000) / 10 : 0,
      receita_por_profissional: porProfissionalRes.rows,
      servicos_mais_vendidos: porServicoRes.rows,
      // Extensão financeira — despesas / lucro / meta:
      ...extras,
    })
  })

  // ── Lista de vendas (appointments completed) ──────────────────────────────
  // Aceita filtro por MÊS (month/year) OU por RANGE de datas (from/to, YYYY-MM-DD,
  // interpretadas no fuso de São Paulo). Retorna também total_valor do período.
  app.get('/vendas', async (request, reply) => {
    const { tenant_id, role } = request.user
    // SAL-11: staff não vê a lista de vendas do negócio
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { month, year, from, to, page = '1', limit = '50' } = request.query as {
      month?: string; year?: string; from?: string; to?: string; page?: string; limit?: string
    }

    // Range explícito (from/to) tem prioridade; senão usa o mês. `to` é inclusivo
    // (viramos para o dia seguinte para pegar o dia inteiro).
    let start: string, end: string
    if (from && to) {
      const t = new Date(`${to}T00:00:00`)
      const nextDay = new Date(t.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      start = from
      end = nextDay
    } else {
      const b = monthBoundsSP(month, year)
      start = b.start
      end = b.end
    }

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100)
    const pg = Math.max(Number(page) || 1, 1)
    const offset = (pg - 1) * lim

    const [dataRes, aggRes] = await Promise.all([
      db.query(
        `SELECT
           a.id,
           a.starts_at,
           a.status,
           a.notes,
           a.payment_method,
           a.source,
           a.customer_id,
           a.service_id,
           a.professional_id,
           c.name  AS cliente_nome,
           c.phone AS cliente_telefone,
           s.name  AS servico_nome,
           COALESCE(a.price_snapshot, s.price) AS valor_bruto,
           ${NET_VALOR} AS valor, -- líquido (após taxa do método), já pronto para exibir
           p.name  AS profissional_nome
         FROM appointments a
         JOIN customers    c ON c.id = a.customer_id
         JOIN services     s ON s.id = a.service_id
         ${FEES_JOIN}
         LEFT JOIN professionals p ON p.id = a.professional_id -- vendas avulsas podem não ter profissional
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}
         ORDER BY a.starts_at DESC
         LIMIT $4 OFFSET $5`,
        [tenant_id, start, end, lim, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(${NET_VALOR}), 0)::float AS total_valor
         FROM appointments a JOIN services s ON s.id = a.service_id ${FEES_JOIN}
         WHERE a.tenant_id = $1 AND a.status = 'completed'
           AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}`,
        [tenant_id, start, end]
      ),
    ])

    return reply.send({
      data: dataRes.rows,
      total: Number(aggRes.rows[0].total),
      total_valor: Number(aggRes.rows[0].total_valor),
      page: pg,
      limit: lim,
    })
  })

  // ── Excluir uma venda (manager) — com log visível ao proprietário ───────────
  app.delete<{ Params: { id: string } }>('/vendas/:id', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    // Busca a venda (para o log e para decidir hard-delete vs cancelar).
    const { rows: [venda] } = await db.query(
      `SELECT a.id, a.source, a.customer_id, a.service_id,
              c.name AS cliente_nome, s.name AS servico_nome,
              ${NET_VALOR} AS valor
       FROM appointments a JOIN customers c ON c.id=a.customer_id JOIN services s ON s.id=a.service_id ${FEES_JOIN}
       WHERE a.id = $1 AND a.tenant_id = $2 AND a.status = 'completed'`,
      [request.params.id, tenant_id]
    )
    if (!venda) return reply.status(404).send({ error: 'Venda não encontrada' })

    // Venda avulsa (quick_sale): remove a linha (não tem agenda/comissão). Venda
    // de agendamento normal: cancela (mantém histórico da agenda e comissões).
    if (venda.source === 'quick_sale') {
      await db.query('DELETE FROM appointments WHERE id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
    } else {
      await db.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2`, [request.params.id, tenant_id])
      syncCommissionForAppointment(request.params.id).catch(() => {})
      deleteCalendarEvent(request.params.id).catch(() => {})
    }

    // Log durável para o painel do proprietário + aviso.
    const { rows: [actor] } = await db.query('SELECT name FROM users WHERE id = $1', [user_id])
    const summary = `Venda de ${Number(venda.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} (${venda.servico_nome} — ${venda.cliente_nome}) excluída`
    await logTenantActivity({
      tenantId: tenant_id!, actorId: user_id, actorName: actor?.name ?? null,
      action: 'sale.delete', target: request.params.id, summary,
      data: { valor: Number(venda.valor), cliente: venda.cliente_nome, servico: venda.servico_nome, source: venda.source },
    })

    return reply.send({ deleted: true })
  })

  // ── Log de atividades do tenant (proprietário) ──────────────────────────────
  app.get('/activity-log', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const { rows } = await db.query(
      `SELECT id, actor_name, action, target, summary, data, created_at
       FROM tenant_activity_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [tenant_id]
    )
    return reply.send(rows)
  })

  // ── Formas de pagamento (tipos ativos) + taxas por método (por tenant) ──────
  app.get('/payment-methods', async (request, reply) => {
    const { role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const { rows } = await db.query(`SELECT key, label FROM payment_method_types WHERE active = TRUE ORDER BY sort, label`)
    return reply.send(rows)
  })

  app.get('/payment-fees', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const { rows } = await db.query(`SELECT method_key, pct FROM tenant_payment_fees WHERE tenant_id = $1`, [tenant_id])
    return reply.send(rows)
  })

  app.put('/payment-fees', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const b = z.object({ fees: z.array(z.object({ method_key: z.string(), pct: z.number().min(0).max(100) })) }).parse(request.body)
    for (const f of b.fees) {
      await db.query(
        `INSERT INTO tenant_payment_fees (tenant_id, method_key, pct) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, method_key) DO UPDATE SET pct = EXCLUDED.pct, updated_at = NOW()`,
        [tenant_id, f.method_key, f.pct]
      )
    }
    return reply.send({ ok: true })
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Extensão financeira (migration 042): despesas, outras receitas, meta, venda
  // rápida, subtipos e histórico. Tudo restrito a owner/admin/root (staff não vê
  // gestão financeira — mesmo padrão dos endpoints acima).
  // ═══════════════════════════════════════════════════════════════════════════
  const isManager = (role: string) => ['owner', 'admin', 'root'].includes(role)

  // ── Subtipos de despesa (taxonomia da plataforma + custom do tenant) ────────
  app.get('/expense-subtypes', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const [platform, custom] = await Promise.all([
      db.query(`SELECT tipo, nome, is_percent, color, icon FROM expense_subtypes WHERE active = TRUE ORDER BY tipo, sort, nome`),
      db.query(`SELECT tipo, nome FROM tenant_expense_subtypes WHERE tenant_id = $1 ORDER BY tipo, nome`, [tenant_id]),
    ])
    const customMapped = custom.rows.map((c: any) => ({ tipo: c.tipo, nome: c.nome, is_percent: false, color: '#6B7280', icon: 'ellipsis-horizontal', custom: true }))
    return reply.send([...platform.rows, ...customMapped])
  })

  // ── Despesas ────────────────────────────────────────────────────────────────
  const despesaBase = z.object({
    descricao: z.string().min(1),
    tipo: z.enum(['Fixa', 'Variável']),
    subtipo: z.string().min(1),
    valor: z.number().nonnegative().nullable().optional(),
    pct: z.number().min(0).max(100).nullable().optional(),
    data: z.string(), // YYYY-MM-DD
    recorrente: z.boolean().optional(),
  })
  const despesaSchema = despesaBase.refine((d) => (d.pct != null && d.pct > 0) || (d.valor != null && d.valor >= 0), {
    message: 'Informe um valor em R$ ou um percentual.',
  })

  // Lista as despesas EFETIVAS do mês (recorrentes calculadas + overrides), já
  // com valor_reais dos percentuais resolvido pela receita de vendas do mês.
  app.get('/despesas', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const { month, year } = request.query as { month?: string; year?: string }
    const { y, m, start, end } = monthBoundsSP(month, year)
    const { rows: [rv] } = await db.query(
      `SELECT COALESCE(SUM(${NET_VALOR}), 0)::float AS r
       FROM appointments a JOIN services s ON s.id = a.service_id ${FEES_JOIN}
       WHERE a.tenant_id = $1 AND a.status = 'completed'
         AND a.starts_at >= ${SP_MONTH_START} AND a.starts_at < ${SP_MONTH_END}`,
      [tenant_id, start, end]
    )
    const despesas = applyPercentValues(await resolveDespesas(tenant_id!, y, m), Number(rv?.r ?? 0))
    return reply.send(despesas.sort((a, b) => b.data.localeCompare(a.data)))
  })

  app.post('/despesas', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const b = despesaSchema.parse(request.body)
    // "Outro" com texto livre → guarda como subtipo custom do tenant para reuso.
    const isKnown = await db.query(`SELECT 1 FROM expense_subtypes WHERE tipo = $1 AND nome = $2 AND active = TRUE`, [b.tipo, b.subtipo])
    if (isKnown.rowCount === 0) {
      await db.query(
        `INSERT INTO tenant_expense_subtypes (tenant_id, tipo, nome) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tenant_id, b.tipo, b.subtipo]
      )
    }
    const { rows: [d] } = await db.query(
      `INSERT INTO despesas (tenant_id, descricao, tipo, subtipo, valor, pct, data, recorrente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenant_id, b.descricao, b.tipo, b.subtipo, b.valor ?? null, b.pct ?? null, b.data, b.recorrente ?? (b.tipo === 'Fixa')]
    )
    return reply.status(201).send(d)
  })

  app.patch<{ Params: { id: string } }>('/despesas/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const b = despesaBase.partial().parse(request.body)
    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1
    for (const [k, v] of Object.entries(b)) { sets.push(`${k} = $${i++}`); vals.push(v) }
    if (sets.length === 0) return reply.status(400).send({ error: 'Nada para atualizar' })
    sets.push('updated_at = NOW()')
    vals.push(request.params.id, tenant_id)
    const { rows: [d] } = await db.query(
      `UPDATE despesas SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
      vals
    )
    if (!d) return reply.status(404).send({ error: 'Despesa não encontrada' })
    return reply.send(d)
  })

  app.delete<{ Params: { id: string } }>('/despesas/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    await db.query('DELETE FROM despesas WHERE id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
    return reply.send({ deleted: true })
  })

  // Override de uma ocorrência de despesa recorrente (editar valor/pct ou pular).
  app.patch<{ Params: { id: string } }>('/despesas/:id/ocorrencia', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const b = z.object({
      ano: z.number().int(), mes: z.number().int().min(1).max(12),
      valor: z.number().nonnegative().nullable().optional(),
      pct: z.number().min(0).max(100).nullable().optional(),
      skip: z.boolean().optional(),
    }).parse(request.body)
    // Garante que a despesa é do tenant.
    const owns = await db.query('SELECT 1 FROM despesas WHERE id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
    if (owns.rowCount === 0) return reply.status(404).send({ error: 'Despesa não encontrada' })
    const { rows: [ov] } = await db.query(
      `INSERT INTO despesa_ocorrencia_override (despesa_id, tenant_id, ano, mes, valor, pct, skip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (despesa_id, ano, mes) DO UPDATE SET
         valor = EXCLUDED.valor, pct = EXCLUDED.pct, skip = EXCLUDED.skip, updated_at = NOW()
       RETURNING *`,
      [request.params.id, tenant_id, b.ano, b.mes, b.valor ?? null, b.pct ?? null, b.skip ?? false]
    )
    return reply.send(ov)
  })

  // ── Outras receitas (não-vendas) ────────────────────────────────────────────
  const outraReceitaSchema = z.object({
    descricao: z.string().min(1),
    categoria: z.string().min(1),
    valor: z.number().positive(),
    data: z.string(),
  })

  app.get('/outras-receitas', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const { month, year } = request.query as { month?: string; year?: string }
    const { start, end } = monthBoundsSP(month, year)
    const { rows } = await db.query(
      `SELECT * FROM outras_receitas WHERE tenant_id = $1 AND data >= $2::date AND data < $3::date ORDER BY data DESC`,
      [tenant_id, start, end]
    )
    return reply.send(rows)
  })

  app.post('/outras-receitas', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const b = outraReceitaSchema.parse(request.body)
    const { rows: [r] } = await db.query(
      `INSERT INTO outras_receitas (tenant_id, descricao, categoria, valor, data) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenant_id, b.descricao, b.categoria, b.valor, b.data]
    )
    return reply.status(201).send(r)
  })

  app.delete<{ Params: { id: string } }>('/outras-receitas/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    await db.query('DELETE FROM outras_receitas WHERE id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
    return reply.send({ deleted: true })
  })

  // ── Meta de lucro mensal (por tenant) ───────────────────────────────────────
  app.patch('/meta-lucro', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const { meta } = z.object({ meta: z.number().nonnegative() }).parse(request.body)
    await db.query('UPDATE tenants SET meta_lucro_mensal = $1 WHERE id = $2', [meta, tenant_id])
    return reply.send({ ok: true, meta_lucro_mensal: meta })
  })

  // ── Venda rápida (venda avulsa) → agendamento 'completed' sem ocupar agenda ──
  app.post('/vendas', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const b = z.object({
      customer_id: z.string().uuid(),
      service_id: z.string().uuid().optional(),            // legado: 1 serviço
      service_ids: z.array(z.string().uuid()).optional(),  // vários serviços (catálogo)
      custom_service: z.string().min(1).max(120).optional(), // "Outro serviço" (avulso, sem preço fixo)
      professional_id: z.string().uuid().nullable().optional(),
      valor: z.number().nonnegative(),
      notes: z.string().optional(),
      payment_method: z.string().min(1), // validado contra payment_method_types ativos
      data: z.string().optional(), // YYYY-MM-DD (default: agora)
    }).refine((d) => (d.service_ids?.length ?? 0) > 0 || !!d.service_id || !!d.custom_service, {
      message: 'Informe ao menos um serviço ou uma descrição de serviço avulso.',
    }).parse(request.body)

    const pmOk = await db.query(`SELECT 1 FROM payment_method_types WHERE key = $1 AND active = TRUE`, [b.payment_method])
    if (pmOk.rowCount === 0) return reply.status(400).send({ error: 'Forma de pagamento inválida' })

    const cust = await db.query('SELECT id FROM customers WHERE id = $1 AND tenant_id = $2', [b.customer_id, tenant_id])
    if (cust.rowCount === 0) return reply.status(404).send({ error: 'Cliente não encontrado' })
    if (b.professional_id) {
      const prof = await db.query('SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2', [b.professional_id, tenant_id])
      if (prof.rowCount === 0) return reply.status(404).send({ error: 'Profissional não encontrado' })
    }

    // Lista final de serviços do catálogo (dedup, preserva ordem). service_ids
    // tem prioridade; senão cai no service_id legado.
    const catalogIds = (b.service_ids?.length ? b.service_ids : (b.service_id ? [b.service_id] : []))
      .filter((v, i, a) => a.indexOf(v) === i)

    // Resolve o serviço primário do agendamento + itens da venda.
    let serviceId: string | undefined
    let notes = b.notes?.trim() || null
    // [service_id, nome, preço] de cada serviço do catálogo escolhido.
    let items: { id: string; name: string; price: number }[] = []

    if (catalogIds.length > 0) {
      const svc = await db.query(
        `SELECT id, name, price FROM services WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenant_id, catalogIds]
      )
      if (svc.rowCount !== catalogIds.length) return reply.status(404).send({ error: 'Serviço não encontrado' })
      // Mantém a ordem enviada pelo cliente.
      items = catalogIds.map((id) => {
        const r = svc.rows.find((x: any) => x.id === id)
        return { id, name: r.name, price: Number(r.price) || 0 }
      })
      serviceId = items[0].id
    } else {
      // "Outro serviço" (avulso): placeholder do tenant + descrição nas notes.
      const found = await db.query(
        `SELECT id FROM services WHERE tenant_id = $1 AND name = 'Serviço avulso' LIMIT 1`, [tenant_id]
      )
      serviceId = found.rows[0]?.id
      if (!serviceId) {
        const created = await db.query(
          `INSERT INTO services (tenant_id, name, duration_minutes, price, active)
           VALUES ($1, 'Serviço avulso', 0, 0, FALSE) RETURNING id`, [tenant_id]
        )
        serviceId = created.rows[0].id
      }
      notes = notes ? `${b.custom_service} — ${notes}` : (b.custom_service ?? null)
    }

    // Instante da venda. ends_at = starts_at → intervalo vazio: não conflita com
    // a constraint de overlap e não ocupa slot na agenda (venda pontual).
    const startsAt = b.data ? new Date(`${b.data}T12:00:00-03:00`) : new Date()
    const { rows: [venda] } = await db.query(
      `INSERT INTO appointments
         (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, status, notes, created_by, price_snapshot, payment_method, source)
       VALUES ($1, $2, $3, $4, $5, $5, 'completed', $6, $7, $8, $9, 'quick_sale') RETURNING *`,
      [tenant_id, b.customer_id, b.professional_id ?? null, serviceId, startsAt.toISOString(), notes, user_id, b.valor, b.payment_method]
    )

    // Só grava itens quando são 2+ serviços do catálogo. Rateia o valor TOTAL da
    // venda proporcionalmente ao preço de cada serviço (em centavos, sem drift).
    if (items.length >= 2) {
      const totalCents = Math.round(b.valor * 100)
      const sumPrices = items.reduce((acc, it) => acc + it.price, 0)
      const shares = items.map((it) =>
        sumPrices > 0 ? Math.round((totalCents * it.price) / sumPrices) : Math.round(totalCents / items.length)
      )
      // Ajusta a última fatia para o somatório bater exatamente com o total.
      const drift = totalCents - shares.reduce((a, s) => a + s, 0)
      shares[shares.length - 1] += drift
      for (let i = 0; i < items.length; i++) {
        await db.query(
          `INSERT INTO appointment_services (appointment_id, service_id, service_name, price_snapshot)
           VALUES ($1, $2, $3, $4)`,
          [venda.id, items[i].id, items[i].name, shares[i] / 100]
        )
      }
    }
    return reply.status(201).send(venda)
  })

  // ── Histórico mensal (para o gráfico de evolução) ───────────────────────────
  app.get('/historico', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!isManager(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const meses = Math.min(Math.max(Number((request.query as any).meses) || 6, 1), 12)
    const { y: cy, m: cm } = monthBoundsSP()
    const MES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

    const out: any[] = []
    for (let k = meses - 1; k >= 0; k--) {
      let m = cm - k, y = cy
      while (m <= 0) { m += 12; y -= 1 }
      const pad = (n: number) => String(n).padStart(2, '0')
      const start = `${y}-${pad(m)}-01`
      const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
      const { rows: [tot] } = await db.query(
        `SELECT COUNT(*) FILTER (WHERE a.status='completed')::int AS n,
                COALESCE(SUM(${NET_VALOR}) FILTER (WHERE a.status='completed'),0)::float AS receita
         FROM appointments a JOIN services s ON s.id=a.service_id ${FEES_JOIN}
         WHERE a.tenant_id=$1 AND a.starts_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
           AND a.starts_at < ($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
        [tenant_id, start, end]
      )
      const receitaVendas = Number(tot.receita)
      const numVendas = Number(tot.n)
      const ticket = numVendas ? receitaVendas / numVendas : 0
      const ex = await computeFinanceExtras(tenant_id!, y, m, receitaVendas, numVendas, Math.round(ticket))
      out.push({
        mes: MES_LABEL[m - 1], ano: y,
        receita: Math.round(ex.faturamento),
        despesa: Math.round(ex.despesas_total),
        lucro: Math.round(ex.lucro),
        meta: Math.round(ex.meta_lucro),
      })
    }
    return reply.send(out)
  })
}
