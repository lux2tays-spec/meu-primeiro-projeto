'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentApi } from '@/lib/api'

const TONES = [
  { value: 'friendly', label: '😊 Amigável', desc: 'Descontraído e próximo do cliente' },
  { value: 'formal',   label: '👔 Formal',   desc: 'Profissional e respeitoso' },
  { value: 'casual',   label: '🤙 Casual',   desc: 'Informal e bem-humorado' },
]

const BUSINESS_TYPES = [
  'Clínica de Estética', 'Salão de Beleza', 'Barbearia', 'Pet Shop', 'Clínica Odontológica',
  'Clínica Médica', 'Consultório de Psicologia', 'Academia', 'Estúdio de Pilates',
  'Estúdio de Tatuagem', 'Nail Designer', 'Massoterapia', 'Fisioterapia', 'Nutrição',
  'Outro',
]

const TABS = ['Identidade', 'Comportamento', 'Catálogos'] as const
type Tab = typeof TABS[number]

const BLANK = {
  business_info: '', business_type: '', address: '', neighborhood: '', city: '', state: '',
  instagram_url: '', google_maps_url: '', website_url: '', whatsapp_number: '',
  tone: 'friendly', custom_instructions: '', system_prompt: '', return_reminder_days: 30,
  catalog_files: [] as { name: string; url: string }[],
  language: 'pt-BR',
}

