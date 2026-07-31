import { db } from './db'

// Cálculo financeiro estendido: resolve despesas do mês (com recorrência e
// overrides de ocorrência) e aplica a fórmula de margem de contribuição para a
// meta de vendas. Centraliza a regra para que resumo e a lista de despesas
// mostrem exatamente os mesmos números.

export interface DespesaResolvida {
  id: string
  descricao: string
  tipo: 'Fixa' | 'Variável'
  subtipo: string
  valor: number | null      // R$ fixo (null quando percentual)
  pct: number | null        // % sobre vendas (Taxa de Cartão / Comissão)
  data: string              // YYYY-MM-DD (data efetiva no mês)
  recorrente: boolean
  is_percent: boolean
  valor_reais: number       // valor em R$ já resolvido (percentual = receitaVendas*pct/100)
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate() // m 1-12 → new Date(y, m, 0) = último dia do mês m
}
function pad(n: number): string { return String(n).padStart(2, '0') }

/** DATE do Postgres → 'YYYY-MM-DD' sem deslocar o dia pelo fuso do servidor. */
function dateToISO(d: unknown): string {
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = d as Date
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/**
 * Lista as despesas EFETIVAS de um mês: as não-recorrentes lançadas no mês + as
 * recorrentes cuja data inicial é <= fim do mês (repetidas), aplicando overrides
 * de ocorrência (editar valor/pct ou pular o mês). `valor_reais` ainda NÃO está
 * calculado para percentuais aqui — é preenchido por quem tem a receita de vendas.
 */
export async function resolveDespesas(tenantId: string, y: number, m: number): Promise<DespesaResolvida[]> {
  const monthStartISO = `${y}-${pad(m)}-01`
  const monthEndISO = `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`

  const { rows: despesas } = await db.query(
    `SELECT id, descricao, tipo, subtipo, valor, pct, data, recorrente
     FROM despesas
     WHERE tenant_id = $1
       AND (
         (recorrente = FALSE AND data >= $2::date AND data <= $3::date)
         OR (recorrente = TRUE AND data <= $3::date)
       )`,
    [tenantId, monthStartISO, monthEndISO]
  )

  const { rows: overrides } = await db.query(
    `SELECT despesa_id, valor, pct, skip FROM despesa_ocorrencia_override
     WHERE tenant_id = $1 AND ano = $2 AND mes = $3`,
    [tenantId, y, m]
  )
  const ovByDespesa = new Map<string, any>(overrides.map((o: any) => [o.despesa_id, o]))

  const out: DespesaResolvida[] = []
  for (const d of despesas) {
    let valor: number | null = d.valor === null ? null : Number(d.valor)
    let pct: number | null = d.pct === null ? null : Number(d.pct)
    let dataEfetiva: string = dateToISO(d.data)

    if (d.recorrente) {
      const ov = ovByDespesa.get(d.id)
      if (ov?.skip) continue // ocorrência pulada neste mês
      if (ov) {
        if (ov.valor !== null && ov.valor !== undefined) valor = Number(ov.valor)
        if (ov.pct !== null && ov.pct !== undefined) pct = Number(ov.pct)
      }
      // data efetiva = mesmo dia do lançamento, limitado ao último dia do mês
      const origDay = Number(dataEfetiva.slice(8, 10))
      const day = Math.min(origDay, lastDayOfMonth(y, m))
      dataEfetiva = `${y}-${pad(m)}-${pad(day)}`
    }

    // Percentual (Taxa de Cartão / Comissão) só faz sentido em despesa Variável.
    // Guard defensivo: um pct indevido numa Fixa não é tratado como percentual
    // (evitaria duplo cômputo na fórmula da meta).
    const is_percent = pct !== null && d.tipo === 'Variável'
    out.push({
      id: d.id, descricao: d.descricao, tipo: d.tipo, subtipo: d.subtipo,
      valor, pct, data: dataEfetiva, recorrente: d.recorrente, is_percent,
      valor_reais: is_percent ? 0 : (valor ?? 0), // percentuais preenchidos depois
    })
  }
  return out
}

/** Preenche valor_reais dos percentuais: receitaVendas * pct/100. */
export function applyPercentValues(despesas: DespesaResolvida[], receitaVendas: number): DespesaResolvida[] {
  return despesas.map((d) =>
    d.is_percent ? { ...d, valor_reais: Math.round((receitaVendas * (d.pct ?? 0)) / 100) } : d
  )
}

export interface FinanceExtras {
  receita_outras: number
  faturamento: number
  despesas_fixas: number
  despesas_variaveis: number
  despesas_total: number
  lucro: number
  meta_lucro: number
  meta_vendas: number
  vendas_necessarias: number
  vendas_faltantes: number
  progresso_meta: number
  ticket_base: number
  pct_sobre_venda: number
  // true quando taxa de cartão + comissão somam >= 100% das vendas: a meta de
  // lucro é matematicamente inatingível (a UI mostra um aviso, não "0 vendas").
  meta_inatingivel: boolean
}

/**
 * Aplica a fórmula da margem de contribuição. `receitaVendas`, `numVendas` e
 * `ticketMedio` vêm do cálculo de vendas concluídas (agendamentos completed).
 */
export async function computeFinanceExtras(
  tenantId: string, y: number, m: number,
  receitaVendas: number, numVendas: number, ticketMedio: number,
): Promise<FinanceExtras> {
  const monthStartISO = `${y}-${pad(m)}-01`
  const monthEndISO = `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`

  const [despesasRaw, receitaOutrasRes, metaRes] = await Promise.all([
    resolveDespesas(tenantId, y, m),
    db.query(
      `SELECT COALESCE(SUM(valor), 0)::float AS total FROM outras_receitas
       WHERE tenant_id = $1 AND data >= $2::date AND data <= $3::date`,
      [tenantId, monthStartISO, monthEndISO]
    ),
    db.query('SELECT meta_lucro_mensal FROM tenants WHERE id = $1', [tenantId]),
  ])

  const despesas = applyPercentValues(despesasRaw, receitaVendas)
  const receitaOutras = Number(receitaOutrasRes.rows[0]?.total ?? 0)
  const faturamento = receitaVendas + receitaOutras

  const despesasFixas = despesas.filter((d) => d.tipo === 'Fixa').reduce((s, d) => s + d.valor_reais, 0)
  const despesasVariaveis = despesas.filter((d) => d.tipo === 'Variável').reduce((s, d) => s + d.valor_reais, 0)
  const despesasTotal = despesasFixas + despesasVariaveis
  const lucro = faturamento - despesasTotal

  const pctSobreVenda = despesas.filter((d) => d.is_percent).reduce((s, d) => s + (d.pct ?? 0), 0)
  const variaveisEmReais = despesas.filter((d) => d.tipo === 'Variável' && !d.is_percent).reduce((s, d) => s + d.valor_reais, 0)
  const metaLucro = Number(metaRes.rows[0]?.meta_lucro_mensal ?? 0)

  // Meta de vendas (margem de contribuição). Outras receitas já reduzem quanto
  // precisa vender; taxa/comissão % incidem só sobre vendas.
  const denom = 1 - pctSobreVenda / 100
  const metaVendas = denom > 0
    ? Math.max(0, Math.round((despesasFixas + variaveisEmReais + metaLucro - receitaOutras) / denom))
    : 0

  // Ticket base: ticket do mês → últimos 30 dias → R$ 700 (fallback da spec).
  let ticketBase = ticketMedio
  if (!ticketBase) {
    const { rows } = await db.query(
      `SELECT COALESCE(AVG(ROUND(COALESCE(a.price_snapshot, s.price) * (1 - COALESCE(pf.pct,0)/100), 2)), 0)::float AS t
       FROM appointments a JOIN services s ON s.id = a.service_id
       LEFT JOIN tenant_payment_fees pf ON pf.tenant_id = a.tenant_id AND pf.method_key = a.payment_method
       WHERE a.tenant_id = $1 AND a.status = 'completed' AND a.starts_at >= NOW() - INTERVAL '30 days'`,
      [tenantId]
    )
    ticketBase = Math.round(Number(rows[0]?.t ?? 0)) || 700
  }

  const vendasNecessarias = ticketBase > 0 ? Math.ceil(metaVendas / ticketBase) : 0
  const vendasFaltantes = Math.max(0, vendasNecessarias - numVendas)
  const progressoMeta = metaLucro > 0 ? Math.max(0, Math.round((lucro / metaLucro) * 100)) : 0

  return {
    receita_outras: receitaOutras,
    faturamento,
    despesas_fixas: despesasFixas,
    despesas_variaveis: despesasVariaveis,
    despesas_total: despesasTotal,
    lucro,
    meta_lucro: metaLucro,
    meta_vendas: metaVendas,
    vendas_necessarias: vendasNecessarias,
    vendas_faltantes: vendasFaltantes,
    progresso_meta: progressoMeta,
    ticket_base: ticketBase,
    pct_sobre_venda: pctSobreVenda,
    meta_inatingivel: denom <= 0 && metaLucro > 0,
  }
}
