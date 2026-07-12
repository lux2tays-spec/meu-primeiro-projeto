'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getToken, tenantApi, agentApi, whatsappApi } from '@/lib/api'
import { isTenantToken } from '@/lib/auth'
import {
  Building2, Users, Tag, Clock, Bot, CreditCard, MessageCircle,
  Check, ChevronLeft, ArrowRight, Rocket, Trash2, Plus, type LucideIcon,
} from 'lucide-react'

type StepKey = 'negocio' | 'equipe' | 'servicos' | 'horarios' | 'agente' | 'pagamentos' | 'whatsapp'

const STEPS: { key: StepKey; label: string; icon: LucideIcon; why: string }[] = [
  { key: 'negocio',    label: 'Negócio',    icon: Building2,     why: 'Conte quem você é — o bot se apresenta com esses dados.' },
  { key: 'equipe',     label: 'Equipe',     icon: Users,         why: 'Cadastre quem atende: cada serviço é feito por um profissional.' },
  { key: 'servicos',   label: 'Serviços',   icon: Tag,           why: 'O bot só agenda serviços que você cadastrar aqui.' },
  { key: 'horarios',   label: 'Horários',   icon: Clock,         why: 'O bot só oferece horários dentro do seu funcionamento.' },
  { key: 'agente',     label: 'Agente IA',  icon: Bot,           why: 'Defina o tom e o contexto que a IA usa para responder seus clientes.' },
  { key: 'pagamentos', label: 'Pagamentos', icon: CreditCard,    why: 'Opcional: conecte o Mercado Pago para cobrar pelo WhatsApp.' },
  { key: 'whatsapp',   label: 'WhatsApp',   icon: MessageCircle, why: 'Conecte seu número e o bot começa a atender na hora.' },
]

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white'

/* ── Shared footer ─────────────────────────────────────────────── */
function Footer({ onBack, onContinue, continueLabel = 'Continuar', busy = false, disabled = false, showBack = true, onSkipStep, skipLabel = 'Pular esta etapa' }: {
  onBack?: () => void
  onContinue: () => void
  continueLabel?: string
  busy?: boolean
  disabled?: boolean
  showBack?: boolean
  onSkipStep?: () => void
  skipLabel?: string
}) {
  return (
    <div className="pt-6 mt-6 border-t border-gray-100 flex items-center gap-3">
      {showBack && onBack ? (
        <button onClick={onBack} className="h-11 px-4 flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition-colors">
          <ChevronLeft size={16} strokeWidth={2} /> Voltar
        </button>
      ) : <span />}
      <div className="flex-1" />
      {onSkipStep && (
        <button onClick={onSkipStep} className="h-11 px-4 text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors">
          {skipLabel}
        </button>
      )}
      <button
        onClick={onContinue}
        disabled={busy || disabled}
        className="h-11 px-6 flex items-center gap-2 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
      >
        {busy ? 'Salvando...' : continueLabel}
        {!busy && <ArrowRight size={16} strokeWidth={2} />}
      </button>
    </div>
  )
}

function StepHeader({ step }: { step: typeof STEPS[number] }) {
  const Icon = step.icon
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
          <Icon size={20} strokeWidth={1.75} className="text-primary" />
        </div>
        <h2 className="text-xl font-bold text-gray-900">{step.label}</h2>
      </div>
      <p className="text-sm text-gray-500 mt-2">{step.why}</p>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  if (!msg) return null
  return <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 mt-4">{msg}</p>
}

