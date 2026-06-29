'use client'
import { useQuery } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

const PLAN_PRICES: Record<string, number> = { basico: 8900, premium: 16900, profissional: 29900 }
const planLabel: Record<string, string> = { free: 'Free', basico: 'Básico', premium: 'Premium', profissional: 'Profissional' }
const subVariant: Record<string, any> = { authorized: 'success', paused: 'warning', cancelled: 'danger', pending: 'info' }
const subLabel: Record<string, string> = { authorized: 'Ativo', paused: 'Pausado', cancelled: 'Cancelado', pending: 'Pendente' }

function fmt(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
}

export default function RevenuePage() {
  const { data, isLoading } = useQuery({ queryKey: ['root-revenue'], queryFn: rootApi.revenue })

  if (isLoading) return <div className="p-8 text-gray-400">Carregando...</div>
  if (!data) return null

  const totalMrr = (data.by_plan ?? []).reduce((acc: number, p: any) => acc + Number(p.revenue_cents ?? 0), 0)
  const totalActive = (data.by_plan ?? []).reduce((acc: number, p: any) => acc + Number(p.count ?? 0), 0)

  const chartData = (data.monthly ?? []).map((m: any) => ({
    month: m.month,
    mrr: Math.round(m.mrr_cents / 100),
    tenants: Number(m.new_tenants),
  }))

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Receita</h1>
        <p className="text-gray-500 text-sm mt-1">Análise financeira da plataforma</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon="💰" label="MRR atual" value={fmt(totalMrr)} color="bg-green-100 text-green-700" />
        <StatCard icon="📅" label="ARR estimado" value={fmt(totalMrr * 12)} color="bg-purple-100 text-purple-700" />
        <StatCard icon="✅" label="Assinantes ativos" value={totalActive} color="bg-blue-100 text-blue-700" />
      </div>

      {/* MRR chart */}
      {chartData.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-900 mb-6">MRR por mês (R$)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barSize={32}>
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${v}`} />
              <Tooltip
                formatter={(value: any) => [`R$ ${value}`, 'MRR']}
                contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}
              />
              <Bar dataKey="mrr" radius={[6, 6, 0, 0]}>
                {chartData.map((_: any, i: number) => (
                  <Cell key={i} fill={i === chartData.length - 1 ? '#6C47FF' : '#C4B5FD'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Plan distribution */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="font-semibold text-gray-900 mb-4">Receita por plano</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left pb-3 font-medium text-gray-500">Plano</th>
              <th className="text-right pb-3 font-medium text-gray-500">Assinantes</th>
              <th className="text-right pb-3 font-medium text-gray-500">Preço unit.</th>
              <th className="text-right pb-3 font-medium text-gray-500">Receita mensal</th>
            </tr>
          </thead>
          <tbody>
            {(data.by_plan ?? []).filter((p: any) => p.plan !== 'free').map((p: any) => (
              <tr key={p.plan} className="border-b border-gray-50 last:border-0">
                <td className="py-3 font-medium text-gray-900">{planLabel[p.plan] ?? p.plan}</td>
                <td className="py-3 text-right text-gray-700">{p.count}</td>
                <td className="py-3 text-right text-gray-500">{fmt(PLAN_PRICES[p.plan] ?? 0)}</td>
                <td className="py-3 text-right font-semibold text-gray-900">{fmt(Number(p.revenue_cents ?? 0))}</td>
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td className="py-3 px-2 font-bold text-gray-900 rounded-bl-xl" colSpan={3}>Total MRR</td>
              <td className="py-3 px-2 text-right font-bold text-primary rounded-br-xl">{fmt(totalMrr)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Recent subscriptions */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h2 className="font-semibold text-gray-900 mb-4">Assinaturas recentes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left pb-3 font-medium text-gray-500">Tenant</th>
              <th className="text-left pb-3 font-medium text-gray-500">Plano</th>
              <th className="text-left pb-3 font-medium text-gray-500">Status</th>
              <th className="text-left pb-3 font-medium text-gray-500">Próx. cobrança</th>
              <th className="text-left pb-3 font-medium text-gray-500">ID Mercado Pago</th>
            </tr>
          </thead>
          <tbody>
            {(data.recent_subscriptions ?? []).map((s: any, i: number) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="py-3 font-medium text-gray-900">{s.tenant_name}</td>
                <td className="py-3"><Badge label={planLabel[s.plan] ?? s.plan} variant="info" /></td>
                <td className="py-3"><Badge label={subLabel[s.status] ?? s.status} variant={subVariant[s.status]} /></td>
                <td className="py-3 text-gray-500">{s.next_billing_date ? new Date(s.next_billing_date).toLocaleDateString('pt-BR') : '—'}</td>
                <td className="py-3 font-mono text-xs text-gray-400">{s.mp_subscription_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
