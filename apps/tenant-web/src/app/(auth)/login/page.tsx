'use client'
import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authApi, setToken } from '@/lib/api'
import { isTenantToken } from '@/lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { token } = await authApi.login(email.trim().toLowerCase(), password)
      if (!isTenantToken(token)) {
        setError('Acesso negado. Use o painel root para contas administrativas.')
        return
      }
      setToken(token)
      router.replace('/dashboard')
    } catch (err: any) {
      if (err.message === 'email_not_verified') {
        router.replace(`/aguardando-verificacao?email=${encodeURIComponent(email.trim().toLowerCase())}`)
        return
      }
      setError(err.message ?? 'Credenciais inválidas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-4">
          <span className="text-white text-2xl font-black">AB</span>
        </div>
        <h1 className="text-white text-2xl font-bold">AgendaBot</h1>
        <p className="text-gray-400 text-sm mt-1">Seu atendimento no piloto automático</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 shadow-xl space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="seu@email.com"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-11 px-4 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="••••••••"
            required
          />
        </div>
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        <p className="text-center text-sm text-gray-500">
          Ainda não tem conta?{' '}
          <Link href="/register" className="text-primary font-semibold hover:underline">
            Criar conta grátis
          </Link>
        </p>
      </form>
    </div>
  )
}
