'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeiroApi, appointmentsApi, tenantApi, getToken, friendlyMessage } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'
import Loading from '@/components/ui/Loading'
import NovaVendaModal from '../financeiro/NovaVendaModal'
import { useCapabilities } from '@/lib/useCapabilities'
import UpgradeGate from '@/components/UpgradeGate'

const PM_LABEL: Record<string, string> = { pix: 'Pix', payment_link: 'Link', credit_card: 'Crédito', debit_card: 'Débito', cash: 'Dinheiro' }
const PM_OPTIONS = Object.entries(PM_LABEL)

function fmtBRL(v: number) { return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
function fmtDate(iso: string) { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function iso(d: Date) { return d.toLocaleDateString('en-CA') }

const cardCls = 'bg-white rounded-2xl p-5 border border-gray-100 shadow-sm'
const inputCls = 'h-9 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

export default function VendasPage() {
  const qc = useQueryClient()
  const { can, loaded: capsLoaded } = useCapabilities()
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => { setRole(getTokenPayload(getToken())?.role ?? null) }, [])
  const isManager = role === null || ['owner', 'admin', 'root'].includes(role)
  // Log da equipe: só o proprietário (owner/root) vê, e começa oculto (toggle).
  const isOwner = role === 'owner' || role === 'root'
  const [showLog, setShowLog] = useState(false)

  const today = new Date()
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(iso(today))
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<any | null>(null)
  const [novaVenda, setNovaVenda] = useState(false)
  useEffect(() => { setPage(1) }, [from, to])

  const { data, isLoading } = useQuery({
    queryKey: ['vendas-range', from, to, page],
    queryFn: () => financeiroApi.vendasRange(from, to, page, 50),
    enabled: isManager && role !== null,
  })
  const { data: log = [] } = useQuery({ queryKey: ['activity-log'], queryFn: financeiroApi.activityLog, enabled: isOwner && showLog })

  const vendas = data?.data ?? []
  const total = data?.total ?? 0
  const totalValor = data?.total_valor ?? 0
  const pages = Math.max(1, Math.ceil(total / 50))

  const del = useMutation({
    mutationFn: (id: string) => financeiroApi.deleteVenda(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendas-range'] })
      qc.invalidateQueries({ queryKey: ['activity-log'] })
      qc.invalidateQueries({ queryKey: ['fin-resumo'] })
      qc.invalidateQueries({ queryKey: ['fin-resumo-dashboard'] })
    },
  })

  function preset(days: number) {
    const t = new Date()
    setFrom(iso(new Date(t.getTime() - days * 86400000)))
    setTo(iso(t))
  }
  function presetMonth(offset: number) {
    const t = new Date()
    const s = new Date(t.getFullYear(), t.getMonth() + offset, 1)
    const e = new Date(t.getFullYear(), t.getMonth() + offset + 1, 0)
    setFrom(iso(s)); setTo(iso(e))
  }

  if (role !== null && !isManager) {
    return (
      <div className="max-w-lg space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Vendas</h1>
        <div className={`${cardCls} text-center py-10`}>
          <p className="text-gray-700 text-sm font-medium">Acesso restrito</p>
          <p className="text-gray-400 text-sm mt-1">As vendas do negócio são visíveis apenas para proprietários e administradores.</p>
        </div>
      </div>
    )
  }

  if (capsLoaded && !can('vendas_module')) return <UpgradeGate feature="Vendas" />

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Vendas</h1>
        <button onClick={() => setNovaVenda(true)}
          className="h-9 px-4 rounded-xl bg-primary hover:bg-primary-dark text-white text-sm font-semibold transition-colors">
          + Nova venda
        </button>
      </div>

      {/* Período */}
      <div className={`${cardCls} space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-500">De</label>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          <label className="text-sm text-gray-500">até</label>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          <div className="flex gap-1.5 ml-auto flex-wrap">
            <button onClick={() => preset(0)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Hoje</button>
            <button onClick={() => preset(7)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">7 dias</button>
            <button onClick={() => presetMonth(0)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Este mês</button>
            <button onClick={() => presetMonth(-1)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Mês passado</button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-3">
          <span className="text-sm text-gray-500">{total} venda(s) no período</span>
          <span className="text-lg font-bold text-green-600">Total: {fmtBRL(totalValor)}</span>
        </div>
      </div>

      {/* Lista */}
      <div className={cardCls}>
        {isLoading ? <Loading /> : vendas.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Nenhuma venda neste período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="pb-3 pr-4 font-medium">Data</th>
                  <th className="pb-3 pr-4 font-medium">Cliente</th>
                  <th className="pb-3 pr-4 font-medium">Serviço</th>
                  <th className="pb-3 pr-4 font-medium">Profissional</th>
                  <th className="pb-3 pr-4 font-medium">Pagamento</th>
                  <th className="pb-3 pr-2 font-medium text-right">Valor</th>
                  <th className="pb-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {vendas.map((v: any) => (
                  <tr key={v.id} className="hover:bg-gray-50/50">
                    <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{fmtDate(v.starts_at)}</td>
                    <td className="py-3 pr-4">
                      <p className="font-medium text-gray-900">{v.cliente_nome}</p>
                      {v.source === 'quick_sale' && <span className="text-[10px] text-gray-400">venda avulsa</span>}
                    </td>
                    <td className="py-3 pr-4 text-gray-700">
                      {v.servico_nome}
                      {v.notes && <p className="text-[11px] text-gray-400 max-w-[200px] truncate">{v.notes}</p>}
                    </td>
                    <td className="py-3 pr-4 text-gray-700">{v.profissional_nome ?? '—'}</td>
                    <td className="py-3 pr-4 text-gray-600">{v.payment_method ? (PM_LABEL[v.payment_method] ?? v.payment_method) : '—'}</td>
                    <td className="py-3 pr-2 text-right font-semibold text-green-600">{fmtBRL(Number(v.valor))}</td>
                    <td className="py-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(v)} className="text-xs text-primary font-semibold hover:underline mr-3">Editar</button>
                      <button
                        onClick={() => { if (confirm(`Excluir esta venda de ${fmtBRL(Number(v.valor))}? Ficará registrado no log do proprietário.`)) del.mutate(v.id) }}
                        className="text-xs text-red-500 font-semibold hover:underline">Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-2">
                <p className="text-xs text-gray-400">página {page} de {pages}</p>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm disabled:opacity-40">Anterior</button>
                  <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm disabled:opacity-40">Próxima</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Log de atividades da equipe — apenas proprietário, com ocultar/exibir */}
      {isOwner && (
        <div className={cardCls}>
          <button onClick={() => setShowLog((v) => !v)} className="w-full flex items-center justify-between text-left">
            <span>
              <span className="block text-sm font-semibold text-gray-900">Log de atividades da equipe</span>
              <span className="block text-xs text-gray-400">Registro de exclusões e alterações de vendas feitas pela equipe.</span>
            </span>
            <span className="text-sm font-semibold text-primary shrink-0 ml-3">{showLog ? 'Ocultar' : 'Exibir'}</span>
          </button>
          {showLog && (
            (log as any[]).length === 0 ? (
              <p className="text-gray-400 text-sm py-4 text-center">Nenhuma atividade registrada ainda.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mt-3">
                {(log as any[]).map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 text-sm border-b border-gray-50 pb-2">
                    <span className="text-gray-700">{l.summary}</span>
                    <span className="text-xs text-gray-400 shrink-0">{l.actor_name ? `${l.actor_name} · ` : ''}{new Date(l.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {editing && <EditVendaModal venda={editing} onClose={() => setEditing(null)} onSaved={() => {
        setEditing(null)
        qc.invalidateQueries({ queryKey: ['vendas-range'] })
        qc.invalidateQueries({ queryKey: ['fin-resumo'] })
      }} />}
      {novaVenda && <NovaVendaModal onClose={() => setNovaVenda(false)} onSaved={() => {
        setNovaVenda(false)
        qc.invalidateQueries({ queryKey: ['vendas-range'] })
        qc.invalidateQueries({ queryKey: ['fin-resumo'] })
        qc.invalidateQueries({ queryKey: ['fin-resumo-dashboard'] })
      }} />}
    </div>
  )
}

function EditVendaModal({ venda, onClose, onSaved }: { venda: any; onClose: () => void; onSaved: () => void }) {
  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const start = new Date(venda.starts_at)
  const [serviceId, setServiceId] = useState(venda.service_id)
  const [valor, setValor] = useState(String(Number(venda.valor)))
  const [pm, setPm] = useState(venda.payment_method ?? 'pix')
  const [notes, setNotes] = useState(venda.notes ?? '')
  const [date, setDate] = useState(start.toLocaleDateString('en-CA'))
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => appointmentsApi.update(venda.id, {
      service_id: serviceId,
      price_snapshot: Number(valor),
      payment_method: pm,
      notes: notes.trim() || null,
      starts_at: new Date(`${date}T12:00:00-03:00`).toISOString(),
    }),
    onSuccess: onSaved,
    onError: (e: any) => setError(friendlyMessage(e, 'Não foi possível salvar a venda.')),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Editar venda</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <p className="text-xs text-gray-400">Cliente: <b>{venda.cliente_nome}</b></p>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Serviço</label>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={`${inputCls} w-full h-10`}>
            {(services as any[]).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valor (R$)</label>
            <input type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className={`${inputCls} w-full h-10`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputCls} w-full h-10`} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Forma de pagamento</label>
          <div className="flex flex-wrap gap-2">
            {PM_OPTIONS.map(([v, l]) => (
              <button key={v} onClick={() => setPm(v)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${pm === v ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nota (opcional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} w-full h-10`} />
        </div>
        {error && <p className="text-red-500 text-sm">{error}</p>}
        <button onClick={() => { setError(''); save.mutate() }} disabled={save.isPending || !(Number(valor) >= 0)}
          className="w-full h-11 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl disabled:opacity-50">
          {save.isPending ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>
    </div>
  )
}
