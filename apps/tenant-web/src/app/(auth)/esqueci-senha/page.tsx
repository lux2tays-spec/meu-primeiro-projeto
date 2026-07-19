'use client'
import { useState, FormEvent } from 'react'
import Link from 'next/link'
import { authApi } from '@/lib/api'
import BrandLogo from '@/components/BrandLogo'

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await authApi.forgotPassword(email.trim().toLowerCase())
      setSent(true)
    } catch {
      // Never leak backend/network details — friendly retry message only.
      setError('Não foi possível processar sua solicitação. Verifique sua conexão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <BrandLogo variant="mark" size={64} className="mb-4" />
        <h1 className="text-white text-2xl font-bold">Esqueci minha senha</h1>
        <p className="text-gray-400 text-sm mt-1">Informe seu e-mail para receber o link de redefinição</p>
      </div>

      <div className="bg-white rounded-2xl p-8 shadow-xl">
        {sent ? (
          <div className="space-y-4 text-center">
            <div className="bg-green-50 text-green-700 text-sm rounded-lg px-4 py-3">
              Se o e-mail existir, enviamos um link para redefinir a senha. Confira sua caixa de entrada.
            </div>
            <Link href="/login" className="inline-block text-primary text-sm font-semibold hover:underline">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
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
            {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar link'}
            </button>
            <p className="text-center text-sm text-gray-500">
              Lembrou a senha?{' '}
              <Link href="/login" className="text-primary font-semibold hover:underline">
                Fazer login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
