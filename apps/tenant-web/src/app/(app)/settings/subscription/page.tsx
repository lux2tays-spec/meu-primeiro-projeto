'use client'
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { tenantApi, subscriptionApi } from '@/lib/api'

const fmtPrice = (cents: number) => cents <= 0 ? 'Grátis' : `R$ ${(cents / 100).toFixed(0)}/mês`

export default function SubscriptionPage() {
  const [error, setError] = useState('')
  const [pendingPlan, setPendingPlan] = useState('')
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: plans } = useQuery({ queryKey: ['sub-plans'], queryFn: subscriptionApi.plans })

  const trialExpired = tenant?.status === 'trial' && tenant?.trial_ends_at && new Date(tenant.trial_ends_at).getTime() < Date.now()
  const blocked = trialExpired || tenant?.status === 'suspended' || tenant?.status === 'cancelled'

  const checkout = useMutation({
    mutationFn: (plan: string) => subscriptionApi.checkout(plan),
    onMutate: (plan) => { setError(''); setPendingPlan(plan) },
    onSuccess: (data) => { window.location.href = data.init_point },
    onError: (e: any) => { setError(e?.message ?? 'Não foi possível iniciar o pagamento.'); setPendingPlan('') },
  })

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Assinatura</h1>

      {blocked ? (
        <div className="bg-red-50 border-l-4 border-red-400 rounded-xl p-4">
          <p className="text-red-800 font-medium text-sm">🔒 {tenant?.status === 'cancelled' ? 'Assinatura cancelada' : tenant?.status === 'suspended' ? 'Assinatura suspensa' : 'Período de teste encerrado'}</p>
          <p className="text-red-700 text-sm mt-1">O WhatsApp foi desconectado. Escolha um plano abaixo para reativar o atendimento.</p>
        </div>
      ) : tenant?.status === 'trial' && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded-xl p-4">
          <p className="text-yellow-800 font-medium text-sm">⏰ Período de teste ativo</p>
          <p className="text-yellow-700 text-sm mt-1">Assine um plano para continuar usando após o período de teste.</p>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(plans ?? []).map((plan: any) => {
          const isCurrent = tenant?.plan === plan.slug
          const isFree = plan.price_cents <= 0
          const features: string[] = Array.isArray(plan.features) && plan.features.length
            ? plan.features
            : [`${plan.max_agendas} agenda${plan.max_agendas > 1 ? 's' : ''}`, `${plan.max_users} usuário${plan.max_users > 1 ? 's' : ''}`, 'Bot WhatsApp IA']
          return (
            <div key={plan.slug} className={`bg-white rounded-2xl p-5 border-2 shadow-sm flex flex-col ${isCurrent ? 'border-primary' : 'border-gray-100'}`}>
              {isCurrent && <span className="text-xs font-semibold text-primary mb-2">✓ Plano atual</span>}
              {!isCurrent && <span className="mb-5" />}
              <p className="font-bold text-gray-900">{plan.name}</p>
              <p className="text-primary font-bold text-lg mt-1">{fmtPrice(plan.price_cents)}</p>
              <div className="mt-3 space-y-1 flex-1">
                {features.map((f, i) => <p key={i} className="text-gray-500 text-xs">✓ {f}</p>)}
              </div>
              {!isCurrent && !isFree && (
                <button
                  onClick={() => checkout.mutate(plan.slug)}
                  disabled={checkout.isPending}
                  className="mt-4 w-full h-9 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
                  {checkout.isPending && pendingPlan === plan.slug ? 'Redirecionando...' : 'Assinar'}
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
