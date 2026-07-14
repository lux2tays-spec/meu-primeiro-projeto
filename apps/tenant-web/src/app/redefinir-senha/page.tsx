'use client'
import { Suspense, useState, FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { authApi } from '@/lib/api'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [tokenFailed, setTokenFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)
    try {
      await authApi.resetPassword(token, password)
      setSuccess(true)
    } catch {
      // Invalid/expired token (or network) — never surface raw backend errors.
      setTokenFailed(true)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="space-y-4 text-center">
        <div className="bg-green-50 text-green-700 text-sm rounded-lg px-4 py-3">
          Senha redefinida! Faça login.
        </div>
        <Link
          href="/login"
          className="inline-flex items-center justify-center w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors"
        >
          Ir para o login
        </Link>
      </div>
    )
  }

  if (!token || tokenFailed) {
    return (
      <div className="space-y-4 text-center">
        <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">
          Este link é inválido ou expirou. Solicite um novo link para redefinir sua senha.
        </div>
        <Link
          href="/esqueci-senha"
          className="inline-flex items-center justify-center w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors"
        >
          Solicitar novo link
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          placeholder="Mínimo de 8 caracteres"
          minLength={8}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          placeholder="Repita a nova senha"
          minLength={8}
          required
        />
      </div>
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
      >
        {loading ? 'Redefinindo...' : 'Redefinir senha'}
      </button>
    </form>
  )
}

export default function RedefinirSenhaPage() {
  return (
    <div className="min-h-screen bg-sidebar flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-4">
            <span className="text-white text-2xl font-black">AB</span>
          </div>
          <h1 className="text-white text-2xl font-bold">Redefinir senha</h1>
          <p className="text-gray-400 text-sm mt-1">Escolha uma nova senha para sua conta</p>
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-xl">
          {/* useSearchParams requires a Suspense boundary in Next 14 */}
          <Suspense fallback={null}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
