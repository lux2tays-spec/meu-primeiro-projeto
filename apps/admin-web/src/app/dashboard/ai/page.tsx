'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rootApi } from '@/lib/api'

// Mirror of backend aiPricing.MODEL_OPTIONS
const MODEL_OPTIONS = [
  { id: 'claude-sonnet-5',   label: 'Sonnet 5 — recomendado (vende melhor)' },
  { id: 'hybrid',            label: 'Híbrido — Haiku no simples, Sonnet 5 no fechamento' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5 — mais barato' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8 — mais caro' },
]
const SINGLE_MODELS = MODEL_OPTIONS.filter((m) => m.id !== 'hybrid')
const PLANS = [
  { slug: 'free', label: 'Free' },
  { slug: 'basico', label: 'Básico' },
  { slug: 'premium', label: 'Premium' },
  { slug: 'profissional', label: 'Profissional' },
]

const fmtUsd = (n: number) => `$${(n ?? 0).toFixed(2)}`
const fmtBrl = (n: number, rate: number) => `R$ ${((n ?? 0) * rate).toFixed(2)}`
const fmtTok = (n: number) => Number(n ?? 0).toLocaleString('pt-BR')

export default function AIPage() {
  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">IA & Custos</h1>
        <p className="text-gray-500 text-sm mt-1">Escolha o modelo do chatbot e acompanhe tokens e gastos</p>
      </div>
      <ModelConfig />
      <BotConfigPanel />
      <UsageDashboard />
    </div>
  )
}

// ── Bot global config (limites operacionais + regras-base) ───────────────────
const BOT_DEFAULTS = {
  max_tokens: 1024,
  max_tool_turns: 6,
  sender_rate_limit: 40,
  dedup_ttl_seconds: 3600,
  debounce_ms: 7000,
  hybrid_sales_signal: 'agend|marc|hor[aá]ri|pre[cç]o|valor|quero|fech|confirm|dispon|cancel|remarc|reserv|quanto|orç',
  never_reveal_ai: true,
  allow_payment_talk: false,
  max_reply_lines: 4,
  base_extra_instructions: '',
  allow_price_list_default: false,
  collect_last_name_default: true,
  reminder_return_template:
    'Olá, {cliente}! 😊\n\nTudo bem? Notamos que já faz {dias} desde o seu último *{servico}* aqui na *{negocio}*.\n\nQue tal agendar um novo atendimento? Estamos à disposição! 📅\n\nResponda esta mensagem para marcar seu horário. 😊',
  reminder_appointment_template:
    'Oi {cliente}! 😊 Passando pra confirmar seu *{servico}* {quando} às *{hora}* na {negocio}. Está confirmado? Responde *SIM* pra confirmar 👍 ou me chama se precisar remarcar.',
}
type BotCfg = typeof BOT_DEFAULTS

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

