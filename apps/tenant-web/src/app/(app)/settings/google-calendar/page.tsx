'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { googleApi, friendlyMessage } from '@/lib/api'
import { useGoogleClientId } from '@/lib/google'
import { CalendarCheck, RefreshCw, Users, Bell, ShieldCheck } from 'lucide-react'

/**
 * UI-5 — Google Agenda na web (paridade com o mobile settings/google-calendar).
 * Usa o fluxo de "authorization code" do Google Identity Services em popup;
 * o código é trocado por tokens no backend (POST /google-calendar/connect).
 */

const CALENDAR_SCOPES = 'openid profile email https://www.googleapis.com/auth/calendar.events'

export default function GoogleCalendarPage() {
  const qc = useQueryClient()
  const clientId = useGoogleClientId()
  const [error, setError] = useState('')
  const [gisReady, setGisReady] = useState(false)
  const codeClientRef = useRef<any>(null)

  const { data: status, isLoading } = useQuery({
    queryKey: ['google-calendar-status'],
    queryFn: googleApi.calendarStatus,
  })

  const connectMutation = useMutation({
    mutationFn: (code: string) => googleApi.calendarConnect(code, 'postmessage'),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['google-calendar-status'] })
    },
    onError: (e: any) =>
      setError(friendlyMessage(e, 'Não foi possível conectar o Google Agenda. Tente novamente em instantes.')),
  })

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => googleApi.calendarToggle(enabled),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['google-calendar-status'] }) },
    onError: (e: any) =>
      setError(friendlyMessage(e, 'Não foi possível alterar a sincronização. Tente novamente.')),
  })

  const disconnectMutation = useMutation({
    mutationFn: googleApi.calendarDisconnect,
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['google-calendar-status'] }) },
    onError: (e: any) =>
      setError(friendlyMessage(e, 'Não foi possível desconectar o Google Agenda. Tente novamente.')),
  })

  // Carrega o script do Google Identity Services e prepara o code client (popup)
  useEffect(() => {
    if (!clientId) return
    function init() {
      const oauth2 = (window as any).google?.accounts?.oauth2
      if (!oauth2) return
      codeClientRef.current = oauth2.initCodeClient({
        client_id: clientId,
        scope: CALENDAR_SCOPES,
        ux_mode: 'popup',
        access_type: 'offline',
        prompt: 'consent',
        callback: (response: { code?: string; error?: string }) => {
          if (response?.code) {
            connectMutation.mutate(response.code)
          } else if (response?.error && response.error !== 'access_denied') {
            setError('Não foi possível concluir a autorização com o Google. Tente novamente.')
          }
        },
      })
      setGisReady(true)
    }
    if ((window as any).google?.accounts?.oauth2) {
      init()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = init
    document.head.appendChild(script)
    return () => { try { document.head.removeChild(script) } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando...</div>

  const isConnected = !!status?.connected

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Google Agenda</h1>
        <p className="text-sm text-gray-500 mt-1">
          Sincronize seus agendamentos automaticamente com o Google Agenda
        </p>
      </div>

      {/* Status */}
      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center shrink-0">
            <CalendarCheck size={22} strokeWidth={2} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900">Google Agenda</p>
            <p className="text-sm text-gray-500">{isConnected ? 'Conta conectada' : 'Não conectado'}</p>
          </div>
          <span className={`w-3 h-3 rounded-full shrink-0 ${isConnected ? 'bg-green-500' : 'bg-gray-300'}`} />
        </div>

        {isConnected && (
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-gray-100">
            <div>
              <p className="text-sm font-semibold text-gray-900">Sincronização ativa</p>
              <p className="text-xs text-gray-400 mt-0.5">Novos agendamentos serão criados na sua agenda</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!status?.sync_enabled}
              disabled={toggleMutation.isPending}
              onClick={() => toggleMutation.mutate(!status?.sync_enabled)}
              className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                status?.sync_enabled ? 'bg-primary' : 'bg-gray-200'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  status?.sync_enabled ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        )}
      </div>

      {/* Como funciona */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-gray-900">Como funciona</h2>
        {[
          { Icon: RefreshCw, text: 'Novos agendamentos criados no sistema ou pelo bot aparecem automaticamente no Google Agenda' },
          { Icon: Users, text: 'Cada membro da equipe conecta a própria conta — você controla quem sincroniza' },
          { Icon: Bell, text: 'Lembretes do Google Agenda são enviados normalmente (1 hora antes)' },
          { Icon: ShieldCheck, text: 'Cancelamentos removem automaticamente o evento da agenda' },
        ].map(({ Icon, text }, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0 mt-0.5">
              <Icon size={15} strokeWidth={2} className="text-primary" />
            </div>
            <p className="text-gray-700 text-sm leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{error}</div>
      )}

      {/* Ações */}
      {!isConnected ? (
        <>
          <button
            onClick={() => codeClientRef.current?.requestCode()}
            disabled={!gisReady || connectMutation.isPending}
            className="w-full h-12 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {connectMutation.isPending ? 'Conectando...' : 'Conectar Google Agenda'}
          </button>
          {!clientId && (
            <p className="text-xs text-gray-400 text-center">
              A integração com o Google ainda não está configurada nesta plataforma.
            </p>
          )}
        </>
      ) : (
        <button
          onClick={() => {
            if (confirm('Remover integração com Google Agenda? Eventos já criados não serão apagados.')) {
              disconnectMutation.mutate()
            }
          }}
          disabled={disconnectMutation.isPending}
          className="w-full h-12 border-2 border-gray-200 text-gray-600 hover:bg-gray-50 font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {disconnectMutation.isPending ? 'Desconectando...' : 'Desconectar Google Agenda'}
        </button>
      )}
    </div>
  )
}
