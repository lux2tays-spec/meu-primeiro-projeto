'use client'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'
import { Badge } from '@/components/ui/Badge'

const CONV_PAGE = 20

const whatsappStatusLabel: Record<string, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  connecting: 'Conectando',
  qr_pending: 'Aguardando QR',
}
const whatsappStatusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  connected: 'success',
  connecting: 'warning',
  qr_pending: 'warning',
  disconnected: 'danger',
}

const fmtDateTime = (v: string) => {
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// AI spend comes from the Anthropic billing side in USD
const fmtUsd = (v: number) =>
  `US$ ${Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function RemoteSupport({ tenantId, showSuccess }: { tenantId: string; showSuccess: (msg: string) => void }) {
  const qc = useQueryClient()

  // ---- Conversations ----
  const [convLimit, setConvLimit] = useState(CONV_PAGE)
  const [openConv, setOpenConv] = useState<any>(null)

  const conversationsQ = useQuery({
    queryKey: ['root-tenant-conversations', tenantId, convLimit],
    queryFn: () => rootApi.tenantConversations(tenantId, { limit: convLimit, offset: 0 }),
  })

  const messagesQ = useQuery({
    queryKey: ['root-conversation-messages', openConv?.id],
    queryFn: () => rootApi.conversationMessages(openConv.id, { limit: 100, offset: 0 }),
    enabled: !!openConv,
  })

  // ---- Test bot ----
  const [testMsg, setTestMsg] = useState('')
  const [testReply, setTestReply] = useState<string | null>(null)
  const testMutation = useMutation({
    mutationFn: (message: string) => rootApi.testTenantBot(tenantId, message),
    onSuccess: (data) => setTestReply(data.reply ?? ''),
  })

  // ---- Bot errors ----
  const errorsQ = useQuery({
    queryKey: ['root-tenant-bot-errors', tenantId],
    queryFn: () => rootApi.tenantBotErrors(tenantId, 20),
  })

  // ---- WhatsApp ----
  const whatsappQ = useQuery({
    queryKey: ['root-tenant-whatsapp', tenantId],
    queryFn: () => rootApi.tenantWhatsapp(tenantId),
  })
  const [qr, setQr] = useState<string | null>(null)
  const [qrPending, setQrPending] = useState(false)

  const reconnectMutation = useMutation({
    mutationFn: () => rootApi.tenantWhatsappReconnect(tenantId),
    onSuccess: (data) => {
      setQr(data.qrcode ?? null)
      setQrPending(!!data.qr_pending && !data.qrcode)
      qc.invalidateQueries({ queryKey: ['root-tenant-whatsapp', tenantId] })
    },
  })
  const logoutMutation = useMutation({
    mutationFn: () => rootApi.tenantWhatsappLogout(tenantId),
    onSuccess: () => {
      setQr(null)
      setQrPending(false)
      qc.invalidateQueries({ queryKey: ['root-tenant-whatsapp', tenantId] })
      showSuccess('WhatsApp desconectado!')
    },
  })

  // ---- AI usage ----
  const aiUsageQ = useQuery({
    queryKey: ['root-tenant-ai-usage', tenantId],
    queryFn: () => rootApi.tenantAiUsage(tenantId),
  })

  // ---- Clear cache ----
  const clearCacheMutation = useMutation({
    mutationFn: () => rootApi.clearTenantCache(tenantId),
    onSuccess: () => showSuccess('Cache do tenant limpo!'),
  })

  const conversations = conversationsQ.data ?? []
  const errors = errorsQ.data ?? []
  const wa = whatsappQ.data
  const usage = aiUsageQ.data
  const capPct = usage && usage.cap > 0 ? Math.min(100, (usage.month_spend / usage.cap) * 100) : 0
  const capHit = !!usage && usage.cap > 0 && usage.month_spend >= usage.cap

  return (
    <>
      <div>
        <h2 className="text-lg font-bold text-gray-900">Suporte remoto</h2>
        <p className="text-sm text-gray-500 mt-0.5">Ferramentas para diagnosticar e corrigir o bot deste tenant sem acesso ao aparelho.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* 1. WhatsApp conversations */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-gray-900">Conversas do WhatsApp</h2>
            </div>
            <p className="text-xs text-gray-400 mb-4">Dados de clientes — acesso auditado.</p>

            {conversationsQ.isLoading && <p className="text-sm text-gray-400">Carregando conversas...</p>}
            {conversationsQ.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(conversationsQ.error as any)?.message ?? 'Erro ao carregar conversas'}</p>
            )}
            {conversationsQ.isSuccess && conversations.length === 0 && (
              <p className="text-sm text-gray-400">Nenhuma conversa encontrada.</p>
            )}

            <div className="space-y-2">
              {conversations.map((c: any) => {
                const paused = c.bot_paused_until && new Date(c.bot_paused_until) > new Date()
                const name = [c.customer_name, c.customer_last_name].filter(Boolean).join(' ') || c.customer_phone || 'Cliente'
                return (
                  <button
                    key={c.id}
                    onClick={() => setOpenConv(c)}
                    className="w-full text-left flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm truncate">{name}</span>
                        {paused && <Badge label="Bot pausado" variant="warning" />}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {c.customer_phone}{c.last_message ? ` • ${c.last_message}` : ''}
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">{c.updated_at ? fmtDateTime(c.updated_at) : ''}</span>
                  </button>
                )
              })}
            </div>

            {conversationsQ.isSuccess && conversations.length >= convLimit && (
              <button
                onClick={() => setConvLimit((l) => l + CONV_PAGE)}
                disabled={conversationsQ.isFetching}
                className="mt-3 text-sm text-primary hover:text-primary-dark font-medium disabled:opacity-50"
              >
                {conversationsQ.isFetching ? 'Carregando...' : 'Carregar mais'}
              </button>
            )}
          </div>

          {/* 2. Test bot */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-900">Testar o bot</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">Simule uma mensagem de cliente e veja a resposta da IA, sem passar pelo WhatsApp. Útil para validar mudanças de prompt/tom.</p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mensagem do cliente</label>
                <textarea
                  value={testMsg}
                  onChange={(e) => setTestMsg(e.target.value)}
                  rows={3}
                  placeholder="Ex: Oi, quero agendar um horário amanhã de manhã"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                />
              </div>

              {testMutation.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(testMutation.error as any)?.message ?? 'Erro ao testar o bot'}</p>
              )}

              {testReply !== null && !testMutation.isPending && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] bg-primary-light text-gray-900 rounded-2xl rounded-tl-sm px-4 py-3 text-sm whitespace-pre-wrap">
                    {testReply || '(resposta vazia)'}
                  </div>
                </div>
              )}

              <button
                onClick={() => { if (testMsg.trim()) testMutation.mutate(testMsg.trim()) }}
                disabled={testMutation.isPending || !testMsg.trim()}
                className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                {testMutation.isPending ? 'Testando...' : 'Testar resposta'}
              </button>
              <p className="text-xs text-gray-400">A resposta usa a configuração atual da IA deste tenant. Nada é enviado ao cliente.</p>
            </div>
          </div>

          {/* 3. Bot errors */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-900 mb-4">Erros do bot</h2>

            {errorsQ.isLoading && <p className="text-sm text-gray-400">Carregando erros...</p>}
            {errorsQ.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(errorsQ.error as any)?.message ?? 'Erro ao carregar'}</p>
            )}
            {errorsQ.isSuccess && errors.length === 0 && (
              <p className="text-sm text-gray-400">Nenhum erro recente.</p>
            )}

            <div className="space-y-2">
              {errors.map((e: any) => (
                <div key={e.id} className="p-3 rounded-xl bg-red-50 border border-red-100">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-red-700 font-mono">{e.kind}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{e.created_at ? fmtDateTime(e.created_at) : ''}</span>
                  </div>
                  <p className="text-sm text-gray-700 mt-1 break-words">
                    {String(e.detail ?? '').slice(0, 200)}{String(e.detail ?? '').length > 200 ? '…' : ''}
                  </p>
                  {e.conversation_id && (
                    <p className="text-xs text-gray-400 mt-1 font-mono">conversa: {e.conversation_id}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* 4. Tenant WhatsApp */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-semibold text-gray-900">WhatsApp do tenant</h2>

            {whatsappQ.isLoading && <p className="text-sm text-gray-400">Carregando...</p>}
            {whatsappQ.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(whatsappQ.error as any)?.message ?? 'Erro ao carregar'}</p>
            )}

            {wa && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge
                    label={whatsappStatusLabel[wa.status] ?? wa.status ?? '—'}
                    variant={whatsappStatusVariant[wa.status] ?? 'default'}
                  />
                  {wa.phone_number && <span className="text-sm text-gray-600">{wa.phone_number}</span>}
                </div>
                {wa.state && <p className="text-xs text-gray-400 font-mono">estado: {wa.state}</p>}

                {reconnectMutation.isPending && <p className="text-sm text-gray-400">gerando QR…</p>}
                {qrPending && !reconnectMutation.isPending && (
                  <p className="text-sm text-gray-500 bg-yellow-50 rounded-xl px-4 py-2">gerando QR… tente reconectar novamente em alguns segundos.</p>
                )}
                {qr && (
                  <div className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                      alt="QR Code do WhatsApp"
                      className="w-44 h-44"
                    />
                    <p className="text-xs text-gray-400 text-center">Peça ao dono para escanear no WhatsApp (Aparelhos conectados).</p>
                  </div>
                )}

                {(reconnectMutation.isError || logoutMutation.isError) && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">
                    {((reconnectMutation.error ?? logoutMutation.error) as any)?.message ?? 'Erro na operação'}
                  </p>
                )}

                <button
                  onClick={() => { if (confirm('Reconectar o WhatsApp deste tenant? Um novo QR code será gerado.')) reconnectMutation.mutate() }}
                  disabled={reconnectMutation.isPending}
                  className="w-full h-10 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {reconnectMutation.isPending ? 'Reconectando...' : 'Reconectar'}
                </button>
                <button
                  onClick={() => { if (confirm('Desconectar o WhatsApp deste tenant? O bot deixará de responder até reconectar.')) logoutMutation.mutate() }}
                  disabled={logoutMutation.isPending}
                  className="w-full h-10 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  {logoutMutation.isPending ? 'Desconectando...' : 'Desconectar'}
                </button>
              </div>
            )}
          </div>

          {/* 5. AI usage */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-semibold text-gray-900">Uso de IA (mês)</h2>

            {aiUsageQ.isLoading && <p className="text-sm text-gray-400">Carregando...</p>}
            {aiUsageQ.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(aiUsageQ.error as any)?.message ?? 'Erro ao carregar'}</p>
            )}

            {usage && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold text-gray-900">{fmtUsd(usage.month_spend)}</span>
                  <span className="text-sm text-gray-400">de {usage.cap > 0 ? fmtUsd(usage.cap) : 'sem limite'}</span>
                </div>
                {usage.cap > 0 && (
                  <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${capHit ? 'bg-red-500' : capPct >= 80 ? 'bg-yellow-400' : 'bg-primary'}`}
                      style={{ width: `${capPct}%` }}
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-gray-400">Plano:</span>
                  <Badge label={usage.plan ?? '—'} variant="default" />
                </div>
                {capHit && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">Limite do mês atingido — o bot pode estar silenciado até o próximo ciclo.</p>
                )}
              </div>
            )}
          </div>

          {/* 6. Clear cache */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-3">
            <h2 className="font-semibold text-gray-900">Limpar cache</h2>
            <p className="text-xs text-gray-400">Remove o cache de configuração e de contexto deste tenant no Redis. Use quando uma mudança de configuração não surtiu efeito no bot.</p>
            {clearCacheMutation.isError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(clearCacheMutation.error as any)?.message ?? 'Erro ao limpar cache'}</p>
            )}
            <button
              onClick={() => { if (confirm('Limpar o cache deste tenant? O bot recarregará a configuração na próxima mensagem.')) clearCacheMutation.mutate() }}
              disabled={clearCacheMutation.isPending}
              className="w-full h-10 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
            >
              {clearCacheMutation.isPending ? 'Limpando...' : 'Limpar cache do tenant'}
            </button>
          </div>
        </div>
      </div>

      {/* Conversation thread modal */}
      {openConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 flex flex-col max-h-[85vh]">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {[openConv.customer_name, openConv.customer_last_name].filter(Boolean).join(' ') || 'Cliente'}
                </h2>
                <p className="text-sm text-gray-400">{openConv.customer_phone}</p>
              </div>
              <button onClick={() => setOpenConv(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-gray-400 mb-3">Somente leitura. Dados de clientes — acesso auditado.</p>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {messagesQ.isLoading && <p className="text-sm text-gray-400">Carregando mensagens...</p>}
              {messagesQ.isError && (
                <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{(messagesQ.error as any)?.message ?? 'Erro ao carregar mensagens'}</p>
              )}
              {messagesQ.isSuccess && (messagesQ.data?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400">Nenhuma mensagem nesta conversa.</p>
              )}
              {messagesQ.data?.map((m: any) => (
                <div key={m.id} className={`flex ${m.role === 'assistant' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] px-4 py-2 text-sm whitespace-pre-wrap rounded-2xl ${
                    m.role === 'assistant'
                      ? 'bg-primary-light text-gray-900 rounded-tr-sm'
                      : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                  }`}>
                    {m.content}
                    <div className="text-[10px] text-gray-400 mt-1">{m.created_at ? fmtDateTime(m.created_at) : ''}</div>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setOpenConv(null)} className="mt-4 h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50 self-end">
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
