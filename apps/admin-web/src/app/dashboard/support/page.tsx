'use client'
import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'

type StatusFilter = 'open' | 'resolved' | 'all'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'open', label: 'Abertos' },
  { key: 'resolved', label: 'Resolvidos' },
  { key: 'all', label: 'Todos' },
]

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

const formatDateTime = (d: string) =>
  new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

export default function SupportPage() {
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: tickets, isLoading, isError, error } = useQuery({
    queryKey: ['root-support-tickets', filter],
    queryFn: () => rootApi.supportTickets(filter === 'all' ? undefined : filter),
  })

  // Unresolved count (same cache entry as the default "Abertos" list)
  const { data: openTickets } = useQuery({
    queryKey: ['root-support-tickets', 'open'],
    queryFn: () => rootApi.supportTickets('open'),
  })
  const openCount = openTickets?.length ?? 0

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Suporte</h1>
        <p className="text-gray-500 text-sm mt-1">
          Chamados abertos pelos tenants — responda e acompanhe até a resolução
        </p>
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`h-9 px-4 rounded-xl text-sm font-semibold transition-colors inline-flex items-center gap-2 ${
              filter === f.key
                ? 'bg-primary text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.label}
            {f.key === 'open' && openCount > 0 && (
              <span
                className={`min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold inline-flex items-center justify-center ${
                  filter === 'open' ? 'bg-white/25 text-white' : 'bg-red-100 text-red-700'
                }`}
              >
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tickets table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-6 py-3 font-medium text-gray-500">Empresa</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Solicitante</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Assunto</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Prioridade</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Atualizado em</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">Carregando...</td></tr>
            ) : isError ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-red-500">
                  Erro ao carregar chamados: {(error as Error)?.message ?? 'tente novamente'}
                </td>
              </tr>
            ) : !tickets?.length ? (
              <tr><td colSpan={6} className="text-center py-12 text-gray-400">Nenhum chamado.</td></tr>
            ) : (
              tickets.map((t: any) => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                        {(t.tenant_name ?? '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="font-semibold text-gray-900">{t.tenant_name}</div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-gray-600">{t.requester_name ?? '—'}</td>
                  <td className="px-4 py-4">
                    <div className="text-gray-900 font-medium max-w-xs truncate">{t.subject}</div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      label={t.priority === 'high' ? 'Alta' : 'Normal'}
                      variant={t.priority === 'high' ? 'danger' : 'default'}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      label={t.status === 'open' ? 'Aberto' : 'Resolvido'}
                      variant={t.status === 'open' ? 'warning' : 'success'}
                    />
                  </td>
                  <td className="px-4 py-4 text-gray-400 text-xs">{formatDate(t.updated_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedId && <TicketPanel id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function TicketPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [reply, setReply] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ['root-support-ticket', id],
    queryFn: () => rootApi.supportTicket(id),
  })

  // Keep thread scrolled to the latest message
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [ticket?.messages?.length])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['root-support-ticket', id] })
    qc.invalidateQueries({ queryKey: ['root-support-tickets'] })
  }

  const flashOk = (msg: string) => {
    setOkMsg(msg)
    setTimeout(() => setOkMsg(''), 3000)
  }

  const replyMutation = useMutation({
    mutationFn: () => rootApi.replySupportTicket(id, reply.trim()),
    onSuccess: () => { setReply(''); setErr(''); invalidate(); flashOk('Resposta enviada com sucesso!') },
    onError: (e: any) => setErr(e.message),
  })

  const statusMutation = useMutation({
    mutationFn: (status: 'open' | 'resolved') => rootApi.updateSupportTicket(id, { status }),
    onSuccess: (_data, status) => {
      setErr('')
      invalidate()
      flashOk(status === 'resolved' ? 'Chamado marcado como resolvido.' : 'Chamado reaberto.')
    },
    onError: (e: any) => setErr(e.message),
  })

  const isOpen = ticket?.status === 'open'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white h-full w-full max-w-xl shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">Carregando chamado...</div>
        ) : isError || !ticket ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
            <p>Não foi possível carregar o chamado.</p>
            <button onClick={onClose} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
              Fechar
            </button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-6 py-5 border-b border-gray-100 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 truncate">{ticket.subject}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {ticket.tenant_name} · {ticket.requester_name ?? '—'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">Aberto em {formatDateTime(ticket.created_at)}</p>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Fechar"
                  className="w-8 h-8 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 flex items-center justify-center flex-shrink-0 text-lg"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  label={ticket.priority === 'high' ? 'Prioridade alta' : 'Prioridade normal'}
                  variant={ticket.priority === 'high' ? 'danger' : 'default'}
                />
                <Badge
                  label={isOpen ? 'Aberto' : 'Resolvido'}
                  variant={isOpen ? 'warning' : 'success'}
                />
                <button
                  onClick={() => statusMutation.mutate(isOpen ? 'resolved' : 'open')}
                  disabled={statusMutation.isPending}
                  className={`ml-auto h-8 px-4 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    isOpen
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {statusMutation.isPending
                    ? 'Salvando...'
                    : isOpen ? 'Marcar como resolvido' : 'Reabrir'}
                </button>
              </div>
              {okMsg && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-4 py-2">{okMsg}</p>}
              {err && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{err}</p>}
            </div>

            {/* Thread */}
            <div ref={threadRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-4 bg-gray-50">
              {!ticket.messages?.length ? (
                <div className="text-center py-12 text-gray-400 text-sm">Nenhuma mensagem neste chamado.</div>
              ) : (
                ticket.messages.map((m: any) => {
                  const isAdmin = m.sender === 'admin'
                  return (
                    <div key={m.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          isAdmin
                            ? 'bg-primary text-white rounded-br-md'
                            : 'bg-white border border-gray-100 text-gray-800 shadow-sm rounded-bl-md'
                        }`}
                      >
                        <div className={`text-xs font-semibold mb-1 ${isAdmin ? 'text-white/80' : 'text-gray-500'}`}>
                          {isAdmin ? 'Equipe' : ticket.requester_name ?? 'Solicitante'}
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                        <div className={`text-[10px] mt-1.5 ${isAdmin ? 'text-white/60' : 'text-gray-400'}`}>
                          {formatDateTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Reply box */}
            <div className="px-6 py-4 border-t border-gray-100 space-y-3">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Escreva uma resposta para o tenant..."
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
              <div className="flex justify-end">
                <button
                  onClick={() => replyMutation.mutate()}
                  disabled={replyMutation.isPending || !reply.trim()}
                  className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {replyMutation.isPending ? 'Enviando...' : 'Enviar resposta'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
