'use client'

// Catches errors thrown in the root layout itself. Must render its own <html>/<body>.
// Same rule: no stack trace for end users — just a friendly, self-contained message
// (no external chunks/fonts so it renders even if the app bundle is broken).
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#F9FAFB' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: '#EDE9FF', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6C47FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>Algo deu errado</h1>
            <p style={{ fontSize: 14, color: '#6B7280', marginTop: 8 }}>
              Tivemos um problema inesperado. Já registramos o ocorrido. Tente novamente.
            </p>
            <button
              onClick={reset}
              style={{ marginTop: 24, background: '#6C47FF', color: '#fff', fontSize: 14, fontWeight: 600, padding: '10px 20px', borderRadius: 12, border: 'none', cursor: 'pointer' }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
