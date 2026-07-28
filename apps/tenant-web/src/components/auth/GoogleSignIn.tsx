'use client'
import { useEffect, useRef, useState, FormEvent } from 'react'
import { authApi } from '@/lib/api'
import { useGoogleClientId } from '@/lib/google'
import { formatBRPhone, normalizeBRPhone, isValidBRPhone } from '@/lib/phone'

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

/**
 * Google Sign-In (works as login AND signup — Google emails are pre-verified so
 * these accounts skip the e-mail confirmation flow). For brand-new accounts the
 * backend asks for the business name; we ALSO require a phone (WhatsApp) before
 * creating the account. Renders nothing if NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset.
 */
export default function GoogleSignIn({
  onAuthenticated,
  referralCode,
}: {
  onAuthenticated: (token: string) => void
  referralCode?: string
}) {
  const btnRef = useRef<HTMLDivElement>(null)
  const [pendingToken, setPendingToken] = useState('')
  const [needExtra, setNeedExtra] = useState(false)
  const [extra, setExtra] = useState({ business_name: '', phone: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const clientId = useGoogleClientId()

  useEffect(() => {
    if (!clientId) return
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => init(clientId)
    document.head.appendChild(script)
    return () => {
      try { document.head.removeChild(script) } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  function init(cid: string) {
    if (!window.google || !btnRef.current) return
    window.google.accounts.id.initialize({ client_id: cid, callback: onCredential })
    window.google.accounts.id.renderButton(btnRef.current, {
      theme: 'outline', size: 'large', width: '100%', text: 'continue_with', locale: 'pt-BR',
    })
  }

  async function onCredential(response: { credential: string }) {
    setError('')
    setLoading(true)
    try {
      const res = await authApi.googleAuth({ id_token: response.credential, referral_code: referralCode })
      onAuthenticated(res.token)
    } catch (err: any) {
      const msg = String(err?.message ?? '')
      // New account — backend needs business name (and we require phone too).
      if (msg === 'business_name_required' || msg === 'phone_required' || /informe/i.test(msg)) {
        setPendingToken(response.credential)
        setNeedExtra(true)
      } else {
        setError(msg || 'Erro ao entrar com Google')
      }
    } finally {
      setLoading(false)
    }
  }

  async function submitExtra(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!extra.business_name.trim()) return setError('Informe o nome do seu estabelecimento')
    if (!isValidBRPhone(extra.phone)) return setError('Informe um telefone válido com DDD, ex.: (11) 99999-9999')
    setLoading(true)
    try {
      const res = await authApi.googleAuth({
        id_token: pendingToken,
        business_name: extra.business_name.trim(),
        // AUTH-9: telefone normalizado (somente dígitos) no envio
        phone: normalizeBRPhone(extra.phone),
        referral_code: referralCode,
      })
      onAuthenticated(res.token)
    } catch (err: any) {
      setError(err?.message ?? 'Erro ao criar conta')
    } finally {
      setLoading(false)
    }
  }

  if (!clientId) return null

  const inputCls = 'w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent'

  if (needExtra) {
    return (
      <form onSubmit={submitExtra} className="space-y-3 pt-2">
        <p className="text-sm text-gray-600">Só precisamos de mais alguns dados para criar sua conta:</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome do estabelecimento</label>
          <input value={extra.business_name} onChange={(e) => setExtra((s) => ({ ...s, business_name: e.target.value }))}
            className={inputCls} placeholder="Ex.: Studio JackSpa" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Telefone (WhatsApp)</label>
          <input type="tel" value={extra.phone} onChange={(e) => setExtra((s) => ({ ...s, phone: formatBRPhone(e.target.value) }))}
            className={inputCls} placeholder="(11) 99999-9999" />
        </div>
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
        <button type="submit" disabled={loading}
          className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50">
          {loading ? 'Criando conta...' : 'Continuar'}
        </button>
      </form>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs text-gray-400">ou</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>
      <div ref={btnRef} className="flex justify-center [&>div]:w-full" />
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
    </div>
  )
}
