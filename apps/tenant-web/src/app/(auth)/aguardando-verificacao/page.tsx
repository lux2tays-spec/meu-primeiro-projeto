'use client'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'

function Content() {
  const params = useSearchParams()
  const email = params.get('email') ?? 'seu e-mail'

  return (
    <div className="w-full max-w-sm text-center">
      <div className="inline-flex w-16 h-16 rounded-2xl bg-primary items-center justify-center mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>

      <h1 className="text-white text-2xl font-bold mb-2">Verifique seu e-mail</h1>
      <p className="text-gray-300 text-sm mb-6">
        Enviamos um link de confirmação para<br />
        <span className="text-white font-semibold">{email}</span>
      </p>

      <div className="bg-white rounded-2xl p-6 shadow-xl text-left space-y-3">
        <p className="text-gray-600 text-sm">
          Clique no link que enviamos para confirmar seu e-mail e ativar sua conta.
        </p>
        <p className="text-gray-500 text-xs">
          Não recebeu? Verifique a pasta de spam ou lixo eletrônico.
        </p>
        <div className="pt-2 border-t border-gray-100">
          <p className="text-center text-sm text-gray-500">
            Já confirmou?{' '}
            <Link href="/login" className="text-primary font-semibold hover:underline">Entrar</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AguardandoVerificacaoPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  )
}