function NumField({ label, hint, value, onChange, min = 0 }: { label: string; hint?: string; value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type="number" min={min} value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls} />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
      <span>
        <span className="block text-sm font-medium text-gray-700">{label}</span>
        {hint && <span className="block text-xs text-gray-400 mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

function BotConfigPanel() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const { data: settings, isLoading } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })
  const [cfg, setCfg] = useState<BotCfg>(BOT_DEFAULTS)

  useEffect(() => {
    if (settings?.bot_config) setCfg({ ...BOT_DEFAULTS, ...settings.bot_config })
  }, [settings])

  const set = <K extends keyof BotCfg>(k: K, v: BotCfg[K]) => setCfg((c) => ({ ...c, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => rootApi.updateSettings('bot_config', cfg),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); setSuccess('Configuração do agente salva!'); setTimeout(() => setSuccess(''), 3000) },
  })

  if (isLoading) return null

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-900">Agente — configuração global</h2>
        <p className="text-xs text-gray-500 mt-1">Vale para todos os tenants. Ajuste sem precisar de deploy. Regras que variam por negócio (tabela de preços, coletar sobrenome) têm o padrão aqui e podem ser sobrescritas por cada tenant.</p>
      </div>

      {/* Limites operacionais */}
      <div className="border-t border-gray-100 pt-5">
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Limites operacionais</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumField label="Máx. de tokens por resposta" hint="Tamanho máximo da resposta do bot." value={cfg.max_tokens} min={128} onChange={(n) => set('max_tokens', n)} />
          <NumField label="Máx. de rodadas de ferramenta" hint="Quantas chamadas de ferramenta por mensagem." value={cfg.max_tool_turns} min={1} onChange={(n) => set('max_tool_turns', n)} />
          <NumField label="Limite de msgs/hora por cliente" hint="Anti-abuso: acima disso, descarta em silêncio." value={cfg.sender_rate_limit} min={1} onChange={(n) => set('sender_rate_limit', n)} />
          <NumField label="Janela de dedup (segundos)" hint="Evita processar a mesma mensagem 2x." value={cfg.dedup_ttl_seconds} min={60} onChange={(n) => set('dedup_ttl_seconds', n)} />
          <NumField label="Debounce (ms)" hint="Agrupa mensagens rápidas antes de responder." value={cfg.debounce_ms} min={0} onChange={(n) => set('debounce_ms', n)} />
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Regex de intenção de venda (modo híbrido)</label>
          <input value={cfg.hybrid_sales_signal} onChange={(e) => set('hybrid_sales_signal', e.target.value)} className={inputCls} />
          <p className="text-xs text-gray-400 mt-1">Quando a mensagem casa com este padrão, o modo híbrido usa o modelo de fechamento.</p>
        </div>
      </div>

      {/* Regras-base de comportamento */}
      <div className="border-t border-gray-100 pt-5 space-y-4">
        <h3 className="font-semibold text-gray-900 text-sm">Regras-base de comportamento</h3>
        <Toggle label="Nunca revelar que é uma IA" hint="Faz o bot se apresentar como atendente humano." checked={cfg.never_reveal_ai} onChange={(b) => set('never_reveal_ai', b)} />
        <Toggle label="Pode falar de pagamento" hint="Se desligado, o bot nunca oferece link/PIX/desconto/parcelamento." checked={cfg.allow_payment_talk} onChange={(b) => set('allow_payment_talk', b)} />
        <NumField label="Máx. de linhas por mensagem" hint="Estilo WhatsApp: mensagens curtas." value={cfg.max_reply_lines} min={1} onChange={(n) => set('max_reply_lines', n)} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Instruções-base extras (texto livre)</label>
          <textarea value={cfg.base_extra_instructions} onChange={(e) => set('base_extra_instructions', e.target.value)} rows={4}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Regras adicionais aplicadas a TODOS os tenants..." />
        </div>
      </div>

      {/* Padrões globais dos toggles por-tenant */}
      <div className="border-t border-gray-100 pt-5 space-y-4">
        <h3 className="font-semibold text-gray-900 text-sm">Padrões por-negócio (cada tenant pode sobrescrever)</h3>
        <Toggle label="Pode enviar tabela de preços (padrão)" hint="Padrão para novos tenants — cada um pode mudar na config do agente dele." checked={cfg.allow_price_list_default} onChange={(b) => set('allow_price_list_default', b)} />
        <Toggle label="Coletar sobrenome (padrão)" hint="Padrão para novos tenants." checked={cfg.collect_last_name_default} onChange={(b) => set('collect_last_name_default', b)} />
      </div>

      {/* Templates globais de lembrete */}
      <div className="border-t border-gray-100 pt-5 space-y-4">
        <h3 className="font-semibold text-gray-900 text-sm">Templates de lembrete (global)</h3>
        <p className="text-xs text-gray-500">Variáveis: <code>{'{cliente}'}</code> <code>{'{servico}'}</code> <code>{'{negocio}'}</code> <code>{'{dias}'}</code> (retorno) · <code>{'{quando}'}</code> <code>{'{hora}'}</code> (véspera). Cada tenant pode sobrescrever o texto.</p>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lembrete de retorno (pós-atendimento)</label>
          <textarea value={cfg.reminder_return_template} onChange={(e) => set('reminder_return_template', e.target.value)} rows={4}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Lembrete de agendamento (véspera)</label>
          <textarea value={cfg.reminder_appointment_template} onChange={(e) => set('reminder_appointment_template', e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
          className="h-10 px-5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
          {mutation.isPending ? 'Salvando...' : 'Salvar configuração do agente'}
        </button>
        {success && <span className="text-green-600 text-sm font-medium">{success}</span>}
      </div>
    </div>
  )
}

