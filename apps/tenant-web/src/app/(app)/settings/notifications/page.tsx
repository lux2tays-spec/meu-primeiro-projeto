'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi, type NotificationPrefs } from '@/lib/api'
import { Bell, Mail, MessageCircle, Smartphone } from 'lucide-react'

const CHANNELS: { key: keyof NotificationPrefs; label: string; hint: string; icon: typeof Bell }[] = [
  // O canal "no sistema" (sino) é sempre a caixa de entrada e não é opcional.
  { key: 'channel_push', label: 'Push no celular', hint: 'Notificação no aparelho (requer app instalado).', icon: Smartphone },
  { key: 'channel_email', label: 'E-mail', hint: 'Receber os avisos também por e-mail.', icon: Mail },
  { key: 'channel_whatsapp', label: 'WhatsApp', hint: 'Receber os avisos no seu WhatsApp.', icon: MessageCircle },
]

const EVENTS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'evt_appointment_reminder', label: 'Lembretes de agenda', hint: 'Antes dos horários agendados.' },
  { key: 'evt_new_customer', label: 'Novos clientes no WhatsApp', hint: 'Quando um novo contato inicia conversa.' },
  { key: 'evt_confirmation', label: 'Confirmações de agendamento', hint: 'Quando um agendamento é confirmado.' },
  { key: 'evt_reschedule', label: 'Reajustes de horário', hint: 'Quando um agendamento é remarcado.' },
  { key: 'evt_service_completion', label: 'Concluir serviço', hint: 'Quando um horário passa e falta marcar como realizado.' },
  { key: 'evt_broadcast', label: 'Avisos da plataforma', hint: 'Novidades, promoções e comunicados.' },
]

export default function NotificationsSettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['notification-prefs'], queryFn: notificationsApi.preferences })
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (data) setPrefs(data) }, [data])

  const save = useMutation({
    mutationFn: (next: Partial<NotificationPrefs>) => notificationsApi.updatePreferences(next),
    onSuccess: (res) => {
      qc.setQueryData(['notification-prefs'], res)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  function toggle(key: keyof NotificationPrefs) {
    if (!prefs) return
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    save.mutate({ [key]: next[key] } as Partial<NotificationPrefs>)
  }

  if (isLoading || !prefs) {
    return <div className="text-gray-400 text-sm">Carregando preferências…</div>
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notificações</h1>
        <p className="text-sm text-gray-500 mt-1">Escolha como e sobre o que você quer ser avisado.</p>
        {saved && <p className="text-xs text-green-600 font-semibold mt-1">Preferências salvas ✓</p>}
      </div>

      <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-1">
        <p className="text-sm font-semibold text-gray-900 mb-2">Canais de entrega</p>
        {CHANNELS.map(({ key, label, hint, icon: Icon }) => (
          <ToggleRow key={key} checked={!!prefs[key]} onToggle={() => toggle(key)} label={label} hint={hint} icon={<Icon size={16} strokeWidth={1.75} className="text-gray-400" />} />
        ))}
      </section>

      <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 space-y-1">
        <p className="text-sm font-semibold text-gray-900 mb-2">Tipos de aviso</p>
        {EVENTS.map(({ key, label, hint }) => (
          <ToggleRow key={key} checked={!!prefs[key]} onToggle={() => toggle(key)} label={label} hint={hint} />
        ))}
      </section>
    </div>
  )
}

function ToggleRow({ checked, onToggle, label, hint, icon }: {
  checked: boolean
  onToggle: () => void
  label: string
  hint: string
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="text-xs text-gray-400">{hint}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-gray-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  )
}
