'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

type Tab = 'email' | 'ai' | 'plans'

const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  welcome:                'Boas-vindas ao novo usuário',
  verify_email:           'Confirmação de e-mail',
  reset_password:         'Redefinição de senha',
  new_staff:              'Novo colaborador adicionado',
  trial_ending:           'Aviso de trial encerrando',
  subscription_confirmed: 'Assinatura confirmada',
}

const PLAN_BLANK = { slug: '', name: '', description: '', price_cents: 0, max_agendas: 1, max_users: 1, trial_days: 0, features: [], is_active: true, sort_order: 0 }

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('email')

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configurações Gerais da Plataforma</h1>
        <p className="text-gray-500 text-sm mt-1">E-mails, IA e gestão de planos</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['email', '📧 E-mails'], ['ai', '🤖 IA'], ['plans', '📦 Planos']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'email' && <EmailTab />}
      {tab === 'ai'    && <AITab />}
      {tab === 'plans' && <PlansTab />}
    </div>
  )
}

// ── Email Tab ─────────────────────────────────────────────────────────────────
const SMTP_DEFAULT = { host: '', port: 587, user: '', pass: '', from_name: 'AgendaBot', from_email: '', secure: false }
const TMPL_DEFAULT = Object.fromEntries(
  Object.keys(EMAIL_TEMPLATE_LABELS).map((k) => [k, { subject: '', enabled: true }])
)

