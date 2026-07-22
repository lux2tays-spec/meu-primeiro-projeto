'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { commissionsApi, tenantApi, getToken, type CommissionRow } from '@/lib/api'
import { getTokenPayload } from '@/lib/auth'

function fmtBRL(v: number) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const cardCls = 'bg-white rounded-2xl p-5 border border-gray-100 shadow-sm'
const selectCls = 'h-9 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary'

type StatusFilter = 'all' | 'pending' | 'paid'

export default function ComissoesPage() {
  const qc = useQueryClient()

  // Role is read from the JWT in localStorage — only available on the client.
  const [role, setRole] = useState<string | null>(null)
  useEffect(() => {
    setRole(getTokenPayload(getToken())?.role ?? null)
  }, [])
  const isManager = role === 'owner' || role === 'admin' || role === 'root'

  const [proFilter, setProFilter] = useState('') // '' = Todos
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [feedback, setFeedback] = useState('')

  const { data: professionals = [] } = useQuery({
    queryKey: ['professionals'],
    queryFn: tenantApi.professionals,
    enabled: isManager,
  })

  const { data, isLoading, isError } = useQuery({
    queryKey: ['commissions', proFilter, statusFilter],
    queryFn: () =>
      commissionsApi.list({
        ...(proFilter ? { professional_id: proFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      }),
  })

  const payMutation = useMutation({
    mutationFn: () => commissionsApi.pay(proFilter ? { professional_id: proFilter } : {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['commissions'] })
      setFeedback(`${res.paid_count} comissão(ões) marcada(s) como paga(s).`)
      setTimeout(() => setFeedback(''), 4000)
    },
    onError: (e: any) => {
      setFeedback('')
      alert(e?.message ?? 'Não foi possível marcar as comissões como pagas.')
    },
  })

  const rows: CommissionRow[] = data?.data ?? []
  const totals = data?.totals

  function markAsPaid() {
    const who = proFilter
      ? (professionals as any[]).find((p) => p.id === proFilter)?.name ?? 'o profissional selecionado'
      : 'todos os profissionais'
    if (!window.confirm(`Marcar todas as comissões pendentes de ${who} como pagas?`)) return
    payMutation.mutate()
  }

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
        </div>
      </div>

      {feedback && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-green-700 text-sm font-medium">
          ✅ {feedback}
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

      {/* Ação: marcar como pago (somente owner/admin) */}
      {isManager && (
        <div className="flex justify-end">
          <button
            onClick={markAsPaid}
            disabled={payMutation.isPending || (totals?.pending_amount ?? 0) <= 0}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50"
          >
            {payMutation.isPending ? 'Processando...' : 'Marcar como pago'}
          </button>
        </div>
      )}

      {/* Lista */}
      <div className={cardCls}>
        {isLoading ? (
          <p className="text-gray-400 text-sm">Carregando...</p>
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
                    <td className="py-3 pr-4 text-gray-500 whitespace-nowrap">{fmtDate(c.starts_at)}</td>
                    <td className="py-3 pr-4 text-gray-700">{c.service_name}</td>
                    <td className="py-3 pr-4 font-medium text-gray-900">
                      {[c.customer_name, c.customer_last_name].filter(Boolean).join(' ')}
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
