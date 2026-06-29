'use client'
import { useState, FormEvent, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authApi, setToken } from '@/lib/api'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: object) => void
          renderButton: (el: HTMLElement, cfg: object) => void
          prompt: () => void
        }
      }
    }
  }
}

type Step = 'form' | 'google-business'

export default function RegisterPage() {
  const router = useRouter()
  const googleBtnRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<Step>('form')
  const [pendingGoogleToken, setPendingGoogleToken] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    business_name: '',
    referral_code: '',
  })

  const [googleExtra, setGoogleExtra] = useState({
    business_name: '',
    phone: '',
    referral_code: '',
  })

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function setGE(field: string, value: string) {
    setGoogleExtra((f) => ({ ...f, [field]: value }))
  }

  // ── Google Identity Services ─────────────────────────────────────────────
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    if (!clientId) return

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => initGoogle(clientId)
    document.head.appendChild(script)
    return () => { document.head.removeChild(script) }
  }, [])

  function initGoogle(clientId: string) {
    if (!window.google) return
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential,
    })
    if (googleBtnRef.current) {
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: 'outline',
        size: 'large',
        width: '100%',
        text: 'continue_with',
        locale: 'pt-BR',
      })
    }
  }

  async function handleGoogleCredential(response: { credential: string }) {
    setError('')
    setLoading(true)
    try {
      const res = await authApi.googleAuth({ id_token: response.credential })
      setToken(res.token)
      router.replace('/dashboard')
    } catch (err: any) {
      if (err.message === 'business_name_required' || err.message?.includes('Informe')) {
        setPendingGoogleToken(response.credential)
        setStep('google-business')
      } else {
        setError(err.message ?? 'Erro ao entrar com Google')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleBusiness(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.googleAuth({
        id_token: pendingGoogleToken,
        business_name: googleExtra.business_name,
        phone: googleExtra.phone || undefined,
        referral_code: googleExtra.referral_code || undefined,
      })
      setToken(res.token)
      router.replace('/dashboard')
    } catch (err: any) {
      setError(err.message ?? 'Erro ao criar conta')
    } finally {
      setLoading(false)
    }
  }

  // ── Email+senha ─────────────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload: Parameters<typeof authApi.register>[0] = {
        name: form.name,
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        password: form.password,
        business_name: form.business_name,
      }
      if (form.referral_code) payload.referral_code = form.referral_code
      await authApi.register(payload)
      router.replace(`/aguardando-verificacao?email=${encodeURIComponent(form.email)}`)
    } catch (err: any) {
      setError(err.message ?? 'Erro ao criar conta')
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent'

  // ── Google extra info modal ──────────────────────────────────────────────
  if (step === 'google-business') {
    return (
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-4">
            <span className="text-white text-2xl font-black">AB</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Quase lá!</h1>
          <p className="text-gray-400 text-sm mt-1">Só precisamos de mais algumas informações</p>
        </div>
        <form onSubmit={handleGoogleBusiness} className="bg-white rounded-2xl p-8 shadow-xl space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do negócio</label>
            <input
              type="text"
              value={googleExtra.business_name}
              onChange={(e) => setGE('business_name', e.target.value)}
              placeholder="Clínica Bella"
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone (WhatsApp)</label>
            <input
              type="tel"
              value={googleExtra.phone}
              onChange={(e) => setGE('phone', e.target.value)}
              placeholder="(11) 99999-9999"
              className={inputCls}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código de indicação/Desconto (opcional)</label>
            <input
              type="text"
              value={googleExtra.referral_code}
              onChange={(e) => setGE('referral_code', e.target.value)}
              placeholder="ABC123"
              className={inputCls}
            />
          </div>
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? 'Criando conta...' : 'Começar gratuitamente'}
          </button>
          <button type="button" onClick={() => setStep('form')} className="w-full text-sm text-gray-500 hover:underline">
            Voltar
          </button>
        </form>
      </div>
    )
  }

  // ── Formulário principal ─────────────────────────────────────────────────
  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-4">
          <span className="text-white text-2xl font-black">AB</span>
        </div>
        <h1 className="text-white text-2xl font-bold">Criar conta grátis</h1>
        <p className="text-gray-400 text-sm mt-1">5 dias de teste, sem cartão</p>
      </div>

      <div className="bg-white rounded-2xl p-8 shadow-xl space-y-4">
        {/* Google button */}
        {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
          <>
            <div ref={googleBtnRef} className="w-full flex justify-center" />
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">ou</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome (Responsável pelo negócio)</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="João Silva"
              className={inputCls}
              required
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="seu@email.com"
              className={inputCls}
              required
            />
          </div>

          {/* Senha com olho */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className={`${inputCls} pr-11`}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
                aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPass ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Telefone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone (WhatsApp)</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="(11) 99999-9999"
              className={inputCls}
              required
            />
          </div>

          {/* Nome do negócio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do negócio</label>
            <input
              type="text"
              value={form.business_name}
              onChange={(e) => set('business_name', e.target.value)}
              placeholder="Clínica Bella"
              className={inputCls}
              required
            />
          </div>

          {/* Código de indicação */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Código de indicação/Desconto (opcional)</label>
            <input
              type="text"
              value={form.referral_code}
              onChange={(e) => set('referral_code', e.target.value)}
              placeholder="ABC123"
              className={inputCls}
            />
          </div>

          {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {loading ? 'Criando conta...' : 'Começar gratuitamente'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Já tem conta?{' '}
            <Link href="/login" className="text-primary font-semibold hover:underline">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
