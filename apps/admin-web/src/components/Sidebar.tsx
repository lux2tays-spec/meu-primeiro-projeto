'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearToken } from '@/lib/api'
import clsx from 'clsx'

const nav = [
  { href: '/dashboard',             icon: '⊞', label: 'Visão Geral' },
  { href: '/dashboard/tenants',     icon: '🏢', label: 'Tenants' },
  { href: '/dashboard/users',       icon: '👥', label: 'Usuários' },
  { href: '/dashboard/revenue',     icon: '💰', label: 'Receita' },
  { href: '/dashboard/affiliates',  icon: '🤝', label: 'Afiliados' },
  { href: '/dashboard/ai-templates', icon: '🤖', label: 'Templates IA' },
  { href: '/dashboard/support',     icon: '🎧', label: 'Suporte' },
  { href: '/dashboard/settings',    icon: '⚙️', label: 'Configurações' },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  function handleLogout() {
    clearToken()
    router.replace('/login')
  }

  return (
    <aside className="w-60 min-h-screen bg-sidebar flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-black text-sm">AB</span>
          </div>
          <div>
            <div className="text-white font-bold text-sm">AgendaBot</div>
            <div className="text-gray-400 text-xs">Root Admin</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const isActive = item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:bg-sidebar-hover hover:text-white'
              )}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 pb-6">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:bg-sidebar-hover hover:text-white transition-colors"
        >
          <span>↩</span>
          Sair
        </button>
      </div>
    </aside>
  )
}
