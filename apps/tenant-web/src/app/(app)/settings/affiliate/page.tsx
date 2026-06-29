'use client'
import { useQuery } from '@tanstack/react-query'
import { affiliateApi } from '@/lib/api'

export default function AffiliatePage() {
  const { data: affiliate, isLoading } = useQuery({ queryKey: ['affiliate'], queryFn: affiliateApi.me })

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando...</div>

  const referralUrl = `${typeof window !== 'undefined' ? window.location.origin.replace(':3002', ':3002') : 'https://app.agendabot.com.br'}/register?ref=${affiliate?.referral_code}`

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Programa de Afiliados</h1>

      <div className="bg-primary-light border border-primary/20 rounded-2xl p-5">
        <p className="text-primary font-semibold">💰 Ganhe indicando o AgendaBot</p>
        <p className="text-primary/80 text-sm mt-1">Receba comissão por cada cliente que assinar usando seu link de indicação.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Indicações', value: affiliate?.total_referrals ?? 0 },
          { label: 'Pendentes', value: affiliate?.pending_count ?? 0 },
          { label: 'A receber (R$)', value: Number(affiliate?.pending_earnings ?? 0).toFixed(2) },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm text-center">
            <p className="text-3xl font-bold text-primary">{s.value}</p>
            <p className="text-gray-500 text-sm mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Referral link */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-3">
        <p className="font-semibold text-gray-900">Seu link de indicação</p>
        <div className="flex gap-2">
          <input
            readOnly
            value={`https://app.agendabot.com.br/register?ref=${affiliate?.referral_code}`}
            className="flex-1 h-11 px-4 rounded-xl border border-gray-200 text-sm bg-gray-50 text-gray-600"
          />
          <button
            onClick={() => navigator.clipboard.writeText(`https://app.agendabot.com.br/register?ref=${affiliate?.referral_code}`)}
            className="px-4 h-11 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Copiar
          </button>
        </div>
        <p className="text-gray-400 text-xs">Código: <span className="font-bold text-gray-700">{affiliate?.referral_code}</span></p>
      </div>
    </div>
  )
}