/* ── Passo 1: Negócio ──────────────────────────────────────────── */
function StepNegocio({ onNext, onBack }: { onNext: () => void; onBack?: () => void }) {
  const qc = useQueryClient()
  const { data: tenant, isLoading } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: templates = [] } = useQuery({ queryKey: ['business-type-templates'], queryFn: tenantApi.businessTypeTemplates })

  const [form, setForm] = useState({ name: '', contact_email: '', contact_phone: '', responsible_name: '' })
  const [businessType, setBusinessType] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (tenant) {
      setForm({
        name: tenant.name ?? '',
        contact_email: tenant.contact_email ?? '',
        contact_phone: tenant.contact_phone ?? '',
        responsible_name: tenant.responsible_name ?? '',
      })
    }
  }, [tenant])

  const save = useMutation({
    mutationFn: async () => {
      if (businessType) await tenantApi.applyBusinessTemplate(businessType)
      await tenantApi.updateBusiness({
        name: form.name.trim(),
        contact_email: form.contact_email.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        responsible_name: form.responsible_name.trim() || null,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant'] })
      qc.invalidateQueries({ queryKey: ['agent-config'] })
      setError('')
      onNext()
    },
    onError: (e: any) => setError(e.message),
  })

  if (isLoading) return <p className="text-gray-400 text-sm">Carregando...</p>

  return (
    <div>
      <StepHeader step={STEPS[0]} />

      {templates.length > 0 && (
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de negócio</label>
          <p className="text-xs text-gray-400 mb-2">Escolha um modelo e já preparamos sugestões para o seu segmento.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {templates.map((t) => (
              <button
                key={t.business_type}
                type="button"
                onClick={() => setBusinessType((cur) => cur === t.business_type ? '' : t.business_type)}
                className={`px-3 py-2.5 rounded-xl border text-sm font-medium text-left transition-colors ${
                  businessType === t.business_type
                    ? 'border-primary bg-primary-light text-primary'
                    : 'border-gray-200 text-gray-600 hover:border-primary/40'
                }`}
              >
                {t.display_name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome do negócio *</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls} placeholder="Minha Empresa" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de contato</label>
            <input type="email" value={form.contact_email} onChange={(e) => setForm((f) => ({ ...f, contact_email: e.target.value }))}
              className={inputCls} placeholder="contato@empresa.com" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
            <input value={form.contact_phone} onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
              className={inputCls} placeholder="(11) 99999-9999" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome do responsável</label>
          <input value={form.responsible_name} onChange={(e) => setForm((f) => ({ ...f, responsible_name: e.target.value }))}
            className={inputCls} placeholder="Maria Silva" />
        </div>
      </div>

      <ErrorBox msg={error} />
      <Footer onBack={onBack} showBack={false} onContinue={() => save.mutate()} busy={save.isPending} disabled={!form.name.trim()} />
    </div>
  )
}

/* ── Passo 2: Equipe ───────────────────────────────────────────── */
function StepEquipe({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: professionals = [], isLoading } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const [form, setForm] = useState({ name: '', phone: '', bio: '' })
  const [error, setError] = useState('')

  const add = useMutation({
    mutationFn: () => tenantApi.addProfessional({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      bio: form.bio.trim() || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setForm({ name: '', phone: '', bio: '' })
      setError('')
    },
    onError: (e: any) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => tenantApi.removeProfessional(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['professionals'] }),
  })

  return (
    <div>
      <StepHeader step={STEPS[1]} />

      {isLoading ? (
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : (professionals as any[]).length === 0 ? (
        <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3 mb-4">
          Nenhum profissional ainda. Cadastre ao menos um — no próximo passo você vai escolher quais serviços cada um realiza.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {(professionals as any[]).map((p) => (
            <div key={p.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                <span className="text-primary text-xs font-bold">{p.name?.[0]?.toUpperCase() ?? 'P'}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                {p.phone && <p className="text-xs text-gray-400">{p.phone}</p>}
              </div>
              <button onClick={() => remove.mutate(p.id)} disabled={remove.isPending}
                className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50" aria-label={`Remover ${p.name}`}>
                <Trash2 size={16} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Adicionar profissional</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputCls} placeholder="Nome *" />
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className={inputCls} placeholder="Telefone (opcional)" />
        </div>
        <input value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          className={inputCls} placeholder="Especialidade / bio (opcional)" />
        <button
          onClick={() => form.name.trim() && add.mutate()}
          disabled={!form.name.trim() || add.isPending}
          className="h-10 px-4 flex items-center gap-1.5 bg-primary/10 text-primary text-sm font-semibold rounded-xl hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Plus size={15} strokeWidth={2} /> {add.isPending ? 'Adicionando...' : 'Adicionar'}
        </button>
      </div>

      <ErrorBox msg={error} />
      <Footer onBack={onBack} onContinue={onNext} />
    </div>
  )
}

/* ── Passo 3: Serviços ─────────────────────────────────────────── */
function StepServicos({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: services = [], isLoading } = useQuery({ queryKey: ['services'], queryFn: tenantApi.services })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  const BLANK = { name: '', price: 0, duration_minutes: 60, reminder_days: null as number | null, professional_ids: [] as string[] }
  const [form, setForm] = useState(BLANK)
  const [error, setError] = useState('')

  const add = useMutation({
    mutationFn: () => tenantApi.createService({
      name: form.name.trim(),
      price: form.price,
      duration_minutes: Math.max(1, Math.floor(form.duration_minutes)),
      reminder_days: form.reminder_days,
      professional_ids: form.professional_ids,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setForm(BLANK)
      setError('')
    },
    onError: (e: any) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => tenantApi.deleteService(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })

  function togglePro(id: string) {
    setForm((f) => ({
      ...f,
      professional_ids: f.professional_ids.includes(id)
        ? f.professional_ids.filter((x) => x !== id)
        : [...f.professional_ids, id],
    }))
  }

  return (
    <div>
      <StepHeader step={STEPS[2]} />

      {isLoading ? (
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : (services as any[]).length === 0 ? (
        <p className="text-sm text-gray-400 bg-gray-50 rounded-xl px-4 py-3 mb-4">
          Nenhum serviço ainda. Cadastre o que seu negócio oferece — nome, preço e duração.
        </p>
      ) : (
        <div className="space-y-2 mb-4">
          {(services as any[]).map((s) => (
            <div key={s.id} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{s.name}</p>
                <p className="text-xs text-gray-400">
                  {s.duration_minutes} min · R$ {Number(s.price).toFixed(2)}
                  {s.professionals?.length > 0 && ` · ${s.professionals.map((p: any) => p.name).join(', ')}`}
                </p>
              </div>
              <button onClick={() => remove.mutate(s.id)} disabled={remove.isPending}
                className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50" aria-label={`Remover ${s.name}`}>
                <Trash2 size={16} strokeWidth={1.75} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Adicionar serviço</p>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={inputCls} placeholder="Nome do serviço * (ex.: Limpeza de pele)" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Preço (R$) *</label>
            <input type="number" min={0} step={0.01} value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Duração (min) *</label>
            <input type="number" min={15} step={15} value={form.duration_minutes}
              onChange={(e) => setForm((f) => ({ ...f, duration_minutes: Number(e.target.value) }))} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Lembrar o cliente após (dias, opcional)</label>
          <input type="number" min={0} step={1} value={form.reminder_days ?? ''}
            onChange={(e) => setForm((f) => ({
              ...f,
              reminder_days: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)),
            }))}
            className={`${inputCls} w-28`} placeholder="Ex.: 30" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Quem realiza este serviço</label>
          {(professionals as any[]).length === 0 ? (
            <p className="text-xs text-gray-400 italic">Nenhum profissional cadastrado — volte ao passo Equipe para adicionar.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(professionals as any[]).map((p) => {
                const sel = form.professional_ids.includes(p.id)
                return (
                  <button key={p.id} type="button" onClick={() => togglePro(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      sel ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary hover:text-primary'
                    }`}>
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <button
          onClick={() => form.name.trim() && add.mutate()}
          disabled={!form.name.trim() || add.isPending}
          className="h-10 px-4 flex items-center gap-1.5 bg-primary/10 text-primary text-sm font-semibold rounded-xl hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          <Plus size={15} strokeWidth={2} /> {add.isPending ? 'Adicionando...' : 'Adicionar'}
        </button>
      </div>

      <ErrorBox msg={error} />
      <Footer onBack={onBack} onContinue={onNext} />
    </div>
  )
}

/* ── Passo 4: Horários ─────────────────────────────────────────── */
const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
type HourRow = { day_of_week: number; start_time: string; end_time: string; enabled: boolean }
const DEFAULT_ROWS: HourRow[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: '09:00',
  end_time: '18:00',
  enabled: i > 0 && i < 6,
}))

function StepHorarios({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: saved, isLoading } = useQuery({ queryKey: ['hours'], queryFn: () => tenantApi.hours() })
  const [rows, setRows] = useState<HourRow[]>(DEFAULT_ROWS)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!saved) return
    setRows(DEFAULT_ROWS.map((def) => {
      const match = (saved as any[]).find((r) => r.day_of_week === def.day_of_week)
      return match
        ? { ...def, start_time: match.start_time.slice(0, 5), end_time: match.end_time.slice(0, 5), enabled: true }
        : { ...def, enabled: false }
    }))
  }, [saved])

  const save = useMutation({
    mutationFn: () => tenantApi.saveHours(rows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hours'] })
      setError('')
      onNext()
    },
    onError: (e: any) => setError(e.message),
  })

  function toggle(i: number) { setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, enabled: !r.enabled } : r)) }
  function setTime(i: number, field: 'start_time' | 'end_time', v: string) {
    setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, [field]: v } : r))
  }

  return (
    <div>
      <StepHeader step={STEPS[3]} />

      {isLoading ? (
        <p className="text-gray-400 text-sm">Carregando...</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {rows.map((row, i) => (
            <div key={i} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i < rows.length - 1 ? 'border-b border-gray-100' : ''}`}>
              <button
                onClick={() => toggle(i)}
                role="switch"
                aria-checked={row.enabled}
                className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${row.enabled ? 'bg-primary' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${row.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </button>
              <span className={`w-20 text-sm font-medium ${row.enabled ? 'text-gray-900' : 'text-gray-400'}`}>{DAYS[i]}</span>
              {row.enabled ? (
                <div className="flex items-center gap-2 text-sm">
                  <input type="time" value={row.start_time} onChange={(e) => setTime(i, 'start_time', e.target.value)}
                    className="h-9 px-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                  <span className="text-gray-400">até</span>
                  <input type="time" value={row.end_time} onChange={(e) => setTime(i, 'end_time', e.target.value)}
                    className="h-9 px-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
              ) : (
                <span className="text-gray-400 text-sm">Fechado</span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-3">Depois você pode ajustar horários por profissional e cadastrar folgas em Configurações → Horários.</p>

      <ErrorBox msg={error} />
      <Footer onBack={onBack} onContinue={() => save.mutate()} busy={save.isPending} continueLabel="Salvar e continuar" />
    </div>
  )
}

/* ── Passo 5: Agente IA ────────────────────────────────────────── */
const TONES = [
  { value: 'friendly', label: 'Amigável', desc: 'Descontraído e próximo do cliente' },
  { value: 'formal',   label: 'Formal',   desc: 'Profissional e respeitoso' },
  { value: 'casual',   label: 'Casual',   desc: 'Informal e bem-humorado' },
]

function StepAgente({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: config, isLoading } = useQuery({ queryKey: ['agent-config'], queryFn: agentApi.getConfig })
  const [tone, setTone] = useState('friendly')
  const [businessInfo, setBusinessInfo] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!config) return
    setTone(config.tone ?? 'friendly')
    setBusinessInfo(config.business_info ?? '')
  }, [config])

  const save = useMutation({
    mutationFn: () => agentApi.updateConfig({ tone, business_info: businessInfo.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-config'] })
      setError('')
      onNext()
    },
    onError: (e: any) => setError(e.message),
  })

  if (isLoading) return <p className="text-gray-400 text-sm">Carregando...</p>

  return (
    <div>
      <StepHeader step={STEPS[4]} />

      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Tom de voz do agente</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {TONES.map((t) => (
              <button key={t.value} type="button" onClick={() => setTone(t.value)}
                className={`p-4 rounded-xl border-2 text-left transition-colors ${
                  tone === t.value ? 'border-primary bg-primary-light' : 'border-gray-200 hover:border-gray-300'
                }`}>
                <p className={`text-sm font-semibold ${tone === t.value ? 'text-primary' : 'text-gray-900'}`}>{t.label}</p>
                <p className={`text-xs mt-0.5 ${tone === t.value ? 'text-primary/70' : 'text-gray-400'}`}>{t.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Descrição do negócio *</label>
          <p className="text-xs text-gray-400 mb-2">O bot usa esse texto para responder perguntas dos seus clientes. Quanto mais detalhes, melhor.</p>
          <textarea
            value={businessInfo}
            onChange={(e) => setBusinessInfo(e.target.value)}
            rows={5}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            placeholder="Somos uma clínica de estética especializada em procedimentos faciais e corporais. Atendemos com hora marcada..."
          />
        </div>
      </div>

      <ErrorBox msg={error} />
      <Footer onBack={onBack} onContinue={() => save.mutate()} busy={save.isPending} disabled={!businessInfo.trim()} onSkipStep={onNext} />
    </div>
  )
}

/* ── Passo 6: Pagamentos ───────────────────────────────────────── */
function StepPagamentos({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['payment-config'], queryFn: tenantApi.paymentConfig })
  const [accessToken, setAccessToken] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [error, setError] = useState('')

  const save = useMutation({
    mutationFn: () => tenantApi.savePaymentConfig({
      mp_access_token: accessToken || undefined,
      mp_public_key: publicKey || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-config'] })
      setError('')
      onNext()
    },
    onError: (e: any) => setError(e.message),
  })

  const hasInput = Boolean(accessToken.trim() || publicKey.trim())

  return (
    <div>
      <StepHeader step={STEPS[5]} />

      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2.5 h-2.5 rounded-full ${cfg?.configured ? 'bg-green-500' : 'bg-gray-300'}`} />
        <span className="text-sm font-medium text-gray-700">
          {cfg?.configured ? 'Mercado Pago já configurado' : 'Mercado Pago não configurado'}
        </span>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800 mb-4">
        <p className="font-semibold mb-1">Como obter suas credenciais:</p>
        <ol className="list-decimal list-inside space-y-0.5 text-blue-700 text-xs">
          <li>Acesse mercadopago.com.br e faça login</li>
          <li>Vá em Seu negócio → Configurações → Credenciais</li>
          <li>Copie o Access Token e a Public Key de produção</li>
        </ol>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Access Token {cfg?.mp_access_token && <span className="text-xs text-gray-400 font-normal">(atual: {cfg.mp_access_token})</span>}
          </label>
          <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
            className={`${inputCls} font-mono`} placeholder="APP_USR-..." autoComplete="off" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Public Key</label>
          <input type="text" value={publicKey} onChange={(e) => setPublicKey(e.target.value)}
            className={`${inputCls} font-mono`} placeholder="APP_USR-..." autoComplete="off" />
        </div>
      </div>

      <ErrorBox msg={error} />
      <Footer
        onBack={onBack}
        onContinue={() => (hasInput ? save.mutate() : onNext())}
        busy={save.isPending}
        continueLabel={hasInput ? 'Salvar e continuar' : 'Continuar'}
        onSkipStep={hasInput || cfg?.configured ? undefined : onNext}
      />
    </div>
  )
}

/* ── Passo 7: WhatsApp ─────────────────────────────────────────── */
function StepWhatsApp({ onFinish, onBack, finishing }: { onFinish: () => void; onBack: () => void; finishing: boolean }) {
  const qc = useQueryClient()
  const [connecting, setConnecting] = useState(false)

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['whatsapp-status'],
    queryFn: whatsappApi.getStatus,
    refetchInterval: connecting ? 3000 : false,
  })

  const { data: qrData } = useQuery({
    queryKey: ['whatsapp-qr'],
    queryFn: whatsappApi.getQR,
    enabled: status?.status === 'qr_pending',
    refetchInterval: 30_000,
  })

  const connect = useMutation({
    mutationFn: whatsappApi.connect,
    onSuccess: () => { setConnecting(true); refetchStatus() },
  })

  useEffect(() => {
    if (status?.status === 'connected') {
      setConnecting(false)
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] })
    }
  }, [status?.status, qc])

  const isConnected = status?.status === 'connected'
  const isPending = status?.status === 'qr_pending'

  return (
    <div>
      <StepHeader step={STEPS[6]} />

      <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3 mb-4">
        <span className={`w-3 h-3 rounded-full shrink-0 ${isConnected ? 'bg-green-500' : isPending ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'}`} />
        <span className="text-sm font-semibold text-gray-900">
          {isConnected ? 'Conectado' : isPending ? 'Aguardando leitura do QR Code...' : 'Desconectado'}
        </span>
        {isConnected && status?.phone_number && (
          <span className="text-gray-500 text-sm">{status.phone_number}</span>
        )}
      </div>

      {isConnected ? (
        <div className="bg-green-50 border border-green-100 rounded-2xl p-6 text-center space-y-2">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <Check size={24} strokeWidth={2} className="text-green-600" />
          </div>
          <p className="text-green-800 font-semibold">Tudo pronto!</p>
          <p className="text-green-700 text-sm">Seu WhatsApp está conectado e o bot já pode atender seus clientes.</p>
        </div>
      ) : isPending ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-6 text-center space-y-4">
          <p className="text-gray-500 text-sm">
            Abra o WhatsApp no celular do seu negócio → Configurações → Aparelhos conectados → Conectar aparelho
          </p>
          {qrData?.qrcode ? (
            <div className="flex justify-center">
              <img src={qrData.qrcode} alt="QR Code WhatsApp" className="w-52 h-52 rounded-2xl border border-gray-100" />
            </div>
          ) : (
            <div className="flex justify-center items-center w-52 h-52 mx-auto bg-gray-50 rounded-2xl border border-gray-100">
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Gerando QR Code...</p>
              </div>
            </div>
          )}
          <p className="text-gray-400 text-xs">O código expira em 60 segundos e é atualizado automaticamente</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
            {[
              'Clique em "Conectar WhatsApp" abaixo',
              'Escaneie o QR Code com o WhatsApp do seu negócio',
              'Pronto! O bot começa a responder seus clientes automaticamente',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-primary-light flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-primary text-xs font-bold">{i + 1}</span>
                </div>
                <p className="text-gray-700 text-sm">{step}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => connect.mutate()}
            disabled={connect.isPending}
            className="w-full h-12 bg-[#25D366] hover:bg-[#1ebe57] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <MessageCircle size={18} strokeWidth={2} />
            {connect.isPending ? 'Iniciando...' : 'Conectar WhatsApp'}
          </button>
          <p className="text-xs text-gray-400 text-center">Sem o celular por perto? Você pode conectar depois em Configurações → WhatsApp.</p>
        </div>
      )}

      <Footer onBack={onBack} onContinue={onFinish} busy={finishing} continueLabel="Concluir" />
    </div>
  )
}

/* ── Página ────────────────────────────────────────────────────── */
export default function OnboardingPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const [ready, setReady] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const initializedRef = useRef(false)

  useEffect(() => {
    const token = getToken()
    if (!isTenantToken(token)) {
      router.replace('/login')
    } else {
      setReady(true)
    }
  }, [router])

  const { data: onboarding } = useQuery({
    queryKey: ['onboarding'],
    queryFn: tenantApi.onboarding,
    enabled: ready,
  })

  // Position the wizard on the first pending step (once, on load).
  useEffect(() => {
    if (!onboarding || initializedRef.current) return
    initializedRef.current = true
    const firstPending = STEPS.findIndex((s) => !onboarding.steps.find((x) => x.key === s.key)?.done)
    if (firstPending > 0) setStepIndex(firstPending)
  }, [onboarding])

  const finish = useMutation({
    mutationFn: tenantApi.completeOnboarding,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] })
      router.replace('/dashboard')
    },
  })

  function skipAll() {
    sessionStorage.setItem('onboarding_skipped', '1')
    router.replace('/dashboard')
  }

  function goNext() {
    qc.invalidateQueries({ queryKey: ['onboarding'] })
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
    window.scrollTo({ top: 0 })
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0))
    window.scrollTo({ top: 0 })
  }

  if (!ready) return null

  const doneByKey: Record<string, boolean> = {}
  onboarding?.steps.forEach((s) => { doneByKey[s.key] = s.done })
  const doneCount = onboarding?.progress?.done ?? 0
  const total = onboarding?.progress?.total ?? STEPS.length
  const current = STEPS[stepIndex]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col lg:flex-row">
      {/* Sidebar de passos (desktop) */}
      <aside className="hidden lg:flex w-80 bg-sidebar flex-col shrink-0">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <Rocket size={18} strokeWidth={1.75} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Bem-vindo ao AgendaBot!</p>
              <p className="text-gray-400 text-xs mt-0.5">Vamos configurar seu negócio em poucos passos</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {STEPS.map((s, i) => {
            const done = doneByKey[s.key]
            const active = i === stepIndex
            const Icon = s.icon
            return (
              <button
                key={s.key}
                onClick={() => setStepIndex(i)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-left transition-colors ${
                  active ? 'bg-primary text-white' : 'text-gray-400 hover:bg-sidebar-hover hover:text-white'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  done ? 'bg-green-500/20 text-green-400' : active ? 'bg-white/15 text-white' : 'bg-white/5 text-gray-400'
                }`}>
                  {done ? <Check size={13} strokeWidth={2.5} /> : i + 1}
                </span>
                <Icon size={17} strokeWidth={1.75} className="shrink-0" />
                {s.label}
              </button>
            )
          })}
        </nav>
        <div className="p-6 border-t border-white/10">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span>Progresso</span>
            <span>{doneCount}/{total}</span>
          </div>
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${(doneCount / total) * 100}%` }} />
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Barra superior */}
        <header className="flex items-center gap-3 px-4 lg:px-8 h-14 bg-white border-b border-gray-100 shrink-0">
          <div className="lg:hidden flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Rocket size={14} strokeWidth={1.75} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900 truncate">Passo {stepIndex + 1} de {STEPS.length} — {current.label}</span>
          </div>
          <div className="hidden lg:block flex-1" />
          <button onClick={skipAll} className="text-sm text-gray-400 hover:text-gray-600 font-medium transition-colors shrink-0">
            Pular por agora
          </button>
        </header>

        {/* Barra de progresso (mobile) */}
        <div className="lg:hidden h-1 bg-gray-100">
          <div className="h-full bg-primary transition-all" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-8 lg:px-8 lg:py-12">
            {current.key === 'negocio' && <StepNegocio onNext={goNext} />}
            {current.key === 'equipe' && <StepEquipe onNext={goNext} onBack={goBack} />}
            {current.key === 'servicos' && <StepServicos onNext={goNext} onBack={goBack} />}
            {current.key === 'horarios' && <StepHorarios onNext={goNext} onBack={goBack} />}
            {current.key === 'agente' && <StepAgente onNext={goNext} onBack={goBack} />}
            {current.key === 'pagamentos' && <StepPagamentos onNext={goNext} onBack={goBack} />}
            {current.key === 'whatsapp' && (
              <StepWhatsApp onFinish={() => finish.mutate()} onBack={goBack} finishing={finish.isPending} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