// ── Model configuration ─────────────────────────────────────────────────────
function ModelConfig() {
  const qc = useQueryClient()
  const [success, setSuccess] = useState('')
  const { data: settings, isLoading } = useQuery({ queryKey: ['root-settings'], queryFn: rootApi.settings })

  const [sel, setSel] = useState('claude-sonnet-5')      // selected mode/model
  const [closing, setClosing] = useState('claude-sonnet-5')
  const [simple, setSimple] = useState('claude-haiku-4-5')
  const [rate, setRate] = useState(6)
  const [caps, setCaps] = useState<Record<string, number>>({})
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('anthropic')
  const [baseUrl, setBaseUrl] = useState('')
  const [transcriptionProvider, setTranscriptionProvider] = useState('')
  const [transcriptionApiKey, setTranscriptionApiKey] = useState('')

  useEffect(() => {
    const cfg = settings?.ai_config
    if (!cfg) return
    if (cfg.mode === 'hybrid') { setSel('hybrid'); setClosing(cfg.model || 'claude-sonnet-5'); setSimple(cfg.model_simple || 'claude-haiku-4-5') }
    else setSel(cfg.model || 'claude-sonnet-5')
    setRate(Number(cfg.usd_brl_rate ?? 6))
    setCaps(cfg.caps ?? {})
    setApiKey(cfg.api_key || '')
    setProvider(cfg.provider || 'anthropic')
    setBaseUrl(cfg.base_url || '')
    setTranscriptionProvider(cfg.transcription_provider || '')
    setTranscriptionApiKey(cfg.transcription_api_key || '')
  }, [settings])

  const mutation = useMutation({
    mutationFn: () => {
      const base = settings?.ai_config ?? {}
      const common = { provider, api_key: apiKey, base_url: baseUrl, usd_brl_rate: rate, caps, transcription_provider: transcriptionProvider, transcription_api_key: transcriptionApiKey }
      const value = sel === 'hybrid'
        ? { ...base, ...common, mode: 'hybrid', model: closing, model_simple: simple }
        : { ...base, ...common, mode: 'single', model: sel }
      return rootApi.updateSettings('ai_config', value)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['root-settings'] }); setSuccess('Configuração salva!'); setTimeout(() => setSuccess(''), 3000) },
  })

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando...</div>

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-5">
      <div>
        <h2 className="font-semibold text-gray-900">Modelo de IA do chatbot</h2>
        <p className="text-xs text-gray-500 mt-1">Aplica-se a todos os tenants. O modo Híbrido usa Haiku em conversas simples e Sonnet 5 quando detecta intenção de compra/agendamento.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Provedor</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}
          className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="custom">Custom / endpoint compatível (via URL base)</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Chave da API</label>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-ant-..."
          className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        <p className="text-xs text-gray-400 mt-1">Usada pelo bot para responder. Se ficar vazia, usa a variável de ambiente do servidor (ANTHROPIC_API_KEY).</p>
      </div>

      {provider === 'custom' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">URL base da API (endpoint compatível)</label>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://seu-proxy.exemplo.com"
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Modelo / Modo</label>
        <select value={sel} onChange={(e) => setSel(e.target.value)}
          className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
          {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>

      {sel === 'hybrid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modelo de fechamento (venda)</label>
            <select value={closing} onChange={(e) => setClosing(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              {SINGLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modelo simples (barato)</label>
            <select value={simple} onChange={(e) => setSimple(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              {SINGLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cotação USD → BRL (para exibir custos)</label>
          <input type="number" step="0.01" value={rate} onChange={(e) => setRate(Number(e.target.value))}
            className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
      </div>

      <div className="border-t border-gray-100 pt-5 space-y-4">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Transcrição de áudio (Whisper)</h3>
          <p className="text-xs text-gray-500 mt-1">Usada quando o plano do tenant tem "Tratamento de áudio e imagem" habilitado.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provedor de transcrição</label>
            <select value={transcriptionProvider} onChange={(e) => setTranscriptionProvider(e.target.value)}
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">Desativado</option>
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chave de API da transcrição</label>
            <input type="password" value={transcriptionApiKey} onChange={(e) => setTranscriptionApiKey(e.target.value)} placeholder="sk-... / gsk_..."
              className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            <p className="text-xs text-gray-400 mt-1">Chave da OpenAI (whisper-1) ou Groq (whisper-large-v3). Necessária para transcrever áudios recebidos.</p>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Teto de custo mensal por plano (USD, 0 = ilimitado)</label>
        <p className="text-xs text-gray-500 mb-2">Quando um tenant ultrapassa o teto no mês, o bot passa a responder com o modelo mais barato (Haiku).</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {PLANS.map((p) => (
            <div key={p.slug}>
              <span className="block text-xs text-gray-500 mb-1">{p.label}</span>
              <input type="number" step="1" min="0" value={caps[p.slug] ?? 0}
                onChange={(e) => setCaps((c) => ({ ...c, [p.slug]: Number(e.target.value) }))}
                className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
          className="h-10 px-5 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50">
          {mutation.isPending ? 'Salvando...' : 'Salvar configuração'}
        </button>
        {success && <span className="text-green-600 text-sm font-medium">{success}</span>}
      </div>
    </div>
  )
}

// ── Usage dashboard ─────────────────────────────────────────────────────────
function UsageDashboard() {
  const [days, setDays] = useState(30)
  const { data, isLoading, isError } = useQuery({ queryKey: ['ai-usage', days], queryFn: () => rootApi.aiUsage(days) })

  if (isLoading) return <div className="text-gray-400 text-sm">Carregando uso...</div>
  if (isError) return <div className="text-red-500 text-sm">Erro ao carregar o uso de IA.</div>

  const rate = data.usd_brl_rate ?? 6
  const t = data.totals ?? { cost: 0, tokens: 0, calls: 0 }
  const maxDay = Math.max(1, ...(data.by_day ?? []).map((d: any) => d.cost))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-900">Uso & custos de IA</h2>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1 rounded-md text-xs font-medium ${days === d ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {data.pending_migration && (
        <div className="bg-yellow-50 text-yellow-700 rounded-xl px-4 py-3 text-sm">
          A tabela de telemetria ainda não foi criada (migração 014 será aplicada no próximo deploy). Os dados começarão a aparecer depois disso.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={`Custo (${days}d)`} value={fmtUsd(t.cost)} sub={fmtBrl(t.cost, rate)} />
        <Kpi label="Custo mês atual" value={fmtUsd(data.month_cost)} sub={fmtBrl(data.month_cost, rate)} />
        <Kpi label={`Tokens (${days}d)`} value={fmtTok(t.tokens)} />
        <Kpi label={`Mensagens (${days}d)`} value={fmtTok(t.calls)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* By model */}
        <Card title="Por modelo">
          <Table
            head={['Modelo', 'Custo', 'Tokens', 'Chamadas']}
            rows={(data.by_model ?? []).map((m: any) => [m.model, fmtUsd(m.cost), fmtTok(m.tokens), fmtTok(m.calls)])}
            empty="Sem dados no período."
          />
        </Card>

        {/* By day */}
        <Card title="Custo por dia">
          {(data.by_day ?? []).length === 0
            ? <p className="text-sm text-gray-400">Sem dados no período.</p>
            : (
              <div className="space-y-1.5 max-h-64 overflow-auto pr-1">
                {(data.by_day ?? []).slice().reverse().map((d: any) => (
                  <div key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-gray-500 shrink-0">{d.day.slice(5)}</span>
                    <div className="flex-1 bg-gray-100 rounded h-3 overflow-hidden">
                      <div className="bg-primary h-full rounded" style={{ width: `${(d.cost / maxDay) * 100}%` }} />
                    </div>
                    <span className="w-16 text-right text-gray-700 shrink-0">{fmtUsd(d.cost)}</span>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>

      {/* By tenant */}
      <Card title="Por tenant (maiores gastos)">
        <Table
          head={['Tenant', 'Custo (USD)', 'Custo (BRL)', 'Tokens', 'Mensagens']}
          rows={(data.by_tenant ?? []).map((tn: any) => [tn.tenant, fmtUsd(tn.cost), fmtBrl(tn.cost, rate), fmtTok(tn.tokens), fmtTok(tn.calls)])}
          empty="Sem dados no período."
        />
      </Card>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="font-semibold text-gray-900 text-sm mb-3">{title}</h3>
      {children}
    </div>
  )
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-gray-400">{empty}</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-100">
            {head.map((h) => <th key={h} className="py-2 pr-4 font-medium text-xs">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0">
              {r.map((c, j) => <td key={j} className="py-2 pr-4 text-gray-700">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
