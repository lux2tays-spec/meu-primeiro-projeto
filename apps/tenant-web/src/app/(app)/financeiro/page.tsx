'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeiroApi } from '@/lib/api'

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function FinanceiroPage() {
  const qc = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year,  setYear]  = useState(now.getFullYear())
  const [tab, setTab] = useState<'vendas' | 'links'>('vendas')

  // Forms
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkForm, setLinkForm] = useState({ title: '', description: '', amount: '' })
  const [linkError, setLinkError] = useState('')

  const { data: resumo } = useQuery({
    queryKey: ['fin-resumo', month, year],
    queryFn: () => financeiroApi.resumo(month, year),
  })

  const { data: vendas = [], isLoading: loadingVendas } = useQuery({
    queryKey: ['fin-vendas', month, year],
    queryFn: () => financeiroApi.vendas(month, year),
    enabled: tab === 'vendas',
  })

  const { data: links = [], isLoading: loadingLinks } = useQuery({
    queryKey: ['fin-links'],
    queryFn: financeiroApi.paymentLinks,
    enabled: tab === 'links',
  })

  const createLink = useMutation({
    mutationFn: financeiroApi.createPaymentLink,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-links'] })
      setShowLinkForm(false)
      setLinkForm({ title: '', description: '', amount: '' })
      setLinkError('')
    },
    onError: (e: any) => setLinkError(e.message),
  })

  const deleteLink = useMutation({
    mutationFn: financeiroApi.deletePaymentLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fin-links'] }),
  })

  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i)

  const cardCls = 'bg-white rounded-2xl p-5 border border-gray-100 shadow-sm'
  const btnPrimary = 'bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50'
  const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Financeiro</h1>
        <div className="flex gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="h-9 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={cardCls}>
          <p className="text-xs text-gray-500 mb-1">Receita do mês</p>
          <p className="text-2xl font-bold text-green-600">{fmtBRL(resumo?.receita_total ?? 0)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-gray-500 mb-1">Vendas concluídas</p>
          <p className="text-2xl font-bold text-gray-900">{resumo?.total_vendas ?? 0}</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-gray-500 mb-1">Agendamentos abertos</p>
          <p className="text-2xl font-bold text-blue-600">{resumo?.agendamentos_abertos ?? 0}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['vendas', 'links'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'vendas' ? 'Controle de Vendas' : 'Links de Pagamento'}
          </button>
        ))}
      </div>

      {/* ── Vendas ─────────────────────────────────────────────────────── */}
      {tab === 'vendas' && (
        <div className={cardCls}>
          {loadingVendas ? (
            <p className="text-gray-400 text-sm">Carregando...</p>
          ) : (vendas as any[]).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">Nenhuma venda concluída neste período</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Data</th>
                    <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Cliente</th>
                    <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Serviço</th>
                    <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Profissional</th>
                    <th className="text-right text-xs text-gray-500 font-medium pb-3">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(vendas as any[]).map((v) => (
                    <tr key={v.id} className="hover:bg-gray-50/50">
                      <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{fmtDate(v.starts_at)}</td>
                      <td className="py-3 pr-4">
                        <p className="font-medium text-gray-900">{v.cliente_nome}</p>
                        <p className="text-xs text-gray-400">{v.cliente_telefone}</p>
                      </td>
                      <td className="py-3 pr-4 text-gray-700">{v.servico_nome}</td>
                      <td className="py-3 pr-4 text-gray-700">{v.profissional_nome}</td>
                      <td className="py-3 text-right font-semibold text-green-600">{fmtBRL(Number(v.valor))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Links de Pagamento ──────────────────────────────────────────── */}
      {tab === 'links' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowLinkForm(true)} className={btnPrimary}>
              + Novo link de pagamento
            </button>
          </div>

          {showLinkForm && (
            <div className={`${cardCls} border-primary/30 space-y-3`}>
              <p className="font-semibold text-gray-900 text-sm">Novo link de pagamento</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Título</label>
                  <input value={linkForm.title} onChange={(e) => setLinkForm((f) => ({ ...f, title: e.target.value }))}
                    className={inputCls} placeholder="Ex: Pacote mensal, Consulta avulsa..." />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Descrição (opcional)</label>
                  <input value={linkForm.description} onChange={(e) => setLinkForm((f) => ({ ...f, description: e.target.value }))}
                    className={inputCls} placeholder="Detalhes do que está sendo cobrado" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$)</label>
                  <input type="number" value={linkForm.amount} onChange={(e) => setLinkForm((f) => ({ ...f, amount: e.target.value }))}
                    className={inputCls} min="0.01" step="0.01" placeholder="0,00" />
                </div>
              </div>
              {linkError && <p className="text-red-500 text-xs">{linkError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={() => createLink.mutate({ title: linkForm.title, description: linkForm.description || undefined, amount: Number(linkForm.amount) })}
                  disabled={createLink.isPending || !linkForm.title || !linkForm.amount}
                  className={`flex-1 h-10 ${btnPrimary}`}>
                  {createLink.isPending ? 'Criando...' : 'Criar link'}
                </button>
                <button onClick={() => setShowLinkForm(false)} className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {loadingLinks ? (
            <p className="text-gray-400 text-sm">Carregando...</p>
          ) : (links as any[]).length === 0 ? (
            <div className={`${cardCls} text-center py-8`}>
              <p className="text-gray-400 text-sm">Nenhum link criado ainda</p>
              <p className="text-gray-300 text-xs mt-1">Configure o Mercado Pago em Configurações → Pagamentos para gerar links automáticos</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(links as any[]).map((l) => (
                <div key={l.id} className={`${cardCls} flex items-center justify-between gap-4`}>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{l.title}</p>
                    {l.description && <p className="text-xs text-gray-400 mt-0.5">{l.description}</p>}
                    <p className="text-green-600 font-medium text-sm mt-1">{fmtBRL(Number(l.amount))}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {l.mp_url ? (
                      <a href={l.mp_url} target="_blank" rel="noreferrer"
                        className="text-sm text-primary font-medium hover:underline">
                        Abrir link
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400 italic">Sem link MP</span>
                    )}
                    {l.mp_url && (
                      <button
                        onClick={() => navigator.clipboard.writeText(l.mp_url)}
                        className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded-lg hover:bg-gray-100">
                        Copiar
                      </button>
                    )}
                    <button
                      onClick={() => { if (confirm('Excluir este link?')) deleteLink.mutate(l.id) }}
                      className="text-gray-400 hover:text-red-500 text-sm px-2 py-1 rounded-lg hover:bg-red-50">
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
