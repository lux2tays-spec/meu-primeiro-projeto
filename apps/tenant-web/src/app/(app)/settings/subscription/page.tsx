'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tenantApi, subscriptionApi } from '@/lib/api'

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => {
      bricks: () => {
        create: (
          brick: string,
          containerId: string,
          settings: Record<string, unknown>,
        ) => Promise<{ unmount?: () => void }>
      }
    }
  }
}

const MP_SDK_URL = 'https://sdk.mercadopago.com/js/v2'
const GENERIC_ERROR = 'Não foi possível processar o cartão. Verifique os dados e tente novamente.'

const fmtPrice = (cents: number) => cents <= 0 ? 'Grátis' : `R$ ${(cents / 100).toFixed(0)}/mês`

/** Loads the Mercado Pago SDK once and resolves when window.MercadoPago is available. */
let mpSdkPromise: Promise<void> | null = null
function loadMercadoPagoSdk(): Promise<void> {
  if (typeof window !== 'undefined' && window.MercadoPago) return Promise.resolve()
  if (mpSdkPromise) return mpSdkPromise
  mpSdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = MP_SDK_URL
    script.async = true
    script.onload = () => {
      if (window.MercadoPago) resolve()
      else reject(new Error('SDK indisponível'))
    }
    script.onerror = () => {
      mpSdkPromise = null // allow retry on next open
      script.remove()
      reject(new Error('Falha ao carregar o SDK'))
    }
    document.head.appendChild(script)
  })
  return mpSdkPromise
}

type Plan = { slug: string; name: string; price_cents: number }

function CheckoutModal({ plan, onClose, onSuccess }: { plan: Plan; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [fatalError, setFatalError] = useState('')
  const [error, setError] = useState('')
  const brickRef = useRef<{ unmount?: () => void } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const info = await subscriptionApi.paymentInfo()
        if (cancelled) return
        if (!info.available || !info.public_key) {
          setUnavailable(true)
          setLoading(false)
          return
        }

        await loadMercadoPagoSdk()
        if (cancelled || !window.MercadoPago) {
          if (!cancelled) {
            setFatalError('Não foi possível carregar o formulário de pagamento. Tente novamente em instantes.')
            setLoading(false)
          }
          return
        }

        const mp = new window.MercadoPago(info.public_key, { locale: 'pt-BR' })
        const bricks = mp.bricks()
        const controller = await bricks.create('cardPayment', 'mp-card-container', {
          initialization: { amount: plan.price_cents / 100 },
          customization: { paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => { if (!cancelled) setLoading(false) },
            onSubmit: (formData: { token?: string }) => {
              setError('')
              return new Promise<void>((resolve, reject) => {
                subscriptionApi.checkout(plan.slug, formData?.token)
                  .then(() => { resolve(); onSuccess() })
                  .catch((e: unknown) => {
                    const msg = e instanceof Error && e.message ? e.message : ''
                    setError(msg || GENERIC_ERROR)
                    reject()
                  })
              })
            },
            onError: (err: unknown) => {
              console.error('[MercadoPago Brick]', err)
              if (!cancelled) setError(GENERIC_ERROR)
            },
          },
        })
        if (cancelled) {
          try { controller.unmount?.() } catch { /* already gone */ }
          return
        }
        brickRef.current = controller
      } catch (e) {
        console.error('[Checkout]', e)
        if (!cancelled) {
          setFatalError('Não foi possível carregar o formulário de pagamento. Verifique sua conexão e tente novamente.')
          setLoading(false)
        }
      }
    }

    init()
    return () => {
      cancelled = true
      try { brickRef.current?.unmount?.() } catch { /* already gone */ }
      brickRef.current = null
    }
  }, [plan.slug, plan.price_cents, onSuccess])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Assinar plano</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Fechar">✕</button>
        </div>

        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <span className="font-semibold text-gray-900">{plan.name}</span>
          <span className="text-primary font-bold">{fmtPrice(plan.price_cents)}</span>
        </div>

        {unavailable ? (
          <div className="bg-yellow-50 text-yellow-800 rounded-xl px-4 py-3 text-sm">
            As assinaturas estarão disponíveis em breve.
          </div>
        ) : fatalError ? (
          <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{fatalError}</div>
        ) : (
          <>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
                <span className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-primary animate-spin" />
                Carregando formulário seguro...
              </div>
            )}
            {error && <div className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
            <div id="mp-card-container" />
            <p className="text-gray-400 text-xs text-center">🔒 Dados do cartão processados com segurança pelo Mercado Pago</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function SubscriptionPage() {
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null)
  const [success, setSuccess] = useState(false)
  const queryClient = useQueryClient()
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: plans } = useQuery({ queryKey: ['sub-plans'], queryFn: subscriptionApi.plans })

  const trialExpired = tenant?.status === 'trial' && tenant?.trial_ends_at && new Date(tenant.trial_ends_at).getTime() < Date.now()
  const blocked = trialExpired || tenant?.status === 'suspended' || tenant?.status === 'cancelled'

  const handleSuccess = useCallback(() => {
    setCheckoutPlan(null)
    setSuccess(true)
    queryClient.invalidateQueries({ queryKey: ['tenant'] })
  }, [queryClient])

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Assinatura</h1>

      {success && (
        <div className="bg-green-50 border-l-4 border-green-400 rounded-xl p-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-green-800 font-medium text-sm">Assinatura ativada! 🎉</p>
            <p className="text-green-700 text-sm mt-1">Seu plano já está ativo. Bom trabalho!</p>
          </div>
          <button onClick={() => setSuccess(false)} className="text-green-600 hover:text-green-800 text-lg leading-none" aria-label="Fechar">✕</button>
        </div>
      )}

      {blocked ? (
        <div className="bg-red-50 border-l-4 border-red-400 rounded-xl p-4">
          <p className="text-red-800 font-medium text-sm">🔒 {tenant?.status === 'cancelled' ? 'Assinatura cancelada' : tenant?.status === 'suspended' ? 'Assinatura suspensa' : 'Período de teste encerrado'}</p>
          <p className="text-red-700 text-sm mt-1">O WhatsApp foi desconectado. Escolha um plano abaixo para reativar o atendimento.</p>
        </div>
      ) : tenant?.status === 'trial' && !success && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 rounded-xl p-4">
          <p className="text-yellow-800 font-medium text-sm">⏰ Período de teste ativo</p>
          <p className="text-yellow-700 text-sm mt-1">Assine um plano para continuar usando após o período de teste.</p>
        </div>
      )}

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
                  onClick={() => { setSuccess(false); setCheckoutPlan({ slug: plan.slug, name: plan.name, price_cents: plan.price_cents }) }}
                  className="mt-4 w-full h-9 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors">
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

      {checkoutPlan && (
        <CheckoutModal
          key={checkoutPlan.slug}
          plan={checkoutPlan}
          onClose={() => setCheckoutPlan(null)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
