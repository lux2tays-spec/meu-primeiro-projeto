'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { getToken, clearToken, tenantApi, authApi, PLAN_LIMIT_EVENT } from '@/lib/api'
import { isTenantToken, getTokenPayload } from '@/lib/auth'
import { useQuery } from '@tanstack/react-query'
import BrandLogo from '@/components/BrandLogo'
import { useBranding } from '@/components/BrandingProvider'
import { useCapabilities } from '@/lib/useCapabilities'
import NotificationBell from '@/components/NotificationBell'
import {
  LayoutDashboard, CalendarDays, Users, Wallet, MessageCircle, Bot, Tag,
  UserCog, Clock, CreditCard, Package, Share2, LifeBuoy, LogOut,
  Menu, Lock, AlarmClock, Coins, UserCircle, CalendarCheck, Bell, ShoppingBag, Percent, type LucideIcon,
} from 'lucide-react'

// managerOnly: SAL-11 — papéis "staff" não veem entradas de gestão financeira.
const NAV: { href: string; icon: LucideIcon; label: string; managerOnly?: boolean; cap?: string }[] = [
  { href: '/dashboard',             icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/calendar',              icon: CalendarDays,    label: 'Agenda' },
  { href: '/customers',             icon: Users,           label: 'Clientes' },
  { href: '/vendas',                icon: ShoppingBag,     label: 'Vendas', managerOnly: true, cap: 'vendas_module' },
  { href: '/financeiro',            icon: Wallet,          label: 'Financeiro', managerOnly: true, cap: 'vendas_module' },
  { href: '/comissoes',             icon: Coins,           label: 'Comissões', cap: 'commissions' },
  { href: '/settings/whatsapp',     icon: MessageCircle,   label: 'WhatsApp' },
  { href: '/settings/agent',        icon: Bot,             label: 'Agente IA' },
  { href: '/settings/services',     icon: Tag,             label: 'Serviços' },
  { href: '/settings/staff',        icon: UserCog,         label: 'Equipe' },
  { href: '/settings/hours',        icon: Clock,           label: 'Horários' },
  { href: '/settings/google-calendar', icon: CalendarCheck, label: 'Google Agenda', cap: 'google_calendar' },
  { href: '/settings/payments',     icon: CreditCard,      label: 'Pagamentos' },
  { href: '/settings/taxas',        icon: Percent,         label: 'Taxas', managerOnly: true },
  { href: '/settings/subscription', icon: Package,         label: 'Assinatura' },
  { href: '/settings/affiliate',    icon: Share2,          label: 'Afiliados', cap: 'affiliate' },
  { href: '/settings/perfil',       icon: UserCircle,      label: 'Meu Perfil' },
  { href: '/settings/notifications', icon: Bell,           label: 'Notificações' },
  { href: '/settings/support',      icon: LifeBuoy,        label: 'Suporte' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { appName } = useBranding()
  const { can } = useCapabilities()
  const [ready, setReady] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // PAY-2: diálogo "limite do plano" — mostrado quando qualquer chamada retorna
  // 402, sem redirecionar (o usuário não perde o que estava preenchendo).
  const [planLimitMsg, setPlanLimitMsg] = useState<string | null>(null)
  useEffect(() => {
    function onPlanLimit(e: Event) {
      setPlanLimitMsg((e as CustomEvent<string>).detail || 'Você atingiu o limite do seu plano.')
    }
    window.addEventListener(PLAN_LIMIT_EVENT, onPlanLimit)
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, onPlanLimit)
  }, [])

  useEffect(() => {
    const token = getToken()
    if (!isTenantToken(token)) {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [router])

  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me, enabled: ready })
  const { data: me } = useQuery({ queryKey: ['auth-me'], queryFn: authApi.me, enabled: ready })

  // First-login onboarding: send the user to the wizard until it is completed or skipped.
  // AUTH-13: apenas o dono (owner) cai no wizard — admin/staff nunca são redirecionados.
  const isOwner = ready && getTokenPayload(getToken())?.role === 'owner'
  const { data: onboarding } = useQuery({ queryKey: ['onboarding'], queryFn: tenantApi.onboarding, enabled: isOwner })
  const onboardingRedirected = useRef(false)
  useEffect(() => {
    if (!ready || !isOwner || !onboarding || onboardingRedirected.current) return
    if (pathname?.startsWith('/onboarding')) return // safety: layout doesn't wrap it, but never loop
    if (!onboarding.completed && sessionStorage.getItem('onboarding_skipped') !== '1') {
      onboardingRedirected.current = true
      router.replace('/onboarding')
    }
  }, [ready, isOwner, onboarding, pathname, router])

  function logout() {
    clearToken()
    router.replace('/login')
  }


  if (!ready) return null

  const payload = getTokenPayload(getToken())
  const canEditBusiness = ['owner', 'admin', 'root'].includes(payload?.role)
  const isManager = canEditBusiness
  const navItems = NAV.filter((item) => !item.managerOnly || isManager)

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
            <BrandLogo variant="mark" dark size={40} />
            <div>
              {canEditBusiness ? (
                <Link
                  href="/settings/business"
                  onClick={() => setSidebarOpen(false)}
                  title="Editar dados do negócio"
                  className="block text-white font-bold text-sm leading-tight hover:text-primary hover:underline underline-offset-2 transition-colors"
                >
                  {tenant?.name ?? '...'}
                </Link>
              ) : (
                <p className="text-white font-bold text-sm leading-tight">{tenant?.name ?? '...'}</p>
              )}
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

        {/* Subscription / trial banner */}
        {(() => {
          const trialExpired = tenant?.status === 'trial' && tenant?.trial_ends_at && new Date(tenant.trial_ends_at).getTime() < Date.now()
          const blocked = trialExpired || tenant?.status === 'suspended' || tenant?.status === 'cancelled'
          if (blocked) {
            return (
              <Link href="/settings/subscription" onClick={() => setSidebarOpen(false)}
                className="mx-4 mt-4 block bg-red-500/15 border border-red-500/30 rounded-xl p-3 hover:bg-red-500/25 transition-colors">
                <p className="text-red-300 text-xs font-semibold flex items-center gap-1.5">
                  <Lock size={13} strokeWidth={2} className="shrink-0" />
                  {tenant?.status === 'cancelled' ? 'Assinatura cancelada' : tenant?.status === 'suspended' ? 'Assinatura suspensa' : 'Período de teste encerrado'}
                </p>
                <p className="text-red-300/80 text-[11px] mt-1">O WhatsApp foi desconectado. Assine para reativar o atendimento →</p>
              </Link>
            )
          }
          if (tenant?.status === 'trial') {
            return (
              <div className="mx-4 mt-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3">
                <p className="text-yellow-400 text-xs font-medium flex items-center gap-1.5">
                  <AlarmClock size={13} strokeWidth={2} className="shrink-0" />
                  Período de teste ativo
                </p>
              </div>
            )
          }
          return null
        })()}

        {/* Nav */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
            const Icon = item.icon
            const locked = !!item.cap && !can(item.cap)
            return (
              <Link
                key={item.href}
                href={locked ? '/settings/subscription' : item.href}
                onClick={() => setSidebarOpen(false)}
                title={locked ? 'Recurso do plano — faça upgrade' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active ? 'bg-primary text-white' : 'text-gray-400 hover:bg-sidebar-hover hover:text-white'
                } ${locked ? 'opacity-60' : ''}`}
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                <span className="flex-1">{item.label}</span>
                {locked && <Lock size={13} className="shrink-0 opacity-70" />}
              </Link>
            )
          })}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary/30 flex items-center justify-center">
              <span className="text-primary text-xs font-bold">{(me?.name ?? payload?.role)?.[0]?.toUpperCase() ?? 'U'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-medium truncate">{me?.name ?? payload?.role ?? 'user'}</p>
              <p className="text-gray-400 text-[11px] truncate">{me?.role ?? payload?.role ?? ''}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 text-left text-gray-400 hover:text-white text-sm px-3 py-2 rounded-xl hover:bg-sidebar-hover transition-colors"
          >
            <LogOut size={16} strokeWidth={1.75} className="shrink-0" />
            Sair
          </button>
          {/* "Excluir conta" removido do painel web (mantido apenas no app, de forma
              discreta, para atender à exigência de exclusão de conta das lojas). */}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Barra superior (todas as telas): menu no mobile + sino de notificações à direita */}
        <header className="bg-white border-b border-gray-100 px-4 lg:px-8 h-14 flex items-center gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="text-gray-500 lg:hidden" aria-label="Abrir menu">
            <Menu size={22} strokeWidth={1.75} />
          </button>
          <span className="font-bold text-gray-900 lg:hidden">{appName}</span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          {children}
        </main>
      </div>

      {/* PAY-2: diálogo de limite do plano (sem redirect cego) */}
      {planLimitMsg && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPlanLimitMsg(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center">
              <Lock size={22} strokeWidth={2} className="text-yellow-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Você atingiu o limite do plano</h2>
              <p className="text-sm text-gray-500 mt-1">{planLimitMsg}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPlanLimitMsg(null)}
                className="flex-1 h-11 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 transition-colors"
              >
                Agora não
              </button>
              <Link
                href="/settings/subscription"
                onClick={() => setPlanLimitMsg(null)}
                className="flex-1 h-11 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center"
              >
                Ver planos
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
