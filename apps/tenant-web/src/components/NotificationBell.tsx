'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check } from 'lucide-react'
import { notificationsApi, type AppNotification } from '@/lib/api'

// Sino de notificações in-app: badge de não-lidos + painel com os avisos recentes.
// A contagem é atualizada por polling leve (60s); a lista é buscada ao abrir.
export default function NotificationBell({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(30),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  const notifications = data?.notifications ?? []
  const unread = data?.unread ?? 0

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  async function openItem(n: AppNotification) {
    if (!n.read_at) {
      try { await notificationsApi.markRead(n.id) } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ['notifications'] })
    }
    setOpen(false)
    if (n.link) {
      // Link externo (broadcast com URL) abre em nova aba; caminho interno navega no app.
      if (/^https?:\/\//i.test(n.link)) window.open(n.link, '_blank', 'noopener,noreferrer')
      else router.push(n.link.startsWith('/') ? n.link : `/${n.link}`)
    }
  }

  async function markAll() {
    try { await notificationsApi.markAllRead() } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`relative p-2 rounded-xl transition-colors ${dark ? 'text-gray-300 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}
        aria-label="Notificações"
      >
        <Bell size={20} strokeWidth={1.75} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="font-bold text-gray-900 text-sm">Notificações</p>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-semibold text-primary hover:underline flex items-center gap-1">
                <Check size={13} strokeWidth={2} /> Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-10 px-4">Nenhuma notificação por aqui.</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${n.read_at ? '' : 'bg-primary/5'}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                    <div className={`flex-1 min-w-0 ${n.read_at ? 'pl-4' : ''}`}>
                      <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{formatWhen(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
