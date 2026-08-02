'use client'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { commissionsApi, tenantApi, getToken, friendlyMessage, type CommissionRow } from '@/lib/api'
import Loading from '@/components/ui/Loading'
import { getTokenPayload } from '@/lib/auth'
import { useCapabilities } from '@/lib/useCapabilities'
import UpgradeGate from '@/components/UpgradeGate'

function fmtBRL(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const cardCls = 'bg-white rounded-2xl p-5 border border-gray-100 shadow-sm'
const selectCls = 'h-9 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary'

type StatusFilter = 'all' | 'pending' | 'paid'

// Datas digitadas são horário de São Paulo (UTC−03) → instantes UTC para a API
function fromInstant(date: string) {
  return new Date(`${date}T00:00:00-03:00`).toISOString()
}
function toInstant(date: string) {
  return new Date(`${date}T23:59:59-03:00`).toISOString()
}

export default function ComissoesPage() {
  const qc = useQueryClient()
  const { can, loaded } = useCapabilities()

  // Role is read from the JWT in localStorage — only available on the client.
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    setRole(getTokenPayload(getToken())?.role ?? null)
  }, [])
  const isManager = role === 'owner' || role === 'admin' || role === 'root'

  const [proFilter, setProFilter] = useState('') // '' = Todos
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  // SAL-10: filtro por período (usado na lista e nas ações pagar/estornar)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [feedback, setFeedback] = useState('')
  const [actionError, setActionError] = useState('')

  // SAL-10: seleção por item (checkboxes)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(() => { setSelected(new Set()) }, [proFilter, statusFilter, fromDate, toDate])

  const { data: professionals = [] } = useQuery({
    queryKey: ['professionals'],
    queryFn: tenantApi.professionals,
    enabled: isManager,
  })

  const periodParams = useMemo(() => ({
    ...(fromDate ? { from: fromInstant(fromDate) } : {}),
    ...(toDate ? { to: toInstant(toDate) } : {}),
  }), [fromDate, toDate])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['commissions', proFilter, statusFilter, fromDate, toDate],
    queryFn: () =>
      commissionsApi.list({
        ...(proFilter ? { professional_id: proFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...periodParams,
      }),
  })

  const rows: CommissionRow[] = data?.data ?? []
  const totals = data?.totals

  const selectedPendingIds = rows.filter((r) => selected.has(r.id) && r.status === 'pending').map((r) => r.id)
  const selectedPaidIds = rows.filter((r) => selected.has(r.id) && r.status === 'paid').map((r) => r.id)

  function onDone(msg: string) {
    qc.invalidateQueries({ queryKey: ['commissions'] })
    setSelected(new Set())
    setActionError('')
    setFeedback(msg)
    setTimeout(() => setFeedback(''), 4000)
  }

  const payMutation = useMutation({
    mutationFn: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
      commissionsApi.pay(body),
    onSuccess: (res) => onDone(`${res.paid_count} comissão(ões) marcada(s) como paga(s).`),
    onError: (e: any) => {
      setFeedback('')
      setActionError(friendlyMessage(e, 'Não foi possível marcar as comissões como pagas. Tente novamente.'))
    },
  })

  // SAL-10: estorno (paid → pending) — somente owner/admin
  const refundMutation = useMutation({
    mutationFn: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
      commissionsApi.refund(body),
    onSuccess: (res) => onDone(`${res.refunded_count} comissão(ões) revertida(s) para pendente.`),
    onError: (e: any) => {
      setFeedback('')
      setActionError(friendlyMessage(e, 'Não foi possível reverter as comissões. Tente novamente.'))
    },
  })

  function markAsPaid() {
    setActionError('')
    if (selectedPendingIds.length > 0) {
      if (!window.confirm(`Marcar ${selectedPendingIds.length} comissão(ões) selecionada(s) como paga(s)?`)) return
      payMutation.mutate({ ids: selectedPendingIds })
      return
    }
    const who = proFilter
      ? (professionals as any[]).find((p) => p.id === proFilter)?.name ?? 'o profissional selecionado'
      : 'todos os profissionais'
    const periodo = fromDate || toDate ? ' no período filtrado' : ''
    if (!window.confirm(`Marcar todas as comissões pendentes de ${who}${periodo} como pagas?`)) return
    payMutation.mutate({
      ...(proFilter ? { professional_id: proFilter } : {}),
      ...periodParams,
    })
  }

  function revertToPending() {
    setActionError('')
    if (selectedPaidIds.length > 0) {
      if (!window.confirm(`Reverter ${selectedPaidIds.length} comissão(ões) selecionada(s) para pendente?`)) return
      refundMutation.mutate({ ids: selectedPaidIds })
      return
    }
    // Sem seleção: exige algum filtro (profissional ou período) para evitar
    // estorno em massa acidental de todo o histórico.
    if (!proFilter && !fromDate && !toDate) {
      setActionError('Selecione as comissões pagas na lista (ou filtre por profissional/período) para reverter.')
      return
    }
    const who = proFilter
      ? (professionals as any[]).find((p) => p.id === proFilter)?.name ?? 'o profissional selecionado'
      : 'todos os profissionais'
    const periodo = fromDate || toDate ? ' no período filtrado' : ''
    if (!window.confirm(`Reverter para pendente todas as comissões pagas de ${who}${periodo}?`)) return
    refundMutation.mutate({
      ...(proFilter ? { professional_id: proFilter } : {}),
      ...periodParams,
    })
  }

  function toggleRow(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
  }

  const busy = payMutation.isPending || refundMutation.isPending

  if (loaded && !can('commissions')) return <UpgradeGate feature="Comissões" />

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Comissões</h1>
        <div className="flex flex-wrap gap-2">
          {isManager && (
            <select
              value={proFilter}
              onChange={(e) => setProFilter(e.target.value)}
              className={selectCls}
              aria-label="Filtrar por profissional"
            >
              <option value="">Todos os profissionais</option>
              {(professionals as any[]).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={selectCls}
            aria-label="Filtrar por status"
          >
            <option value="all">Todos os status</option>
            <option value="pending">Pendente</option>
            <option value="paid">Pago</option>
          </select>
          {/* SAL-10: período (data do agendamento) */}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className={selectCls}
            aria-label="Período: de"
            title="Período: de"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className={selectCls}
            aria-label="Período: até"
            title="Período: até"
          />
        </div>
      </div>

      {feedback && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm font-medium">
          ✅ {feedback}
        </div>
      )}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
          {actionError}
        </div>
      )}

      {/* Totais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={cardCls}>
          <p className="text-xs text-gray-500 mb-1">A receber (pendente)</p>
          <p className="text-2xl font-bold text-amber-600">{fmtBRL(totals?.pending_amount ?? 0)}</p>
        </div>
        <div className={cardCls}>
          <p className="text-xs text-gray-500 mb-1">Pago</p>
          <p className="text-2xl font-bold text-green-600">{fmtBRL(totals?.paid_amount ?? 0)}</p>
        </div>
      </div>

      {/* Ações: pagar / estornar (somente owner/admin) */}
      {isManager && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selected.size > 0 && (
            <span className="text-xs text-gray-500 mr-auto">
              {selected.size} selecionada(s)
              {selectedPendingIds.length > 0 ? ` · ${selectedPendingIds.length} pendente(s)` : ''}
              {selectedPaidIds.length > 0 ? ` · ${selectedPaidIds.length} paga(s)` : ''}
            </span>
          )}
          <button
            onClick={revertToPending}
            disabled={busy || (totals?.paid_amount ?? 0) <= 0}
            className="border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            {refundMutation.isPending ? 'Revertendo...' : 'Reverter para pendente'}
          </button>
          <button
            onClick={markAsPaid}
            disabled={busy || ((totals?.pending_amount ?? 0) <= 0 && selectedPendingIds.length === 0)}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            {payMutation.isPending
              ? 'Processando...'
              : selectedPendingIds.length > 0
                ? `Marcar ${selectedPendingIds.length} como pago`
                : 'Marcar como pago'}
          </button>
        </div>
      )}

      {/* Lista */}
      <div className={cardCls}>
        {isLoading ? (
          <Loading />
        ) : isError ? (
          <p className="text-gray-400 text-sm text-center py-8">
            Não foi possível carregar as comissões. Tente novamente em instantes.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Nenhuma comissão ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {isManager && (
                    <th className="text-left pb-3 pr-3 w-8">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Selecionar todas"
                        className="rounded border-gray-300 text-primary focus:ring-primary"
                      />
                    </th>
                  )}
                  <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Data</th>
                  <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Serviço</th>
                  <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Cliente</th>
                  {isManager && (
                    <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Profissional</th>
                  )}
                  <th className="text-left text-xs text-gray-500 font-medium pb-3 pr-4">Status</th>
                  <th className="text-right text-xs text-gray-500 font-medium pb-3">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50/50">
                    {isManager && (
                      <td className="py-3 pr-3">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleRow(c.id)}
                          aria-label={`Selecionar comissão de ${c.service_name}`}
                          className="rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </td>
                    )}
                    <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{c.starts_at ? fmtDate(c.starts_at) : '—'}</td>
                    <td className="py-3 pr-4 text-gray-700">{c.service_name}</td>
                    <td className="py-3 pr-4 font-medium text-gray-900">
                      {[c.customer_name, c.customer_last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    {isManager && (
                      <td className="py-3 pr-4 text-gray-700">{c.professional_name}</td>
                    )}
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.status === 'paid' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {c.status === 'paid' ? 'Pago' : 'Pendente'}
                      </span>
                    </td>
                    <td className="py-3 text-right font-semibold text-gray-900">{fmtBRL(Number(c.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
