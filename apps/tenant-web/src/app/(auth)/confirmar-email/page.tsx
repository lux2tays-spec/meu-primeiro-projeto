'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authApi, setToken } from '@/lib/api'

function Content() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get('token') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

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

  return (
    <div className="w-full max-w-sm text-center">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-6">
        <span className="text-white text-2xl font-black">AB</span>
      </div>

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
          <p className="text-gray-600 text-sm">{errorMsg}</p>
          <Link href="/register" className="block w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors flex items-center justify-center text-sm">
            Criar nova conta
          </Link>
          <Link href="/login" className="block text-sm text-primary font-semibold hover:underline">
            Já tenho conta — Entrar
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
