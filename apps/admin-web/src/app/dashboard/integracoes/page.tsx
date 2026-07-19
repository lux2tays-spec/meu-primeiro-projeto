'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

type Tab = 'whatsapp' | 'email' | 'google'

export default function IntegracoesPage() {
  const [tab, setTab] = useState<Tab>('whatsapp')

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrações</h1>
        <p className="text-gray-500 text-sm mt-1">
          Credenciais dos serviços externos. Os campos secretos são <strong>criptografados</strong> e exibidos
          <strong> mascarados</strong> — deixe como estão para manter o valor atual.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['whatsapp', '📱 WhatsApp'], ['email', '📧 E-mail'], ['google', '📅 Google']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'whatsapp' && <WhatsAppTab />}
      {tab === 'email' && <EmailTab />}
      {tab === 'google' && <GoogleTab />}
    </div>
  )
}

// ── WhatsApp (Evolution) ──────────────────────────────────────────────────────
const EVO_DEFAULT = { url: '', key: '', webhook_base: '', webhook_secret: '' }

function WhatsAppTab() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [evo, setEvo] = useState<any>(EVO_DEFAULT)

  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  useEffect(() => {
    if (settings?.evolution_config) setEvo({ ...EVO_DEFAULT, ...settings.evolution_config })
  }, [settings])

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSettings('evolution_config', evo),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); showSuccess('Configuração do WhatsApp salva!') },
  })

  if (isError) return <ErrBox />
  if (isLoading) return <LoadBox />

  return (
    <div className="space-y-6">
      {success && <SuccessBox msg={success} />}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">WhatsApp (Evolution API)</h2>
          <p className="text-xs text-gray-500 mt-1">
            Servidor Evolution que conecta os WhatsApps dos clientes. A Chave e o Segredo do webhook ficam mascarados —
            deixe como estão para manter.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <SF label="URL da API" value={evo.url} onChange={(v: string) => setEvo((s: any) => ({ ...s, url: v }))} placeholder="https://evolution.seudominio.com" />
          <SF label="Chave da API 🔒" value={evo.key} onChange={(v: string) => setEvo((s: any) => ({ ...s, key: v }))} type="password" placeholder="••••••••" />
          <SF label="URL base de webhook" value={evo.webhook_base} onChange={(v: string) => setEvo((s: any) => ({ ...s, webhook_base: v }))} placeholder="https://api.aiconfirma.com.br" />
          <SF label="Segredo do webhook 🔒" value={evo.webhook_secret} onChange={(v: string) => setEvo((s: any) => ({ ...s, webhook_secret: v }))} type="password" placeholder="••••••••" />
        </div>
        <div className="bg-amber-50 rounded-xl p-3 text-xs text-amber-700">
          Ao alterar a URL base ou o segredo do webhook, reconecte os WhatsApps para que passem a usar os novos valores.
        </div>
        <SaveBtn pending={mutation.isPending} onClick={() => mutation.mutate()} label="Salvar WhatsApp" />
      </div>
    </div>
  )
}

// ── E-mail (SMTP) ─────────────────────────────────────────────────────────────
const SMTP_DEFAULT = { host: '', port: 587, user: '', pass: '', secure: false, from: '' }

