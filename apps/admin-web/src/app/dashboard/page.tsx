'use client'
import { useQuery } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import Link from 'next/link'

const planVariant: Record<string, any> = {
  free: 'default', basico: 'info', premium: 'purple', profissional: 'success',
}
const planLabel: Record<string, string> = {
  free: 'Free', basico: 'Básico', premium: 'Premium', profissional: 'Profissional',
}
const statusVariant: Record<string, any> = {
  active: 'success', trial: 'warning', suspended: 'danger', cancelled: 'danger',
}
const statusLabel: Record<string, string> = {
  active: 'Ativo', trial: 'Trial', suspended: 'Suspenso', cancelled: 'Cancelado',
}

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['root-stats'], queryFn: rootApi.stats })

  if (isLoading) return <div className="p-8 text-gray-400">Carregando...</div>
  if (!data) return null

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Visão Geral</h1>
        <p className="text-gray-500 text-sm mt-1">Métricas em tempo real da plataforma</p>
      </div>

      {/* Main stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="🏢" label="Total de tenants" value={data.total_tenants} />
        <StatCard icon="✅" label="Tenants ativos" value={data.active_tenants} color="bg-green-100 text-green-700" />
        <StatCard icon="⏳" label="Em trial" value={data.trial_tenants} color="bg-yellow-100 text-yellow-700" />
        <StatCard
          icon="💰"
          label="MRR estimado"
          value={fmt(data.mrr_cents)}
          sub={`+${data.new_tenants_30d} novos nos últimos 30 dias`}
          color="bg-purple-100 text-purple-700"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon="👥" label="Total de usuários" value={data.total_users} />
        <StatCard icon="📅" label="Agendamentos hoje" value={data.appointments_today} color="bg-blue-100 text-blue-700" />
        <StatCard icon="💬" label="Mensagens hoje" value={data.messages_today} color="bg-indigo-100 text-indigo-700" />
        <StatCard icon="📉" label="Churn (30 dias)" value={data.churn_30d} color="bg-red-100 text-red-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plans distribution */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-4">Distribuição de planos</h2>
          <div className="space-y-3">
            {Object.entries(data.by_plan ?? {}).map(([plan, count]: any) => {
              const pct = data.total_tenants > 0 ? Math.round((count / data.total_tenants) * 100) : 0
              return (
                <div key={plan}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{planLabel[plan] ?? plan}</span>
                    <span className="text-gray-500">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recent tenants */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Últimos cadastros</h2>
            <Link href="/dashboard/tenants" className="text-sm text-primary hover:text-primary-dark font-medium">
              Ver todos →
            </Link>
          </div>
          <div className="space-y-3">
            {data.recent_tenants?.map((t: any) => (
              <Link
                key={t.id}
                href={`/dashboard/tenants/${t.id}`}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
              >
                <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate group-hover:text-primary">{t.name}</div>
                  <div className="text-xs text-gray-400 truncate">{t.owner_email}</div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Badge label={planLabel[t.plan] ?? t.plan} variant={planVariant[t.plan]} />
                  <Badge label={statusLabel[t.status] ?? t.status} variant={statusVariant[t.status]} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Top affiliates */}
      {data.top_affiliates?.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Top afiliados (pendente)</h2>
            <Link href="/dashboard/affiliates" className="text-sm text-primary hover:text-primary-dark font-medium">
              Gerenciar →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100">
                <th className="pb-2 font-medium">Nome</th>
                <th className="pb-2 font-medium">Código</th>
                <th className="pb-2 font-medium">Indicações</th>
                <th className="pb-2 font-medium text-right">A pagar</th>
              </tr>
            </thead>
            <tbody>
              {data.top_affiliates.map((a: any) => (
                <tr key={a.id} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 font-medium text-gray-900">{a.name}</td>
                  <td className="py-3 font-mono text-gray-500 text-xs">{a.referral_code}</td>
                  <td className="py-3 text-gray-700">{a.total_referrals}</td>
                  <td className="py-3 text-right font-semibold text-primary">{fmt(a.pending_earnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
