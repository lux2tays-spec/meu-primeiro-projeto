'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getToken, clearToken, tenantApi } from '@/lib/api'
import { isTenantToken, getTokenPayload } from '@/lib/auth'
import { useQuery } from '@tanstack/react-query'

const NAV = [
  { href: '/dashboard',             icon: '🏠', label: 'Dashboard' },
  { href: '/calendar',              icon: '📅', label: 'Agenda' },
  { href: '/customers',             icon: '👥', label: 'Clientes' },
  { href: '/financeiro',            icon: '💰', label: 'Financeiro' },
  { href: '/settings/whatsapp',     icon: '💬', label: 'WhatsApp' },
  { href: '/settings/agent',        icon: '🤖', label: 'Agente IA' },
  { href: '/settings/services',     icon: '✂️',  label: 'Serviços' },
  { href: '/settings/staff',        icon: '👤', label: 'Equipe' },
  { href: '/settings/hours',        icon: '🕐', label: 'Horários' },
  { href: '/settings/payments',     icon: '💳', label: 'Pagamentos' },
  { href: '/settings/subscription', icon: '📦', label: 'Assinatura' },
  { href: '/settings/affiliate',    icon: '🔗', label: 'Afiliados' },
  { href: '/settings/support',      icon: '🆘', label: 'Suporte' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!isTenantToken(token)) {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [router])

  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me, enabled: ready })

  function logout() {
    clearToken()
    router.replace('/login')
  }

  if (!ready) return null

  const payload = getTokenPayload(getToken())

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30 w-64 bg-sidebar flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Brand */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <span className="text-white font-black text-sm">AB</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">{tenant?.name ?? '...'}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                tenant?.plan === 'profissional' ? 'bg-green-500/20 text-green-400' :
                tenant?.plan === 'premium' ? 'bg-blue-500/20 text-blue-400' :
                tenant?.plan === 'basico' ? 'bg-purple-500/20 text-purple-400' :
                'bg-yellow-500/20 text-yellow-400'
              }`}>
                {tenant?.plan ?? 'free'}
              </span>
            </div>
          </div>
        </div>

        {/* Trial banner */}
        {tenant?.status === 'trial' && (
          <div className="mx-4 mt-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
            <p className="text-yellow-400 text-xs font-medium">⏰ Período de teste ativo</p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active ? 'bg-primary text-white' : 'text-gray-400 hover:bg-sidebar-hover hover:text-white'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center">
              <span className="text-primary text-xs font-bold">{payload?.role?.[0]?.toUpperCase() ?? 'U'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{payload?.role ?? 'user'}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full text-left text-gray-400 hover:text-white text-sm px-3 py-2 rounded-xl hover:bg-sidebar-hover transition-colors"
          >
            ← Sair
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden bg-white border-b border-gray-100 px-4 h-14 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-500 text-xl">☰</button>
          <span className="font-bold text-gray-900">AgendaBot</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
