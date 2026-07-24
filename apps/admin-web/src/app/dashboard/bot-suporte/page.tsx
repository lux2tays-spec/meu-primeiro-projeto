'use client'
import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

export default function BotSuportePage() {
  return (
    <div className="p-8 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bot do Site (WhatsApp do sistema)</h1>
        <p className="text-gray-500 text-sm mt-1">
          Conecte um WhatsApp da plataforma. Ele vira o botão de atendimento na página inicial, tira dúvidas dos visitantes e os direciona para se cadastrar.
        </p>
      </div>
      <ConnectionCard />
      <BehaviourCard />
    </div>
  )
}

// ── Connection (QR) ──────────────────────────────────────────────────────────
function ConnectionCard() {
  const qc = useQueryClient()
  const [qr, setQr] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const { data: status } = useQuery({
    queryKey: ['support-bot-status'],
    queryFn: rootApi.supportBotStatus,
    refetchInterval: qr ? 3000 : 15000, // poll faster while showing a QR
  })

  // While a QR is on screen, poll for connection; clear QR once connected.
  useEffect(() => {
    if (status?.status === 'connected' && qr) setQr(null)
  }, [status?.status, qr])

  const connectMutation = useMutation({
    mutationFn: rootApi.supportBotConnect,
    onSuccess: (res) => {
      if (res.qrcode) setQr(res.qrcode)
      pollQr()
    },
  })

  async function pollQr() {
    setConnecting(true)
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2500))
      const st = await rootApi.supportBotStatus().catch(() => null)
      if (st?.status === 'connected') { setQr(null); qc.invalidateQueries({ queryKey: ['support-bot-status'] }); break }
      const q = await rootApi.supportBotQr().catch(() => null)
      if (q?.qrcode) setQr(q.qrcode)
    }
    setConnecting(false)
  }

  const disconnectMutation = useMutation({
    mutationFn: rootApi.supportBotDisconnect,
    onSuccess: () => { setQr(null); qc.invalidateQueries({ queryKey: ['support-bot-status'] }) },
  })

  const connected = status?.status === 'connected'

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Conexão</h2>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
          connected ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {connected ? `Conectado${status?.phone_number ? ` · ${status.phone_number}` : ''}` : 'Desconectado'}
        </span>
      </div>

      {connected ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">O WhatsApp do sistema está conectado e respondendo os visitantes da página inicial.</p>
          <button onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}
            className="h-10 px-4 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50">
            {disconnectMutation.isPending ? 'Desconectando...' : 'Desconectar'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {qr ? (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code" className="w-56 h-56 rounded-xl border border-gray-100" />
              <p className="text-xs text-gray-500 text-center">Abra o WhatsApp do número do sistema → Aparelhos conectados → Conectar aparelho e escaneie.</p>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Clique abaixo para gerar o QR e conectar o WhatsApp do sistema.</p>
          )}
          <button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending || connecting}
            className="h-10 px-4 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-dark disabled:opacity-50">
            {connectMutation.isPending || connecting ? 'Gerando QR...' : qr ? 'Gerar novo QR' : 'Conectar WhatsApp'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Behaviour ────────────────────────────────────────────────────────────────
function BehaviourCard() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const { data, isLoading } = useQuery({ queryKey: ['support-bot'], queryFn: rootApi.supportBot })

  const [form, setForm] = useState({ enabled: false, system_prompt: '', product_info: '', register_url: '' })

  useEffect(() => {
    if (!data) return
    setForm({
      enabled: !!data.enabled,
      system_prompt: data.system_prompt ?? '',
      product_info: data.product_info ?? '',
      register_url: data.register_url ?? '',
    })
  }, [data])

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSupportBot(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['support-bot'] }); setSuccess('Comportamento salvo!'); setTimeout(() => setSuccess(''), 3000) },
  })

  if (isLoading) return null

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
      <div>
        <h2 className="font-semibold text-gray-900">Comportamento do bot de suporte</h2>
        <p className="text-xs text-gray-500 mt-1">Como o bot do site conversa e para onde direciona os visitantes.</p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-primary" />
        <span>
          <span className="block text-sm font-medium text-gray-700">Bot ativo na página inicial</span>
          <span className="block text-xs text-gray-400 mt-0.5">Quando ligado E conectado, o botão de WhatsApp aparece na landing.</span>
        </span>
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Persona / instruções do bot</label>
        <textarea value={form.system_prompt} onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))} rows={6}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Informações do produto (planos, preços, recursos)</label>
        <textarea value={form.product_info} onChange={(e) => setForm((f) => ({ ...f, product_info: e.target.value }))} rows={6}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Ex.: Plano Básico R$X/mês (1 agenda, 1 usuário)... Plano Premium R$Y (3 agendas)... Recursos: agendamento por WhatsApp, lembretes, etc." />
        <p className="text-xs text-gray-400 mt-1">O bot só usa estes dados para falar de preços/recursos — evita inventar informação.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Link de cadastro (CTA)</label>
        <input value={form.register_url} onChange={(e) => setForm((f) => ({ ...f, register_url: e.target.value }))} className={inputCls}
          placeholder="https://app.aiconfirma.com.br/register" />
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
          className="h-10 px-5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl disabled:opacity-50">
          {mutation.isPending ? 'Salvando...' : 'Salvar comportamento'}
        </button>
        {success && <span className="text-green-600 text-sm font-medium">{success}</span>}
      </div>
    </div>
  )
}
