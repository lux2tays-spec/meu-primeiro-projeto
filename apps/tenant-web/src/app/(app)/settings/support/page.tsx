'use client'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  supportApi,
  type SupportChatMessage,
  type SupportTicketStatus,
  type SupportTicketSummary,
} from '@/lib/api'

const inputCls =
  'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

const STATUS_CHIP: Record<SupportTicketStatus, { label: string; cls: string }> = {
  open: { label: 'Aberto', cls: 'bg-amber-100 text-amber-700' },
  resolved: { label: 'Resolvido', cls: 'bg-green-100 text-green-700' },
}

const PRIORITY_LABEL: Record<string, string> = {
  normal: 'Normal',
  alta: 'Alta',
  high: 'Alta',
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' às ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

interface ChatBubble extends SupportChatMessage {
  suggest_ticket?: boolean
  failed?: boolean
}

type Tab = 'assistente' | 'chamados'

export default function SupportPage() {
  const [tab, setTab] = useState<Tab>('assistente')
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [showNewTicket, setShowNewTicket] = useState(false)
  const [newTicketPrefill, setNewTicketPrefill] = useState('')

  // Opens the new-ticket form pre-filled with the recent AI conversation as context.
  function openTicketFromChat(chat: ChatBubble[]) {
    const transcript = chat
      .slice(-8)
      .filter((m) => !m.failed)
      .map((m) => `${m.role === 'user' ? 'Eu' : 'Assistente'}: ${m.content}`)
      .join('\n')
    setNewTicketPrefill(
      transcript
        ? `Preciso de ajuda com o assunto abaixo.\n\n--- Conversa com o assistente ---\n${transcript}`
        : ''
    )
    setSelectedTicketId(null)
    setShowNewTicket(true)
    setTab('chamados')
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Suporte</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(
          [
            { key: 'assistente', label: 'Assistente' },
            { key: 'chamados', label: 'Meus chamados' },
          ] as { key: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'assistente' ? (
        <AssistantChat onOpenTicket={openTicketFromChat} />
      ) : (
        <TicketsSection
          selectedTicketId={selectedTicketId}
          onSelectTicket={setSelectedTicketId}
          showNewTicket={showNewTicket}
          setShowNewTicket={setShowNewTicket}
          prefillMessage={newTicketPrefill}
          clearPrefill={() => setNewTicketPrefill('')}
        />
      )}

      <ContactInfo />
    </div>
  )
}

/* ------------------------------ AI assistant ------------------------------ */

function AssistantChat({ onOpenTicket }: { onOpenTicket: (chat: ChatBubble[]) => void }) {
  const [messages, setMessages] = useState<ChatBubble[]>([])
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const askMutation = useMutation({
    mutationFn: ({ message, history }: { message: string; history: SupportChatMessage[] }) =>
      supportApi.ask(message, history),
    onSuccess: (res) => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.reply, suggest_ticket: res.suggest_ticket },
      ])
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Não consegui responder agora. Tente novamente em instantes ou abra um chamado para falar com nossa equipe.',
          suggest_ticket: true,
          failed: true,
        },
      ])
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, askMutation.isPending])

  function send() {
    const text = input.trim()
    if (!text || askMutation.isPending) return
    // History = last 10 real messages (without the one being sent)
    const history = messages
      .filter((m) => !m.failed)
      .slice(-10)
      .map(({ role, content }) => ({ role, content }))
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    askMutation.mutate({ message: text, history })
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const showTicketCta = lastAssistant?.suggest_ticket === true

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="font-semibold text-gray-900">Assistente de suporte</p>
        <p className="text-gray-500 text-sm mt-0.5">
          Tire dúvidas sobre como usar o AiConfirma. Se precisar, abra um chamado para nossa equipe.
        </p>
      </div>

      <div ref={scrollRef} className="h-96 overflow-y-auto px-5 py-4 space-y-3 bg-gray-50/50">
        {messages.length === 0 && !askMutation.isPending && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2">
            <span className="text-3xl">🤖</span>
            <p className="text-gray-500 text-sm max-w-xs">
              Olá! Sou o assistente do AiConfirma. Pergunte, por exemplo, como conectar o WhatsApp ou
              configurar seus serviços.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-primary text-white rounded-2xl rounded-br-md'
                  : 'bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-bl-md shadow-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {askMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-md shadow-sm px-4 py-2.5 text-sm text-gray-400">
              Digitando…
            </div>
          </div>
        )}

        {showTicketCta && !askMutation.isPending && (
          <div className="flex justify-start">
            <button
              onClick={() => onOpenTicket(messages)}
              className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              Abrir chamado com nossa equipe →
            </button>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          className={inputCls}
          placeholder="Digite sua dúvida..."
        />
        <button
          onClick={send}
          disabled={askMutation.isPending || !input.trim()}
          className="shrink-0 h-10 px-4 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  )
}

/* -------------------------------- Tickets -------------------------------- */

function TicketsSection({
  selectedTicketId,
  onSelectTicket,
  showNewTicket,
  setShowNewTicket,
  prefillMessage,
  clearPrefill,
}: {
  selectedTicketId: string | null
  onSelectTicket: (id: string | null) => void
  showNewTicket: boolean
  setShowNewTicket: (v: boolean) => void
  prefillMessage: string
  clearPrefill: () => void
}) {
  if (selectedTicketId) {
    return <TicketThread ticketId={selectedTicketId} onBack={() => onSelectTicket(null)} />
  }
  return (
    <div className="space-y-4">
      {showNewTicket ? (
        <NewTicketForm
          prefillMessage={prefillMessage}
          onDone={(created) => {
            setShowNewTicket(false)
            clearPrefill()
            if (created) onSelectTicket(created.id)
          }}
        />
      ) : (
        <div className="flex justify-end">
          <button
            onClick={() => setShowNewTicket(true)}
            className="bg-primary hover:bg-primary-dark text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            + Abrir chamado
          </button>
        </div>
      )}
      <TicketList onSelect={onSelectTicket} />
    </div>
  )
}

function TicketList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: tickets = [], isLoading, isError } = useQuery({
    queryKey: ['support', 'tickets'],
    queryFn: supportApi.tickets,
  })

  if (isLoading) return <p className="text-gray-400 text-sm">Carregando chamados...</p>
  if (isError)
    return (
      <p className="text-gray-500 text-sm">
        Não foi possível carregar seus chamados. Tente novamente em instantes.
      </p>
    )
  if (tickets.length === 0)
    return (
      <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm text-center">
        <p className="text-gray-500 text-sm">Nenhum chamado aberto.</p>
      </div>
    )

  return (
    <div className="space-y-3">
      {tickets.map((t) => {
        const chip = STATUS_CHIP[t.status] ?? STATUS_CHIP.open
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="w-full text-left bg-white rounded-2xl p-4 border border-gray-100 shadow-sm hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-gray-900 flex-1 min-w-0 truncate">{t.subject}</p>
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${chip.cls}`}>
                {chip.label}
              </span>
              {PRIORITY_LABEL[t.priority] === 'Alta' && (
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  Alta
                </span>
              )}
            </div>
            {t.last_message && (
              <p className="text-gray-500 text-sm mt-1 truncate">{t.last_message}</p>
            )}
            <p className="text-gray-400 text-xs mt-1.5">
              Atualizado em {formatDateTime(t.updated_at)}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function NewTicketForm({
  prefillMessage,
  onDone,
}: {
  prefillMessage: string
  onDone: (created: SupportTicketSummary | null) => void
}) {
  const qc = useQueryClient()
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState(prefillMessage)
  const [priority, setPriority] = useState<'normal' | 'alta'>('normal')
  const [error, setError] = useState('')

  const createMutation = useMutation({
    mutationFn: () => supportApi.createTicket({ subject: subject.trim(), message: message.trim(), priority }),
    onSuccess: (ticket) => {
      qc.invalidateQueries({ queryKey: ['support', 'tickets'] })
      onDone(ticket)
    },
    onError: () => setError('Não foi possível abrir o chamado. Tente novamente em instantes.'),
  })

  function submit() {
    setError('')
    if (!subject.trim()) return setError('Informe o assunto do chamado.')
    if (!message.trim()) return setError('Descreva o que está acontecendo.')
    createMutation.mutate()
  }

  return (
    <div className="bg-white rounded-2xl p-5 border border-primary/30 shadow-sm space-y-3">
      <p className="font-semibold text-gray-900 text-sm">Novo chamado</p>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Assunto</label>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={inputCls}
          placeholder="Ex: Problema ao conectar o WhatsApp"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Mensagem</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
          placeholder="Descreva sua dúvida ou problema com detalhes..."
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Prioridade</label>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as 'normal' | 'alta')}
          className={inputCls + ' bg-white'}
        >
          <option value="normal">Normal</option>
          <option value="alta">Alta</option>
        </select>
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={createMutation.isPending}
          className="flex-1 h-10 bg-primary text-white text-sm font-semibold rounded-xl disabled:opacity-50"
        >
          {createMutation.isPending ? 'Enviando...' : 'Abrir chamado'}
        </button>
        <button
          onClick={() => onDone(null)}
          className="flex-1 h-10 border border-gray-200 text-gray-600 text-sm rounded-xl hover:bg-gray-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function TicketThread({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const qc = useQueryClient()
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState('')

  const { data: ticket, isLoading, isError } = useQuery({
    queryKey: ['support', 'ticket', ticketId],
    queryFn: () => supportApi.ticket(ticketId),
    refetchInterval: 20000,
  })

  const replyMutation = useMutation({
    mutationFn: (body: string) => supportApi.replyTicket(ticketId, body),
    onSuccess: () => {
      setReply('')
      setReplyError('')
      qc.invalidateQueries({ queryKey: ['support', 'ticket', ticketId] })
      qc.invalidateQueries({ queryKey: ['support', 'tickets'] })
    },
    onError: () => setReplyError('Não foi possível enviar a mensagem. Tente novamente.'),
  })

  function sendReply() {
    const text = reply.trim()
    if (!text || replyMutation.isPending) return
    replyMutation.mutate(text)
  }

  if (isLoading) return <p className="text-gray-400 text-sm">Carregando chamado...</p>
  if (isError || !ticket)
    return (
      <div className="space-y-3">
        <button onClick={onBack} className="text-primary text-sm font-medium hover:underline">
          ← Voltar aos chamados
        </button>
        <p className="text-gray-500 text-sm">
          Não foi possível carregar este chamado. Tente novamente em instantes.
        </p>
      </div>
    )

  const chip = STATUS_CHIP[ticket.status] ?? STATUS_CHIP.open

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-primary text-sm font-medium hover:underline">
        ← Voltar aos chamados
      </button>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 flex-1 min-w-0">{ticket.subject}</p>
            <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${chip.cls}`}>
              {chip.label}
            </span>
            {PRIORITY_LABEL[ticket.priority] === 'Alta' && (
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">
                Prioridade alta
              </span>
            )}
          </div>
          <p className="text-gray-400 text-xs mt-1">Aberto em {formatDateTime(ticket.created_at)}</p>
        </div>

        <div className="px-5 py-4 space-y-3 bg-gray-50/50 max-h-96 overflow-y-auto">
          {ticket.messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%]">
                <p
                  className={`text-xs font-medium mb-1 ${
                    m.sender === 'user' ? 'text-right text-gray-400' : 'text-primary'
                  }`}
                >
                  {m.sender === 'user' ? 'Você' : 'Equipe AiConfirma'}
                </p>
                <div
                  className={`px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                    m.sender === 'user'
                      ? 'bg-primary text-white rounded-2xl rounded-br-md'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-bl-md shadow-sm'
                  }`}
                >
                  {m.body}
                </div>
                <p
                  className={`text-[11px] text-gray-400 mt-1 ${m.sender === 'user' ? 'text-right' : ''}`}
                >
                  {formatDateTime(m.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 space-y-2">
          <div className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendReply()
                }
              }}
              className={inputCls}
              placeholder="Escreva uma resposta..."
            />
            <button
              onClick={sendReply}
              disabled={replyMutation.isPending || !reply.trim()}
              className="shrink-0 h-10 px-4 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {replyMutation.isPending ? 'Enviando...' : 'Responder'}
            </button>
          </div>
          {replyError && <p className="text-red-500 text-xs">{replyError}</p>}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ Contact info ------------------------------ */

function ContactInfo() {
  return (
    <div className="grid gap-4">
      {[
        {
          icon: '💬',
          title: 'WhatsApp',
          desc: 'Fale diretamente com nossa equipe de suporte',
          action: 'Abrir WhatsApp',
          href: 'https://wa.me/5511999999999?text=Olá, preciso de ajuda com o AiConfirma',
          color: 'bg-green-50 border-green-200 hover:border-green-300',
        },
        {
          icon: '📧',
          title: 'E-mail',
          desc: 'suporte@aiconfirma.com.br — respondemos em até 24h',
          action: 'Enviar e-mail',
          href: 'mailto:suporte@aiconfirma.com.br',
          color: 'bg-blue-50 border-blue-200 hover:border-blue-300',
        },
      ].map((item) => (
        <a
          key={item.title}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-colors ${item.color}`}
        >
          <span className="text-3xl">{item.icon}</span>
          <div className="flex-1">
            <p className="font-bold text-gray-900">{item.title}</p>
            <p className="text-gray-500 text-sm mt-0.5">{item.desc}</p>
          </div>
          <span className="text-primary text-sm font-medium">{item.action} →</span>
        </a>
      ))}

      <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
        <p className="font-semibold text-gray-900 mb-1">Horário de atendimento</p>
        <p className="text-gray-500 text-sm">Segunda a sexta, das 9h às 18h (horário de Brasília)</p>
      </div>
    </div>
  )
}
