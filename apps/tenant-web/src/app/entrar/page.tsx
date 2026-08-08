'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { setToken } from '@/lib/api'

// Handoff app → web: o app abre esta rota com um token de curta duração na URL
// (?token=...&next=/settings/subscription). Guardamos a sessão, LIMPAMOS a URL
// (para o token não ficar no histórico) e seguimos para o destino. Assim o
// usuário chega já logado e não precisa autenticar de novo.
export default function EntrarPage() {
  const router = useRouter()
  const [error, setError] = useState(false)

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const token = sp.get('token')
    const nextRaw = sp.get('next') || '/dashboard'
    // Evita open-redirect: só caminhos internos.
    const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard'

    if (!token) {
      router.replace('/login')
      return
    }
    try {
      setToken(token)
      // Remove o token da URL antes de navegar (não fica no histórico).
      window.history.replaceState({}, '', '/entrar')
      router.replace(next)
    } catch {
      setError(true)
    }
  }, [router])

  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      {error ? (
        <div className="space-y-3">
          <p className="text-gray-700">Não foi possível entrar automaticamente.</p>
          <a href="/login" className="text-primary hover:underline">Fazer login</a>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-gray-600">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-primary" />
          Entrando…
        </div>
      )}
    </main>
  )
}