function EmailTab() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [smtp, setSmtp] = useState<any>(SMTP_DEFAULT)
  const [templates, setTemplates] = useState<any>(TMPL_DEFAULT)

  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  useEffect(() => {
    if (settings?.email_smtp)      setSmtp({ ...SMTP_DEFAULT, ...settings.email_smtp })
    if (settings?.email_templates) setTemplates({ ...TMPL_DEFAULT, ...settings.email_templates })
  }, [settings])

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const smtpMutation = useMutation({
    mutationFn: () => rootApi.updateSettings('email_smtp', smtp),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); showSuccess('Configurações SMTP salvas!') },
  })

  const templatesMutation = useMutation({
    mutationFn: () => rootApi.updateSettings('email_templates', templates),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); showSuccess('Templates salvos!') },
  })

  if (isError) return <div className="text-red-500 text-sm py-4">Erro ao carregar configurações. Verifique se o backend está rodando.</div>
  if (isLoading) return <div className="text-gray-400 text-sm py-4">Carregando...</div>

  return (
    <div className="space-y-6">
      {success && <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{success}</div>}

      {/* SMTP */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
        <h2 className="font-semibold text-gray-900">Configurações SMTP</h2>
        <p className="text-xs text-gray-500">Configure o servidor de e-mail para envio das mensagens automáticas da plataforma.</p>

        <div className="grid grid-cols-2 gap-4">
          <SF label="Servidor SMTP (host)" value={smtp.host} onChange={(v: string) => setSmtp((s: any) => ({ ...s, host: v }))} placeholder="smtp.gmail.com" />
          <SF label="Porta" value={smtp.port} onChange={(v: string) => setSmtp((s: any) => ({ ...s, port: Number(v) }))} type="number" placeholder="587" />
          <SF label="Usuário (e-mail)" value={smtp.user} onChange={(v: string) => setSmtp((s: any) => ({ ...s, user: v }))} placeholder="noreply@seudominio.com" />
          <SF label="Senha" value={smtp.pass} onChange={(v: string) => setSmtp((s: any) => ({ ...s, pass: v }))} type="password" placeholder="••••••••" />
          <SF label="Nome do remetente" value={smtp.from_name} onChange={(v: string) => setSmtp((s: any) => ({ ...s, from_name: v }))} placeholder="AgendaBot" />
          <SF label="E-mail do remetente" value={smtp.from_email} onChange={(v: string) => setSmtp((s: any) => ({ ...s, from_email: v }))} placeholder="noreply@agendabot.com.br" />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp((s: any) => ({ ...s, secure: e.target.checked }))} className="rounded" />
            Usar SSL/TLS (porta 465)
          </label>
        </div>

        <button onClick={() => smtpMutation.mutate()} disabled={smtpMutation.isPending}
          className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors">
          {smtpMutation.isPending ? 'Salvando...' : 'Salvar SMTP'}
        </button>
      </div>

      {/* Email templates */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
        <h2 className="font-semibold text-gray-900">Assunto dos E-mails</h2>
        <p className="text-xs text-gray-500">Configure o assunto e ative/desative cada tipo de e-mail enviado pela plataforma.</p>

        <div className="space-y-3">
          {Object.entries(EMAIL_TEMPLATE_LABELS).map(([key, friendlyName]) => {
            const tpl = templates[key] ?? { subject: '', enabled: true }
            return (
              <div key={key} className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 hover:bg-gray-50">
                <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={tpl.enabled}
                    onChange={(e) => setTemplates((t: any) => ({ ...t, [key]: { ...tpl, enabled: e.target.checked } }))}
                    className="rounded" />
                </label>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-800">{friendlyName}</div>
                  <input
                    value={tpl.subject}
                    onChange={(e) => setTemplates((t: any) => ({ ...t, [key]: { ...tpl, subject: e.target.value } }))}
                    placeholder="Assunto do e-mail..."
                    className="mt-1 w-full h-8 px-3 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <button onClick={() => templatesMutation.mutate()} disabled={templatesMutation.isPending}
          className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors">
          {templatesMutation.isPending ? 'Salvando...' : 'Salvar templates'}
        </button>
      </div>
    </div>
  )
}

// ── AI Tab ────────────────────────────────────────────────────────────────────
const AI_DEFAULT = { provider: 'anthropic', api_key: '', base_url: '', model: 'claude-haiku-4-5' }

function AITab() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const [ai, setAi] = useState<any>(AI_DEFAULT)

  const { data: settings, isLoading, isError } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  useEffect(() => {
    if (settings?.ai_config) setAi({ ...AI_DEFAULT, ...settings.ai_config })
  }, [settings])

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSettings('ai_config', ai),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); showSuccess('Configurações de IA salvas!') },
  })

  if (isError) return <div className="text-red-500 text-sm py-4">Erro ao carregar configurações. Verifique se o backend está rodando.</div>
  if (isLoading) return <div className="text-gray-400 text-sm py-4">Carregando...</div>

  const PROVIDERS = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openai',    label: 'OpenAI (GPT)' },
    { value: 'custom',    label: 'Custom / OpenAI-compatible' },
  ]

  const MODEL_HINTS: Record<string, string[]> = {
    anthropic: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
    openai:    ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    custom:    [],
  }

  return (
    <div className="space-y-6">
      {success && <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{success}</div>}

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
        <div>
          <h2 className="font-semibold text-gray-900">Motor de Inteligência Artificial</h2>
          <p className="text-xs text-gray-500 mt-1">
            Configure qual motor de IA o chatbot utilizará para responder os clientes. Suporta Anthropic, OpenAI ou qualquer API compatível com OpenAI.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Provedor</label>
          <select value={ai.provider} onChange={(e) => setAi((a: any) => ({ ...a, provider: e.target.value, base_url: '', model: '' }))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white">
            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <SF label="Chave de API (API Key)" value={ai.api_key} onChange={(v: string) => setAi((a: any) => ({ ...a, api_key: v }))}
          type="password" placeholder="sk-..." />

        {ai.provider === 'custom' && (
          <SF label="URL base da API (Base URL)" value={ai.base_url} onChange={(v: string) => setAi((a: any) => ({ ...a, base_url: v }))}
            placeholder="https://api.seumotor.com/v1" />
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Modelo</label>
          <input value={ai.model} onChange={(e) => setAi((a: any) => ({ ...a, model: e.target.value }))}
            placeholder="Nome do modelo..."
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          {(MODEL_HINTS[ai.provider] ?? []).length > 0 && (
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className="text-xs text-gray-400">Sugestões:</span>
              {MODEL_HINTS[ai.provider].map((m) => (
                <button key={m} onClick={() => setAi((a: any) => ({ ...a, model: m }))}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full transition-colors">
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-blue-50 rounded-xl p-4 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Configuração atual:</p>
          <p>Provedor: <strong>{ai.provider}</strong></p>
          <p>Modelo: <strong>{ai.model || '(não definido)'}</strong></p>
          {ai.base_url && <p>URL: <strong>{ai.base_url}</strong></p>}
        </div>

        <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
          className="h-10 px-6 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors">
          {mutation.isPending ? 'Salvando...' : 'Salvar configurações de IA'}
        </button>
      </div>
    </div>
  )
}

// ── Plans Tab ─────────────────────────────────────────────────────────────────
function PlansTab() {
  const qc = useQueryClient()
  const [modal, setModal] = useState<null | 'create' | any>(null)
  const [form, setForm] = useState<any>(PLAN_BLANK)
  const [featuresStr, setFeaturesStr] = useState('')
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<any>(null)

  const { data: plans, isLoading } = useQuery({ queryKey: ['root-plans'], queryFn: rootApi.plans })

  const showSuccess = (msg: string) => { setSuccess(msg); setTimeout(() => setSuccess(''), 3000) }

  const openCreate = () => {
    setForm(PLAN_BLANK); setFeaturesStr(''); setErr(''); setModal('create')
  }
  const openEdit = (p: any) => {
    setForm({ ...p }); setFeaturesStr((p.features ?? []).join('\n')); setErr(''); setModal(p)
  }

  const createMutation = useMutation({
    mutationFn: () => rootApi.createPlan({ ...form, features: featuresStr.split('\n').filter(Boolean) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-plans'] }); setModal(null); showSuccess('Plano criado!') },
    onError: (e: any) => setErr(e.message),
  })

  const editMutation = useMutation({
    mutationFn: () => rootApi.updatePlan(modal.id, { ...form, features: featuresStr.split('\n').filter(Boolean) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-plans'] }); setModal(null); showSuccess('Plano atualizado!') },
    onError: (e: any) => setErr(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rootApi.deletePlan(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-plans'] }); setConfirmDelete(null); showSuccess('Plano excluído!') },
    onError: (e: any) => setSuccess(e.message),
  })

  const isEditing = modal && modal !== 'create'
  const isPending = createMutation.isPending || editMutation.isPending
  const fmt = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`

  const DEFAULT_SLUGS = ['free', 'basico', 'premium', 'profissional']

  return (
    <div className="space-y-6">
      {success && <div className="bg-green-50 text-green-700 rounded-xl px-4 py-3 text-sm font-medium">{success}</div>}

      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">Gerencie os planos disponíveis na plataforma. Planos padrão não podem ser excluídos.</p>
        <button onClick={openCreate}
          className="h-10 px-5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark transition-colors">
          + Novo plano
        </button>
      </div>

      {isLoading ? <div className="text-gray-400 text-sm">Carregando...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans?.map((p: any) => (
            <div key={p.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900">{p.name}</h3>
                    {!p.is_active && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inativo</span>}
                  </div>
                  <p className="text-xs text-gray-400 font-mono">{p.slug}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">{p.price_cents === 0 ? 'Grátis' : fmt(p.price_cents)}</div>
                  {p.price_cents > 0 && <div className="text-xs text-gray-400">/mês</div>}
                </div>
              </div>
              {p.description && <p className="text-xs text-gray-500 mb-3">{p.description}</p>}
              <div className="flex gap-4 text-xs text-gray-600 mb-3">
                <span>{p.max_agendas} agenda{p.max_agendas > 1 ? 's' : ''}</span>
                <span>{p.max_users} usuário{p.max_users > 1 ? 's' : ''}</span>
                {p.trial_days > 0 && <span>Trial: {p.trial_days} dias</span>}
              </div>
              {(p.features ?? []).length > 0 && (
                <ul className="text-xs text-gray-500 space-y-0.5 mb-3">
                  {p.features.map((f: string, i: number) => <li key={i}>• {f}</li>)}
                </ul>
              )}
              <div className="flex gap-2 pt-2 border-t border-gray-50">
                <button onClick={() => openEdit(p)} className="text-xs text-primary hover:text-primary-dark font-medium">Editar</button>
                {!DEFAULT_SLUGS.includes(p.slug) && (
                  <button onClick={() => setConfirmDelete(p)} className="text-xs text-red-400 hover:text-red-600 font-medium">Excluir</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Plan modal */}
      {modal !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-screen overflow-y-auto">
            <h2 className="text-lg font-bold text-gray-900">{isEditing ? 'Editar plano' : 'Novo plano'}</h2>
            {err && <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{err}</p>}

            <div className="grid grid-cols-2 gap-4">
              <SF label="Nome do plano" value={form.name} onChange={(v: string) => setForm((f: any) => ({ ...f, name: v }))} placeholder="Ex: Enterprise" />
              <SF label="Slug (ID único)" value={form.slug} onChange={(v: string) => setForm((f: any) => ({ ...f, slug: v.toLowerCase().replace(/\s/g, '_') }))} placeholder="enterprise" />
              <SF label="Preço (centavos)" value={form.price_cents} onChange={(v: string) => setForm((f: any) => ({ ...f, price_cents: Number(v) }))} type="number" placeholder="8900 = R$89,00" />
              <SF label="Máx. agendas" value={form.max_agendas} onChange={(v: string) => setForm((f: any) => ({ ...f, max_agendas: Number(v) }))} type="number" />
              <SF label="Máx. usuários" value={form.max_users} onChange={(v: string) => setForm((f: any) => ({ ...f, max_users: Number(v) }))} type="number" />
              <SF label="Dias de trial" value={form.trial_days} onChange={(v: string) => setForm((f: any) => ({ ...f, trial_days: Number(v) }))} type="number" />
              <SF label="Ordem (sort)" value={form.sort_order} onChange={(v: string) => setForm((f: any) => ({ ...f, sort_order: Number(v) }))} type="number" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
              <input value={form.description ?? ''} onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))}
                placeholder="Breve descrição do plano..."
                className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Funcionalidades (uma por linha)</label>
              <textarea value={featuresStr} onChange={(e) => setFeaturesStr(e.target.value)} rows={4}
                placeholder={'3 agendas\n3 usuários\nSuporte prioritário'}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none" />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f: any) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
              Plano ativo (visível para novos usuários)
            </label>

            <div className="flex gap-3 pt-2">
              <button onClick={() => isEditing ? editMutation.mutate() : createMutation.mutate()} disabled={isPending || !form.name || !form.slug}
                className="flex-1 h-10 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors">
                {isPending ? 'Salvando...' : isEditing ? 'Salvar alterações' : 'Criar plano'}
              </button>
              <button onClick={() => setModal(null)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Excluir plano</h2>
            <p className="text-sm text-gray-600">Excluir o plano <strong>{confirmDelete.name}</strong>?</p>
            <div className="flex gap-3">
              <button onClick={() => deleteMutation.mutate(confirmDelete.id)} disabled={deleteMutation.isPending}
                className="flex-1 h-10 bg-red-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                {deleteMutation.isPending ? 'Excluindo...' : 'Confirmar'}
              </button>
              <button onClick={() => setConfirmDelete(null)} className="h-10 px-4 rounded-xl border border-gray-200 text-sm font-medium hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SF({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div className="col-span-1">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
    </div>
  )
}
