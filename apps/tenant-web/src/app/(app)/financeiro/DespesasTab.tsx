'use client'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { financeiroApi, type Despesa, type ExpenseSubtype } from '@/lib/api'

const fmtBRL = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const fmtDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')

const TIPO_COLOR: Record<string, string> = { Fixa: '#22C55E', 'Variável': '#F59E0B' }

export default function DespesasTab({ month, year }: { month: number; year: number }) {
  const qc = useQueryClient()
  const [filtroTipo, setFiltroTipo] = useState<'Fixa' | 'Variável' | null>(null)
  const [filtroSub, setFiltroSub] = useState<string | null>(null)

  const { data: despesas = [], isLoading } = useQuery({
    queryKey: ['fin-despesas', month, year],
    queryFn: () => financeiroApi.despesas(month, year),
  })
  const { data: subtypes = [] } = useQuery({ queryKey: ['expense-subtypes'], queryFn: financeiroApi.expenseSubtypes })
  const colorOf = (nome: string) => (subtypes as ExpenseSubtype[]).find((s) => s.nome === nome)?.color ?? '#6B7280'

  const del = useMutation({
    mutationFn: (id: string) => financeiroApi.deleteDespesa(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-despesas'] })
      qc.invalidateQueries({ queryKey: ['fin-resumo'] })
    },
  })

  const list = despesas as Despesa[]
  const fixas = list.filter((d) => d.tipo === 'Fixa').reduce((s, d) => s + d.valor_reais, 0)
  const variaveis = list.filter((d) => d.tipo === 'Variável').reduce((s, d) => s + d.valor_reais, 0)

  // Donut: nível 1 (Fixa/Variável) ou nível 2 (subtipos do tipo selecionado).
  const donut = useMemo(() => {
    if (filtroTipo) {
      const bySub = new Map<string, number>()
      list.filter((d) => d.tipo === filtroTipo).forEach((d) => bySub.set(d.subtipo, (bySub.get(d.subtipo) ?? 0) + d.valor_reais))
      return Array.from(bySub, ([name, value]) => ({ name, value, color: colorOf(name) }))
    }
    return [
      { name: 'Fixa', value: fixas, color: TIPO_COLOR.Fixa },
      { name: 'Variável', value: variaveis, color: TIPO_COLOR['Variável'] },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, filtroTipo, subtypes])

  const listaFiltrada = list
    .filter((d) => (filtroSub ? d.subtipo === filtroSub : filtroTipo ? d.tipo === filtroTipo : true))
    .sort((a, b) => b.data.localeCompare(a.data))

  const total = fixas + variaveis

  function onSliceClick(name: string) {
    if (!filtroTipo) { setFiltroTipo(name as any); setFiltroSub(null) }
    else { setFiltroSub(filtroSub === name ? null : name) }
  }

  if (isLoading) return <div className="text-gray-400 text-sm py-8 text-center">Carregando despesas…</div>

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Donut */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-900">Despesas por categoria</p>
          {(filtroTipo || filtroSub) && (
            <button onClick={() => { setFiltroTipo(null); setFiltroSub(null) }} className="text-xs text-primary font-semibold hover:underline">Limpar filtro</button>
          )}
        </div>
        {total === 0 ? (
          <p className="text-gray-400 text-sm py-16 text-center">Nenhuma despesa neste mês. Use “+ Novo lançamento”.</p>
        ) : (
          <>
            <div className="relative h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}
                    onClick={(e: any) => onSliceClick(e.name)} cursor="pointer">
                    {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs text-gray-400">{filtroTipo ?? 'Total'}</span>
                <span className="text-lg font-bold text-gray-900">{fmtBRL(donut.reduce((s, d) => s + d.value, 0))}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
              {donut.map((d) => (
                <button key={d.name} onClick={() => onSliceClick(d.name)} className="flex items-center gap-1.5 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  <span className={`text-gray-600 ${filtroSub === d.name ? 'font-bold' : ''}`}>{d.name}</span>
                  <span className="text-gray-400">{fmtBRL(d.value)}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              {filtroTipo ? 'Clique num subtipo para filtrar a lista.' : 'Clique numa fatia para ver os subtipos.'}
            </p>
          </>
        )}
      </div>

      {/* Lista */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <p className="text-sm font-semibold text-gray-900 mb-3">
          Lançamentos {filtroSub ? `· ${filtroSub}` : filtroTipo ? `· ${filtroTipo}` : ''}
        </p>
        {listaFiltrada.length === 0 ? (
          <p className="text-gray-400 text-sm py-8 text-center">Nenhuma despesa.</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {listaFiltrada.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2 border-b border-gray-50 group">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorOf(d.subtipo) }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{d.descricao}</p>
                  <p className="text-xs text-gray-400">
                    {fmtDate(d.data)} · {d.subtipo}{d.is_percent ? ` (${d.pct}% s/ vendas)` : ''}{d.recorrente ? ' · recorrente' : ''}
                  </p>
                </div>
                <span className="text-sm font-semibold text-red-500 shrink-0">{fmtBRL(d.valor_reais)}</span>
                {!d.recorrente && (
                  <button onClick={() => { if (confirm('Excluir esta despesa?')) del.mutate(d.id) }}
                    className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100">✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
