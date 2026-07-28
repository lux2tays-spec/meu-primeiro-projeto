'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authApi, setToken, friendlyMessage } from '@/lib/api'
import BrandLogo from '@/components/BrandLogo'

function Content() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  // AUTH-16: a ação primária no erro é REENVIAR o e-mail de confirmação (o link
  // pode só ter expirado) — criar outra conta fica como caminho secundário.
  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  const [resendErr, setResendErr] = useState('')
  const [cooldown, setCooldown] = useState(false)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Link inválido.')
      return
    }

    authApi.verifyEmail(token)
      .then((res) => {
        setToken(res.token)
        setStatus('success')
        setTimeout(() => router.replace('/dashboard'), 2000)
      })
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err.message ?? 'Link inválido ou expirado.')
      })
  }, [token, router])

  async function resend() {
    setResendMsg('')
    setResendErr('')
    const target = resendEmail.trim().toLowerCase()
    if (!target || !target.includes('@')) {
      setResendErr('Informe o e-mail usado no cadastro.')
      return
    }
    setResending(true)
    try {
      await authApi.resendVerification(target)
      setResendMsg('Enviamos um novo link de confirmação. Confira sua caixa de entrada e o spam.')
      setCooldown(true)
      setTimeout(() => setCooldown(false), 30000) // evita spam de reenvio
    } catch (e: unknown) {
      setResendErr(friendlyMessage(e, 'Não foi possível reenviar agora. Tente novamente em instantes.'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="w-full max-w-sm text-center">
      <BrandLogo variant="mark" size={64} className="mb-6" />

      {status === 'loading' && (
        <>
          <h1 className="text-white text-2xl font-bold mb-2">Confirmando...</h1>
          <p className="text-gray-400 text-sm">Aguarde um momento.</p>
        </>
      )}

      {status === 'success' && (
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <div className="text-green-500 text-5xl mb-3">✓</div>
          <h2 className="text-gray-900 text-xl font-bold mb-1">E-mail confirmado!</h2>
          <p className="text-gray-500 text-sm">Redirecionando para o painel...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          <div className="text-red-500 text-5xl mb-1">✕</div>
          <h2 className="text-gray-900 text-xl font-bold">Ops!</h2>
          <p role="alert" className="text-gray-600 text-sm">{errorMsg}</p>
          <p className="text-gray-500 text-xs">
            O link pode ter expirado. Informe seu e-mail abaixo e enviaremos um novo link de confirmação.
          </p>

          <div className="text-left">
            <label htmlFor="resend-email" className="block text-sm font-medium text-gray-700 mb-1">E-mail do cadastro</label>
            <input
              id="resend-email"
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {resendErr && <p role="alert" className="text-red-600 text-sm bg-red-50 rounded-xl px-4 py-2">{resendErr}</p>}
          {resendMsg && <p role="status" className="text-green-700 text-sm bg-green-50 rounded-xl px-4 py-2">{resendMsg}</p>}

          <button
            onClick={resend}
            disabled={resending || cooldown}
            className="block w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50 text-sm"
          >
            {resending ? 'Reenviando...' : cooldown ? 'Reenviado ✓' : 'Reenviar e-mail de confirmação'}
          </button>

          <Link href="/login" className="block text-sm text-primary font-semibold hover:underline">
            Já tenho conta — Entrar
          </Link>
          <Link href="/register" className="block text-xs text-gray-400 hover:text-gray-600 hover:underline">
            Criar uma nova conta
          </Link>
        </div>
      )}
    </div>
  )
}

export default function ConfirmarEmailPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  )
}