export default function AgentPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Identidade')
  const [form, setForm] = useState(BLANK)
  const [saved, setSaved] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: config, isLoading } = useQuery({ queryKey: ['agent-config'], queryFn: agentApi.getConfig })

  useEffect(() => {
    if (!config) return
    setForm({
      business_info:        config.business_info ?? '',
      business_type:        config.business_type ?? '',
      address:              config.address ?? '',
      neighborhood:         config.neighborhood ?? '',
      city:                 config.city ?? '',
      state:                config.state ?? '',
      instagram_url:        config.instagram_url ?? '',
      google_maps_url:      config.google_maps_url ?? '',
      website_url:          config.website_url ?? '',
      whatsapp_number:      config.whatsapp_number ?? '',
      tone:                 config.tone ?? 'friendly',
      custom_instructions:  config.custom_instructions ?? '',
      system_prompt:        config.system_prompt ?? '',
      return_reminder_days: config.return_reminder_days ?? 30,
      catalog_files:        config.catalog_files ?? [],
      language:             config.language ?? 'pt-BR',
    })
  }, [config])

  const set = (key: keyof typeof BLANK, val: any) => setForm((f) => ({ ...f, [key]: val }))

  const saveMutation = useMutation({
    mutationFn: () => agentApi.updateConfig(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => agentApi.uploadCatalog(file),
    onSuccess: (uploaded) => {
      const next = [...form.catalog_files, uploaded]
      set('catalog_files', next)
      saveMutation.mutate()
      setUploadErr('')
    },
    onError: (e: any) => setUploadErr(e.message),
  })

  const removeCatalog = (url: string) => {
    const next = form.catalog_files.filter((f) => f.url !== url)
    set('catalog_files', next)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    uploadMutation.mutate(file)
  }

  if (isLoading) return <div className="text-gray-400 text-sm p-8">Carregando...</div>

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Configuração do Agente IA</h1>
        <p className="text-sm text-gray-500 mt-1">Configure como o assistente virtual se comporta no WhatsApp</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm space-y-5">
        {/* ── IDENTIDADE ── */}
        {tab === 'Identidade' && (
          <>
            <Field label="Tipo de negócio">
              <select
                value={form.business_type}
                onChange={(e) => set('business_type', e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                <option value="">Selecione o tipo de negócio...</option>
                {BUSINESS_TYPES.map((bt) => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            </Field>

            <Field label="Descrição do negócio" hint="O bot usará isso para responder perguntas dos clientes">
              <textarea
                value={form.business_info}
                onChange={(e) => set('business_info', e.target.value)}
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Somos uma clínica de estética especializada em procedimentos faciais e corporais. Atendemos com hora marcada..."
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Endereço">
                <input value={form.address} onChange={(e) => set('address', e.target.value)}
                  placeholder="Rua, número" className={inputCls} />
              </Field>
              <Field label="Bairro">
                <input value={form.neighborhood} onChange={(e) => set('neighborhood', e.target.value)}
                  placeholder="Bairro" className={inputCls} />
              </Field>
              <Field label="Cidade">
                <input value={form.city} onChange={(e) => set('city', e.target.value)}
                  placeholder="Cidade" className={inputCls} />
              </Field>
              <Field label="Estado">
                <input value={form.state} onChange={(e) => set('state', e.target.value)}
                  placeholder="SP" maxLength={2} className={inputCls} />
              </Field>
            </div>

            <Field label="WhatsApp do negócio" hint="Número exibido ao cliente quando necessário">
              <input value={form.whatsapp_number} onChange={(e) => set('whatsapp_number', e.target.value)}
                placeholder="(11) 99999-9999" className={inputCls} />
            </Field>

            <Field label="Instagram">
              <input value={form.instagram_url} onChange={(e) => set('instagram_url', e.target.value)}
                placeholder="https://instagram.com/seunegocio" className={inputCls} />
            </Field>

            <Field label="Google Maps">
              <input value={form.google_maps_url} onChange={(e) => set('google_maps_url', e.target.value)}
                placeholder="https://maps.google.com/..." className={inputCls} />
            </Field>

            <Field label="Website">
              <input value={form.website_url} onChange={(e) => set('website_url', e.target.value)}
                placeholder="https://seunegocio.com.br" className={inputCls} />
            </Field>
          </>
        )}

        {/* ── COMPORTAMENTO ── */}
        {tab === 'Comportamento' && (
          <>
            <Field label="Tom de voz do agente">
              <div className="grid grid-cols-3 gap-3">
                {TONES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('tone', t.value)}
                    className={`p-4 rounded-xl border-2 text-left transition-colors ${
                      form.tone === t.value
                        ? 'border-primary bg-primary-light'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${form.tone === t.value ? 'text-primary' : 'text-gray-900'}`}>
                      {t.label}
                    </p>
                    <p className={`text-xs mt-0.5 ${form.tone === t.value ? 'text-primary/70' : 'text-gray-400'}`}>
                      {t.desc}
                    </p>
                  </button>
                ))}
              </div>
            </Field>

            <Field
              label="Instruções detalhadas para a IA"
              hint="Descreva como o agente deve se comportar, o que pode e não pode dizer, como fechar uma venda, etc."
            >
              <textarea
                value={form.custom_instructions}
                onChange={(e) => set('custom_instructions', e.target.value)}
                rows={7}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Ex: Sempre perguntar o nome do cliente antes de agendar. Ao citar preços, oferecer sempre o parcelamento no cartão. Nunca mencionar concorrentes. Ao final de cada conversa, perguntar se há mais alguma dúvida..."
              />
            </Field>

            <Field label="Instruções adicionais (prompt técnico)" hint="Regras avançadas para usuários experientes">
              <textarea
                value={form.system_prompt}
                onChange={(e) => set('system_prompt', e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Parâmetros técnicos ou regras específicas..."
              />
            </Field>

            <Field
              label="Lembrete de retorno (dias)"
              hint="Após quantos dias sem visita o agente deve sugerir ao cliente um novo agendamento"
            >
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.return_reminder_days}
                  onChange={(e) => set('return_reminder_days', Number(e.target.value))}
                  className="w-24 h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary text-center"
                />
                <span className="text-sm text-gray-500">dias</span>
              </div>
            </Field>
          </>
        )}

        {/* ── CATÁLOGOS ── */}
        {tab === 'Catálogos' && (
          <>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-800 mb-1">📄 Catálogos e materiais do negócio</p>
              <p className="text-sm text-blue-700">
                Faça upload de PDFs ou imagens com cardápios, tabelas de preços, fotos de procedimentos ou qualquer
                material que a IA possa mencionar durante as conversas.
              </p>
            </div>

            {uploadErr && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{uploadErr}</p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="w-full h-12 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              {uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo (PDF, JPG, PNG — máx. 10 MB)'}
            </button>

            {form.catalog_files.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Nenhum arquivo enviado ainda</p>
            ) : (
              <div className="space-y-2">
                {form.catalog_files.map((f) => (
                  <div key={f.url} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{f.name.endsWith('.pdf') ? '📄' : '🖼️'}</span>
                      <span className="text-sm font-medium text-gray-800 truncate max-w-xs">{f.name}</span>
                    </div>
                    <button
                      onClick={() => removeCatalog(f.url)}
                      className="text-xs text-red-400 hover:text-red-600 font-medium ml-4"
                    >
                      Remover
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">
            {(saveMutation.error as any)?.message}
          </p>
        )}

        {tab !== 'Catálogos' && (
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar configurações'}
          </button>
        )}
      </div>
    </div>
  )
}

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      {children}
    </div>
  )
}
