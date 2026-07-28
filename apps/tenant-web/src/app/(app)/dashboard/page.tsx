'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { tenantApi, appointmentsApi } from '@/lib/api'
import Loading from '@/components/ui/Loading'
import { Rocket, ArrowRight } from 'lucide-react'

// SAL-19: data calculada a cada render (no componente), não no load do módulo —
// o painel aberto de um dia para o outro não fica preso na data antiga.
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// UI-10: saudação dinâmica pelo horário local.
function greeting() {
  const h = new Date().getHours()
  if (h < 5) return 'Boa noite'
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

const STATUS_LABEL: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' }
const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
}

function OnboardingProgressCard() {
  const { data: onboarding } = useQuery({ queryKey: ['onboarding'], queryFn: tenantApi.onboarding })
  if (!onboarding || onboarding.completed) return null

  const done = onboarding.progress?.done ?? 0
  const total = onboarding.progress?.total ?? 7
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="bg-white rounded-2xl p-5 border border-primary/20 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
          <Rocket size={19} strokeWidth={1.75} className="text-primary" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <p className="font-semibold text-gray-900 text-sm">Configuração {done}/{total}</p>
          <p className="text-gray-500 text-xs mt-0.5">Complete a configuração para o bot começar a atender seus clientes.</p>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Link
          href="/onboarding"
          className="flex items-center gap-1.5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shrink-0"
        >
          Continuar configuração
          <ArrowRight size={15} strokeWidth={2} />
        </Link>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const today = localToday()
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
          <p className="text-gray-500 text-sm">{greeting()}! 👋</p>
          <h1 className="text-2xl font-bold text-gray-900">{tenant?.name ?? '...'}</h1>
        </div>
        <Link
          href="/appointments/new"
          className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          + Novo agendamento
        </Link>
      </div>

      {/* Onboarding progress */}
      <OnboardingProgressCard />

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
        {/* UI-9: 1 coluna no mobile, 3 em telas maiores */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <Loading card />
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
