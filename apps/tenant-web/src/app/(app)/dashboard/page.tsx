'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { tenantApi, appointmentsApi } from '@/lib/api'

const today = new Date().toISOString().split('T')[0]

const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' }
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function DashboardPage() {
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: appointments = [], isLoading, refetch } = useQuery({
    queryKey: ['appointments', today],
    queryFn: () => appointmentsApi.list(today),
  })

  const confirmed = appointments.filter((a: any) => a.status === 'confirmed').length
  const pending = appointments.filter((a: any) => a.status === 'pending').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm">Bom dia! 👋</p>
          <h1 className="text-2xl font-bold text-gray-900">{tenant?.name ?? '...'}</h1>
        </div>
        <Link
          href="/appointments/new"
          className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          + Novo agendamento
        </Link>
      </div>

      {/* Trial banner */}
      {tenant?.status === 'trial' && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded-xl p-4">
          <p className="text-yellow-800 text-sm font-medium">
            ⏰ Período de teste ativo — <Link href="/settings/subscription" className="underline">assine agora</Link> para não perder o acesso
          </p>
        </div>
      )}

      {/* Stats */}
      <div>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Hoje</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Agendamentos', value: appointments.length, color: 'text-primary', bg: 'bg-primary-light' },
            { label: 'Confirmados',  value: confirmed,           color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Pendentes',    value: pending,             color: 'text-yellow-600', bg: 'bg-yellow-50' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-gray-500 text-sm mb-1">{s.label}</p>
              <p className={`text-3xl font-bold ${s.color}`}>{isLoading ? '—' : s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Appointments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Próximos agendamentos</h2>
          <Link href="/calendar" className="text-primary text-sm hover:underline">Ver agenda →</Link>
        </div>

        {isLoading ? (
          <p className="text-gray-400 text-sm text-center py-8">Carregando...</p>
        ) : appointments.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center border border-gray-100">
            <p className="text-gray-400 text-sm">Nenhum agendamento para hoje</p>
            <Link href="/appointments/new" className="text-primary text-sm font-medium hover:underline mt-2 inline-block">
              Criar agendamento
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((a: any) => (
              <Link key={a.id} href={`/appointments/${a.id}`}>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 hover:border-primary/30 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{a.customer_name}</p>
                      <p className="text-gray-500 text-sm">{a.service_name} · {a.professional_name}</p>
                      <p className="text-gray-400 text-xs mt-1">
                        {new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {' '}— {a.duration_minutes} min
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_COLOR[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[a.status] ?? a.status}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
