'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { StatCard } from '@/components/ui/StatCard'

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function AffiliatesPage() {
  const queryClient = useQueryClient()
  const { data: affiliates, isLoading } = useQuery({ queryKey: ['root-affiliates'], queryFn: rootApi.affiliates })

  const payMutation = useMutation({
    mutationFn: (id: string) => rootApi.payAffiliate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['root-affiliates'] }),
  })

  const totalPending = (affiliates ?? []).reduce((acc: number, a: any) => acc + Number(a.pending_earnings), 0)
  const totalPaid = (affiliates ?? []).reduce((acc: number, a: any) => acc + Number(a.paid_earnings), 0)
  const totalReferrals = (affiliates ?? []).reduce((acc: number, a: any) => acc + Number(a.referral_count), 0)

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Afiliados</h1>
        <p className="text-gray-500 text-sm mt-1">Programa de indicação da plataforma</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon="🤝" label="Total de afiliados" value={affiliates?.length ?? 0} />
        <StatCard icon="⏳" label="A pagar" value={fmt(totalPending)} color="bg-yellow-100 text-yellow-700" />
        <StatCard icon="✅" label="Total pago" value={fmt(totalPaid)} color="bg-green-100 text-green-700" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-6 py-3 font-medium text-gray-500">Afiliado</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Código</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Indicações</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Pendentes</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">A pagar</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Total pago</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Carregando...</td></tr>
            ) : !affiliates?.length ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Nenhum afiliado cadastrado</td></tr>
            ) : affiliates.map((a: any) => (
              <tr key={a.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="font-semibold text-gray-900">{a.name}</div>
                  <div className="text-xs text-gray-400">{a.email}</div>
                </td>
                <td className="px-4 py-4 font-mono text-xs text-gray-600 bg-gray-50 rounded">
                  {a.referral_code}
                </td>
                <td className="px-4 py-4 text-right text-gray-700">{a.referral_count}</td>
                <td className="px-4 py-4 text-right text-gray-700">{a.pending_count}</td>
                <td className="px-4 py-4 text-right font-semibold text-yellow-700">
                  {fmt(Number(a.pending_earnings))}
                </td>
                <td className="px-4 py-4 text-right text-green-700 font-semibold">
                  {fmt(Number(a.paid_earnings))}
                </td>
                <td className="px-4 py-4">
                  {Number(a.pending_earnings) > 0 && (
                    <button
                      onClick={() => {
                        if (confirm(`Marcar ${fmt(Number(a.pending_earnings))} como pago para ${a.name}?`)) {
                          payMutation.mutate(a.id)
                        }
                      }}
                      disabled={payMutation.isPending}
                      className="h-8 px-3 bg-green-500 text-white rounded-lg text-xs font-semibold hover:bg-green-600 disabled:opacity-50 transition-colors"
                    >
                      Pagar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
