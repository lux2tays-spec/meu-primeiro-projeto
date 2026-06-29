'use client'
import { useQuery } from '@tanstack/react-query'
import { tenantApi } from '@/lib/api'

const PLANS = [
  { key: 'free',          label: 'Free',          price: 'Grátis',   agendas: 1, users: 1, highlight: false },
  { key: 'basico',        label: 'Básico',        price: 'R$ 49/mês', agendas: 1, users: 1, highlight: false },
  { key: 'premium',       label: 'Premium',       price: 'R$ 99/mês', agendas: 3, users: 3, highlight: true },
  { key: 'profissional',  label: 'Profissional',  price: 'R$ 199/mês',agendas: 10,users: 10,highlight: false },
]

export default function SubscriptionPage() {
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Assinatura</h1>

      {tenant?.status === 'trial' && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded-xl p-4">
          <p className="text-yellow-800 font-medium text-sm">⏰ Período de teste ativo</p>
          <p className="text-yellow-700 text-sm mt-1">Assine um plano para continuar usando após o período de teste.</p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => {
          const isCurrent = tenant?.plan === plan.key
          return (
            <div key={plan.key} className={`bg-white rounded-2xl p-5 border-2 shadow-sm flex flex-col ${
              isCurrent ? 'border-primary' : plan.highlight ? 'border-primary/30' : 'border-gray-100'
            }`}>
              {isCurrent && <span className="text-xs font-semibold text-primary mb-2">✓ Plano atual</span>}
              {plan.highlight && !isCurrent && <span className="text-xs font-semibold text-gray-400 mb-2">Mais popular</span>}
              {!isCurrent && !plan.highlight && <span className="mb-5" />}
              <p className="font-bold text-gray-900">{plan.label}</p>
              <p className="text-primary font-bold text-lg mt-1">{plan.price}</p>
              <div className="mt-3 space-y-1 flex-1">
                <p className="text-gray-500 text-xs">✓ {plan.agendas} agenda{plan.agendas > 1 ? 's' : ''}</p>
                <p className="text-gray-500 text-xs">✓ {plan.users} usuário{plan.users > 1 ? 's' : ''}</p>
                <p className="text-gray-500 text-xs">✓ Bot WhatsApp IA</p>
              </div>
              {!isCurrent && (
                <button className="mt-4 w-full h-9 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors">
                  Assinar
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <p className="font-semibold text-gray-900 mb-3">Detalhes do plano atual</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: 'Plano', value: tenant?.plan ?? '—' },
            { label: 'Status', value: tenant?.status ?? '—' },
            { label: 'Máx. agendas', value: tenant?.max_agendas ?? '—' },
            { label: 'Máx. usuários', value: tenant?.max_users ?? '—' },
            ...(tenant?.trial_ends_at ? [{ label: 'Teste até', value: new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR') }] : []),
          ].map((row) => (
            <div key={row.label} className="flex gap-2">
              <span className="text-gray-400">{row.label}:</span>
              <span className="text-gray-900 font-medium capitalize">{String(row.value)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-gray-400 text-xs text-center">Pagamentos processados com segurança via Mercado Pago</p>
    </div>
  )
}
