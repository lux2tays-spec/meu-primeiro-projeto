'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authApi } from '@/lib/api'
import BrandLogo from '@/components/BrandLogo'

function Content() {
  const params = useSearchParams()
  const token = params.get('token') ?? ''
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setErrorMsg('Link inválido.')
      return
    }

    authApi.confirmEmailChange(token)
      .then(() => setStatus('success'))
      .catch((err) => {
        setStatus('error')
        setErrorMsg(err.message ?? 'Link inválido ou expirado.')
      })
  }, [token])

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
        <div className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          <div className="text-green-500 text-5xl mb-3">✓</div>
          <h2 className="text-gray-900 text-xl font-bold mb-1">E-mail alterado!</h2>
          <p className="text-gray-500 text-sm">Use o novo e-mail no próximo login.</p>
          <Link href="/dashboard" className="block w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors flex items-center justify-center text-sm">
            Ir para o painel
          </Link>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-white rounded-2xl p-6 shadow-xl space-y-4">
          <div className="text-red-500 text-5xl mb-1">✕</div>
          <h2 className="text-gray-900 text-xl font-bold">Ops!</h2>
          <p className="text-gray-600 text-sm">{errorMsg}</p>
          <Link href="/login" className="block text-sm text-primary font-semibold hover:underline">
            Ir para o login
          </Link>
        </div>
      )}
    </div>
  )
}

export default function ConfirmarTrocaEmailPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  )
}
