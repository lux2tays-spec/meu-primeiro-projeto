'use client'

// Friendly error boundary for the tenant app. End users (business owners/staff)
// must NEVER see a stack trace — only an intuitive message with a way to recover.
// The technical detail is logged to the console for diagnosis, not shown.
import { useEffect } from 'react'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log for diagnostics (console/telemetry), never render to the user.
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary-light flex items-center justify-center mb-5">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6C47FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900">Algo deu errado por aqui</h1>
        <p className="text-sm text-gray-500 mt-2">
          Tivemos um problema ao carregar esta tela. Já registramos o ocorrido. Tente novamente em instantes.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
          <button
            onClick={reset}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Tentar novamente
          </button>
          <a
            href="/dashboard"
            className="bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  )
}