function EmailTab() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [smtp, setSmtp] = useState<any>(SMTP_DEFAULT)

  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  useEffect(() => {
    if (settings?.smtp_config) setSmtp({ ...SMTP_DEFAULT, ...settings.smtp_config })
  }, [settings])

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSettings('smtp_config', { ...smtp, port: Number(smtp.port) || 587 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); showSuccess('Configuração SMTP salva!') },
  })

  if (isError) return <ErrBox />
  if (isLoading) return <LoadBox />

  return (
    <div className="space-y-6">
      {success && <SuccessBox msg={success} />}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Servidor de E-mail (SMTP)</h2>
          <p className="text-xs text-gray-500 mt-1">
            Usado para enviar e-mails automáticos da plataforma (confirmações, redefinição de senha, convites). A Senha
            fica mascarada — deixe como está para manter.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <SF label="Servidor (host)" value={smtp.host} onChange={(v: string) => setSmtp((s: any) => ({ ...s, host: v }))} placeholder="smtp.gmail.com" />
          <SF label="Porta" value={smtp.port} onChange={(v: string) => setSmtp((s: any) => ({ ...s, port: v }))} type="number" placeholder="587" />
          <SF label="Usuário (e-mail)" value={smtp.user} onChange={(v: string) => setSmtp((s: any) => ({ ...s, user: v }))} placeholder="noreply@seudominio.com" />
          <SF label="Senha 🔒" value={smtp.pass} onChange={(v: string) => setSmtp((s: any) => ({ ...s, pass: v }))} type="password" placeholder="••••••••" />
          <SF label="Remetente (from)" value={smtp.from} onChange={(v: string) => setSmtp((s: any) => ({ ...s, from: v }))} placeholder="AiConfirma <noreply@aiconfirma.com.br>" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp((s: any) => ({ ...s, secure: e.target.checked }))} className="rounded" />
          Usar SSL/TLS (porta 465)
        </label>
        <SaveBtn pending={mutation.isPending} onClick={() => mutation.mutate()} label="Salvar SMTP" />
      </div>
    </div>
  )
}

// ── Google (Agenda) ───────────────────────────────────────────────────────────
const GOOGLE_DEFAULT = { client_id: '', client_ids: '', client_secret: '' }

function GoogleTab() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [g, setG] = useState<any>(GOOGLE_DEFAULT)

  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  useEffect(() => {
    if (settings?.google_config) setG({ ...GOOGLE_DEFAULT, ...settings.google_config })
  }, [settings])

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSettings('google_config', g),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); showSuccess('Configuração do Google salva!') },
  })

  if (isError) return <ErrBox />
  if (isLoading) return <LoadBox />

  return (
    <div className="space-y-6">
      {success && <SuccessBox msg={success} />}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Google (Login &amp; Agenda)</h2>
          <p className="text-xs text-gray-500 mt-1">
            Credenciais OAuth do Google para login social e sincronização de agenda. O Client Secret fica mascarado —
            deixe como está para manter.
          </p>
        </div>
        <div className="space-y-4">
          <SF label="Client ID" value={g.client_id} onChange={(v: string) => setG((s: any) => ({ ...s, client_id: v }))} placeholder="1234567890-abc.apps.googleusercontent.com" full />
          <SF label="Client IDs permitidos (separados por vírgula)" value={g.client_ids} onChange={(v: string) => setG((s: any) => ({ ...s, client_ids: v }))} placeholder="web.apps.googleusercontent.com, ios.apps.googleusercontent.com" full />
          <SF label="Client Secret 🔒" value={g.client_secret} onChange={(v: string) => setG((s: any) => ({ ...s, client_secret: v }))} type="password" placeholder="••••••••" full />
        </div>
        <SaveBtn pending={mutation.isPending} onClick={() => mutation.mutate()} label="Salvar Google" />
      </div>
    </div>
  )
}

// ── Shared bits ───────────────────────────────────────────────────────────────
function SF({ label, value, onChange, placeholder, type = 'text', full = false }: any) {
  return (
    <div className={full ? 'col-span-2' : 'col-span-1'}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
    </div>
  )
}

function SaveBtn({ pending, onClick, label }: any) {
  return (
    <button onClick={onClick} disabled={pending}
      className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors">
      {pending ? 'Salvando...' : label}
    </button>
  )
}

const SuccessBox = ({ msg }: { msg: string }) => <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{msg}</div>
const ErrBox = () => <div className="text-red-500 text-sm py-4">Erro ao carregar configurações. Verifique se o backend está rodando.</div>
const LoadBox = () => <div className="text-gray-400 text-sm py-4">Carregando...</div>
