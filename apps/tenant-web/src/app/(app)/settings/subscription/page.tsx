'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tenantApi, subscriptionApi } from '@/lib/api'
import { useModalA11y } from '@/lib/useModalA11y'

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

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtPrice = (cents: number) => cents <= 0 ? 'Grátis' : `${brl(cents)}/mês`

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

// PAY-6: `notice` explica a mudança de cobrança em upgrade/downgrade.
// amount_cents = valor a cobrar no ciclo escolhido (mensal ou anual).
type Plan = { slug: string; name: string; price_cents: number; amount_cents: number; billing_period: 'monthly' | 'annual'; notice?: string }

function CheckoutModal({ plan, onClose, onSuccess }: { plan: Plan; onClose: () => void; onSuccess: () => void }) {
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [fatalError, setFatalError] = useState('')
  const [error, setError] = useState('')
  const brickRef = useRef<{ unmount?: () => void } | null>(null)
  // UI-8: ESC fecha + focus trap básico
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

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
          initialization: { amount: plan.amount_cents / 100 },
          customization: { paymentMethods: { maxInstallments: 1 } },
          callbacks: {
            onReady: () => { if (!cancelled) setLoading(false) },
            onSubmit: (formData: { token?: string }) => {
              setError('')
              return new Promise<void>((resolve, reject) => {
                subscriptionApi.checkout(plan.slug, formData?.token, plan.billing_period)
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
  }, [plan.slug, plan.amount_cents, onSuccess])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Assinar plano"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto focus:outline-none">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Assinar plano</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Fechar">✕</button>
        </div>

        <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
          <span className="font-semibold text-gray-900">{plan.name} {plan.billing_period === 'annual' ? '(anual)' : '(mensal)'}</span>
          <span className="text-primary font-bold">{brl(plan.amount_cents)}{plan.billing_period === 'annual' ? '/ano' : '/mês'}</span>
        </div>

        {/* PAY-6: aviso sobre a mudança de cobrança (upgrade/downgrade) */}
        {plan.notice && (
          <div className="bg-blue-50 border border-blue-100 text-blue-800 rounded-xl px-4 py-3 text-sm">{plan.notice}</div>
        )}

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

function CancelDialog({ cancelling, cancelError, onClose, onConfirm }: {
  cancelling: boolean
  cancelError: string
  onClose: () => void
  onConfirm: () => void
}) {
  // UI-8: ESC fecha (respeitando o "cancelando...") + focus trap básico
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Cancelar assinatura"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 space-y-4 focus:outline-none">
        <h2 className="text-lg font-bold text-gray-900">Cancelar assinatura?</h2>
        {/* PAY-5: deixa explícito que o cancelamento vale NA HORA (não até o fim do ciclo). */}
        <p className="text-gray-600 text-sm">
          O cancelamento é <strong>imediato</strong>: sua conta volta para o plano gratuito agora mesmo —
          o acesso <strong>não</strong> permanece até o fim do período já pago. Você pode assinar novamente quando quiser.
        </p>
        {cancelError && <div role="alert" className="bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">{cancelError}</div>}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={cancelling}
            className="flex-1 h-10 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
            Voltar
          </button>
          <button
            onClick={onConfirm}
            disabled={cancelling}
            className="flex-1 h-10 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
            {cancelling ? 'Cancelando...' : 'Cancelar agora'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SubscriptionPage() {
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null)
  const [success, setSuccess] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelled, setCancelled] = useState(false)
  const [period, setPeriod] = useState<'monthly' | 'annual'>('monthly')
  const queryClient = useQueryClient()
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: plans } = useQuery({ queryKey: ['sub-plans'], queryFn: subscriptionApi.plans })
  const { data: sub } = useQuery({ queryKey: ['sub-me'], queryFn: subscriptionApi.me })
  const { data: payments = [] } = useQuery({ queryKey: ['sub-payments'], queryFn: subscriptionApi.payments })
  const anyAnnualDiscount = (plans ?? []).some((p: any) => (p.annual_discount_pct ?? 0) > 0)

  const trialExpired = tenant?.status === 'trial' && tenant?.trial_ends_at && new Date(tenant.trial_ends_at).getTime() < Date.now()
  const blocked = trialExpired || tenant?.status === 'suspended' || tenant?.status === 'cancelled'
  const hasActivePaid = tenant?.status === 'active' && !!tenant?.plan && tenant.plan !== 'free'

  const handleSuccess = useCallback(() => {
    setCheckoutPlan(null)
    setSuccess(true)
    setCancelled(false)
    queryClient.invalidateQueries({ queryKey: ['tenant'] })
    queryClient.invalidateQueries({ queryKey: ['sub-me'] })
    queryClient.invalidateQueries({ queryKey: ['sub-payments'] })
  }, [queryClient])

  const handleCancelSubscription = useCallback(async () => {
    setCancelling(true)
    setCancelError('')
    try {
      await subscriptionApi.cancel()
      setCancelOpen(false)
      setCancelled(true)
      setSuccess(false)
      queryClient.invalidateQueries({ queryKey: ['tenant'] })
      queryClient.invalidateQueries({ queryKey: ['sub-me'] })
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : ''
      setCancelError(msg || 'Não foi possível cancelar agora. Tente novamente ou fale com o suporte.')
    } finally {
      setCancelling(false)
    }
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

      {cancelled && (
        <div className="bg-green-50 border-l-4 border-green-400 rounded-xl p-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-green-800 font-medium text-sm">Assinatura cancelada</p>
            <p className="text-green-700 text-sm mt-1">Sua conta voltou para o plano gratuito. Você pode assinar novamente quando quiser.</p>
          </div>
          <button onClick={() => setCancelled(false)} className="text-green-600 hover:text-green-800 text-lg leading-none" aria-label="Fechar">✕</button>
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

      {/* Toggle mensal / anual */}
      <div className="inline-flex rounded-xl bg-gray-100 p-1">
        <button
          onClick={() => setPeriod('monthly')}
          className={`px-4 h-9 text-sm font-semibold rounded-lg transition-colors ${period === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Mensal
        </button>
        <button
          onClick={() => setPeriod('annual')}
          className={`px-4 h-9 text-sm font-semibold rounded-lg transition-colors ${period === 'annual' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
          Anual{anyAnnualDiscount ? ' • economize' : ''}
        </button>
      </div>

      {/* UI-9: 1 coluna no mobile, subindo até 4 em telas grandes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(plans ?? []).map((plan: any) => {
          const isCurrent = tenant?.plan === plan.slug
          const isFree = plan.price_cents <= 0
          const discountPct = plan.annual_discount_pct ?? 0
          const annualCents = plan.annual_price_cents ?? Math.round(plan.price_cents * 12)
          const cycleCents = period === 'annual' ? annualCents : plan.price_cents
          // PAY-6: upgrade x downgrade em relação ao plano pago ativo
          const currentPrice = Number((plans ?? []).find((p: any) => p.slug === tenant?.plan)?.price_cents ?? 0)
          const isUpgrade = hasActivePaid && plan.price_cents > currentPrice
          const isDowngrade = hasActivePaid && plan.price_cents < currentPrice && !isFree
          const changeNotice = isUpgrade
            ? 'Você está fazendo um upgrade: a nova cobrança (maior) substitui a atual e passa a valer imediatamente.'
            : isDowngrade
              ? 'Você está fazendo um downgrade: a cobrança menor e os novos limites do plano passam a valer imediatamente.'
              : undefined
          const features: string[] = Array.isArray(plan.features) && plan.features.length
            ? plan.features
            : [`${plan.max_agendas} agenda${plan.max_agendas > 1 ? 's' : ''}`, `${plan.max_users} usuário${plan.max_users > 1 ? 's' : ''}`, 'Bot WhatsApp IA']
          return (
            <div key={plan.slug} className={`bg-white rounded-2xl p-5 border-2 shadow-sm flex flex-col ${isCurrent ? 'border-primary' : 'border-gray-100'}`}>
              {isCurrent && <span className="text-xs font-semibold text-primary mb-2">✓ Plano atual</span>}
              {!isCurrent && <span className="mb-5" />}
              <p className="font-bold text-gray-900">{plan.name}</p>
              <p className="text-primary font-bold text-lg mt-1">
                {isFree ? 'Grátis' : `${brl(cycleCents)}${period === 'annual' ? '/ano' : '/mês'}`}
              </p>
              {!isFree && period === 'annual' && discountPct > 0 && (
                <p className="text-green-600 text-xs font-semibold mt-0.5">de {brl(plan.price_cents * 12)} — economize {discountPct}%</p>
              )}
              <div className="mt-3 space-y-1 flex-1">
                {features.map((f, i) => <p key={i} className="text-gray-500 text-xs">✓ {f}</p>)}
              </div>
              {!isCurrent && !isFree && (
                <>
                  <button
                    onClick={() => { setSuccess(false); setCheckoutPlan({ slug: plan.slug, name: plan.name, price_cents: plan.price_cents, amount_cents: cycleCents, billing_period: period, notice: changeNotice }) }}
                    className={`mt-4 w-full h-9 text-sm font-semibold rounded-xl transition-colors ${
                      isDowngrade
                        ? 'border border-primary text-primary hover:bg-primary/5'
                        : 'bg-primary hover:bg-primary-dark text-white'
                    }`}>
                    {isUpgrade ? 'Fazer upgrade' : isDowngrade ? 'Fazer downgrade' : 'Assinar'}
                  </button>
                  {changeNotice && (
                    <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">
                      {isUpgrade ? 'A nova cobrança substitui a atual imediatamente.' : 'Limites e cobrança menores valem imediatamente.'}
                    </p>
                  )}
                </>
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
            ...(sub?.billing_period ? [{ label: 'Cobrança', value: sub.billing_period === 'annual' ? 'Anual' : 'Mensal' }] : []),
            ...(hasActivePaid && sub?.next_billing_date ? [{ label: sub.status === 'cancelled' ? 'Acesso até' : 'Renova em', value: new Date(sub.next_billing_date).toLocaleDateString('pt-BR') }] : []),
            ...(tenant?.trial_ends_at ? [{ label: 'Teste até', value: new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR') }] : []),
          ].map((row) => (
            <div key={row.label} className="flex gap-2">
              <span className="text-gray-400">{row.label}:</span>
              <span className="text-gray-900 font-medium capitalize">{String(row.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {hasActivePaid && (
        <div className="flex justify-center">
          <button
            onClick={() => { setCancelError(''); setCancelOpen(true) }}
            className="text-red-500 hover:text-red-700 text-sm font-medium transition-colors">
            Cancelar assinatura
          </button>
        </div>
      )}

      {/* Histórico de cobranças */}
      {payments.length > 0 && (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
          <p className="font-semibold text-gray-900 mb-3">Histórico de cobranças</p>
          <div className="divide-y divide-gray-50">
            {payments.map((pmt) => (
              <div key={pmt.mp_payment_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="text-gray-900 font-medium">{brl(pmt.amount_cents)}</span>
                <span className="text-gray-400 text-xs flex-1 text-center">{pmt.paid_at ? new Date(pmt.paid_at).toLocaleDateString('pt-BR') : '—'}</span>
                <span className={`text-xs font-semibold ${pmt.status === 'approved' ? 'text-green-600' : pmt.status === 'rejected' ? 'text-red-500' : 'text-yellow-600'}`}>
                  {pmt.status === 'approved' ? 'Pago' : pmt.status === 'rejected' ? 'Recusado' : pmt.status === 'refunded' ? 'Estornado' : (pmt.status ?? '—')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-gray-400 text-xs text-center">Pagamentos processados com segurança via Mercado Pago</p>

      {cancelOpen && (
        <CancelDialog
          cancelling={cancelling}
          cancelError={cancelError}
          onClose={() => { if (!cancelling) setCancelOpen(false) }}
          onConfirm={handleCancelSubscription}
        />
      )}

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
