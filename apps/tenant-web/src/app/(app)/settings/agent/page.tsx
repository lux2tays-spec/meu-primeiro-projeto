'use client'
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { agentApi, tenantApi, friendlyMessage } from '@/lib/api'
import Loading from '@/components/ui/Loading'

const TONES = [
  { value: 'friendly', label: '😊 Amigável', desc: 'Descontraído e próximo do cliente' },
  { value: 'formal',   label: '👔 Formal',   desc: 'Profissional e respeitoso' },
  { value: 'casual',   label: '🤙 Casual',   desc: 'Informal e bem-humorado' },
]

const TABS = ['Identidade', 'Comportamento', 'Catálogos'] as const
type Tab = typeof TABS[number]

const BLANK = {
  business_info: '', business_type: '', address: '', neighborhood: '', city: '', state: '',
  instagram_url: '', google_maps_url: '', website_url: '', whatsapp_number: '',
  tone: 'friendly', custom_instructions: '', system_prompt: '',
  appointment_reminders_enabled: true, reminder1_minutes: 180, reminder2_minutes: 30,
  // Tri-state ('inherit' = usar padrão global do Root Admin).
  allow_price_list: 'inherit' as 'inherit' | 'on' | 'off',
  collect_last_name: 'inherit' as 'inherit' | 'on' | 'off',
  allow_payment_talk: 'inherit' as 'inherit' | 'on' | 'off',
  reminder_return_template: '',
  reminder_appointment_template: '',
  birthday_reminder_enabled: false,
  birthday_reminder_days_before: 0,
  birthday_reminder_message: '',
  catalog_files: [] as { name: string; url: string }[],
  language: 'pt-BR',
  handoff_enabled: true,
  handoff_pause_on_owner_reply: true,
  handoff_timeout_min: 30,
  handoff_offer_message: '',
  handoff_button_label: '',
  handoff_ack_message: '',
  handoff_resume_message: '',
  handoff_owner_resume_keyword: '',
}

export default function AgentPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('Identidade')
  const [form, setForm] = useState(BLANK)
  const [saved, setSaved] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: config, isLoading } = useQuery({ queryKey: ['agent-config'], queryFn: agentApi.getConfig })

  // CFG-17: tipos de negócio vêm do backend (fonte única, mesma lista do onboarding
  // e do app mobile) — nada de lista hardcoded divergente.
  const { data: btTemplates = [] } = useQuery({
    queryKey: ['business-type-templates'],
    queryFn: tenantApi.businessTypeTemplates,
  })
  const businessTypes = btTemplates.map((t) => ({ value: t.business_type, label: t.display_name }))
  // Valor legado (salvo antes da lista dinâmica) continua visível até o usuário trocar.
  const legacyBusinessType = !!form.business_type && !businessTypes.some((t) => t.value === form.business_type)

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
      appointment_reminders_enabled: config.appointment_reminders_enabled ?? true,
      reminder1_minutes:    config.reminder1_minutes ?? 180,
      reminder2_minutes:    config.reminder2_minutes ?? 30,
      allow_price_list:     config.allow_price_list == null ? 'inherit' : (config.allow_price_list ? 'on' : 'off'),
      collect_last_name:    config.collect_last_name == null ? 'inherit' : (config.collect_last_name ? 'on' : 'off'),
      allow_payment_talk:   config.allow_payment_talk == null ? 'inherit' : (config.allow_payment_talk ? 'on' : 'off'),
      reminder_return_template:      config.reminder_return_template ?? '',
      reminder_appointment_template: config.reminder_appointment_template ?? '',
      birthday_reminder_enabled:     config.birthday_reminder_enabled ?? false,
      birthday_reminder_days_before: config.birthday_reminder_days_before ?? 0,
      birthday_reminder_message:     config.birthday_reminder_message ?? '',
      catalog_files:        config.catalog_files ?? [],
      language:             config.language ?? 'pt-BR',
      handoff_enabled:              config.handoff_enabled ?? true,
      handoff_pause_on_owner_reply: config.handoff_pause_on_owner_reply ?? true,
      handoff_timeout_min:          config.handoff_timeout_min ?? 30,
      handoff_offer_message:        config.handoff_offer_message ?? '',
      handoff_button_label:         config.handoff_button_label ?? '',
      handoff_ack_message:          config.handoff_ack_message ?? '',
      handoff_resume_message:       config.handoff_resume_message ?? '',
      handoff_owner_resume_keyword: config.handoff_owner_resume_keyword ?? '',
    })
  }, [config])

  const set = (key: keyof typeof BLANK, val: any) => setForm((f) => ({ ...f, [key]: val }))

  // Convert tri-state selects → null/true/false and empty templates → null
  // (null means "inherit the global default from bot_config").
  const toPayload = (f: typeof BLANK) => {
    const triState = (v: 'inherit' | 'on' | 'off') => (v === 'inherit' ? null : v === 'on')
    return {
      ...f,
      allow_price_list: triState(f.allow_price_list),
      collect_last_name: triState(f.collect_last_name),
      allow_payment_talk: triState(f.allow_payment_talk),
      reminder_return_template: f.reminder_return_template.trim() || null,
      reminder_appointment_template: f.reminder_appointment_template.trim() || null,
      birthday_reminder_message: f.birthday_reminder_message.trim() || null,
    }
  }

  // CFG-3: a mutation recebe o payload EXPLÍCITO (sem stale closure sobre `form`)
  // — quem chama monta o payload a partir do estado mais recente.
  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) => agentApi.updateConfig(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-config'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => agentApi.uploadCatalog(file),
    onSuccess: (uploaded) => {
      // CFG-3: persiste com o payload já incluindo o arquivo recém-enviado.
      const nextForm = { ...form, catalog_files: [...form.catalog_files, uploaded] }
      setForm(nextForm)
      saveMutation.mutate(toPayload(nextForm))
      setUploadErr('')
    },
    onError: (e: any) => setUploadErr(friendlyMessage(e, 'Não foi possível enviar o arquivo. Tente novamente.')),
  })

  // CFG-4: remover catálogo PERSISTE imediatamente (não só no estado local).
  const removeCatalog = (url: string) => {
    const nextForm = { ...form, catalog_files: form.catalog_files.filter((f) => f.url !== url) }
    setForm(nextForm)
    saveMutation.mutate(toPayload(nextForm))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    uploadMutation.mutate(file)
  }

  if (isLoading) return <Loading card />

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
                {legacyBusinessType && <option value={form.business_type}>{form.business_type}</option>}
                {businessTypes.map((bt) => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

            {/* ── Lembretes de agendamento ── */}
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Lembretes de agendamento</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Envia até 2 mensagens no WhatsApp antes do horário pedindo a confirmação do cliente
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.appointment_reminders_enabled}
                  onClick={() => set('appointment_reminders_enabled', !form.appointment_reminders_enabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                    form.appointment_reminders_enabled ? 'bg-primary' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      form.appointment_reminders_enabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>

              {form.appointment_reminders_enabled && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="1º lembrete (minutos antes)" hint="Ex.: 180 = 3 horas antes">
                    <input
                      type="number"
                      min={0}
                      value={form.reminder1_minutes}
                      onChange={(e) => set('reminder1_minutes', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="2º lembrete (minutos antes)" hint="Ex.: 30 = meia hora antes">
                    <input
                      type="number"
                      min={0}
                      value={form.reminder2_minutes}
                      onChange={(e) => set('reminder2_minutes', Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                      className={inputCls}
                    />
                  </Field>
                </div>
              )}
            </div>

            {/* ── Lembrete de aniversário (prospecção) ── */}
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Lembrete de aniversário</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    O bot envia parabéns no WhatsApp e convida a agendar — ótimo para trazer o cliente de volta.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.birthday_reminder_enabled}
                  onClick={() => set('birthday_reminder_enabled', !form.birthday_reminder_enabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${form.birthday_reminder_enabled ? 'bg-primary' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.birthday_reminder_enabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {form.birthday_reminder_enabled && (
                <div className="space-y-4">
                  <Field label="Enviar quantos dias antes" hint="0 = no próprio dia. Ex.: 3 = três dias antes.">
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={form.birthday_reminder_days_before}
                      onChange={(e) => set('birthday_reminder_days_before', Math.max(0, Math.min(60, Math.floor(Number(e.target.value) || 0))))}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Mensagem" hint="Use {cliente} e {negocio}. Deixe vazio para o texto padrão.">
                    <textarea
                      rows={4}
                      value={form.birthday_reminder_message}
                      onChange={(e) => set('birthday_reminder_message', e.target.value)}
                      placeholder="Olá {cliente}! 🎉 A equipe do {negocio} deseja um feliz aniversário! Que tal comemorar com a gente? Responda para agendar. 🎁"
                      className={`${inputCls} h-auto py-2 resize-none`}
                    />
                  </Field>
                </div>
              )}
            </div>

            {/* ── Regras do agente (deste negócio) ── */}
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Regras do agente</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Ajustes específicos deste negócio. "Herdar padrão" usa a configuração global da plataforma.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Enviar tabela de preços" hint="Se o bot pode mandar a lista completa de serviços/preços quando o cliente pedir.">
                  <select value={form.allow_price_list} onChange={(e) => set('allow_price_list', e.target.value)} className={inputCls}>
                    <option value="inherit">Herdar padrão da plataforma</option>
                    <option value="on">Sim, pode enviar</option>
                    <option value="off">Não enviar</option>
                  </select>
                </Field>
                <Field label="Coletar sobrenome do cliente" hint="Se o bot deve perguntar e salvar o sobrenome nas conversas.">
                  <select value={form.collect_last_name} onChange={(e) => set('collect_last_name', e.target.value)} className={inputCls}>
                    <option value="inherit">Herdar padrão da plataforma</option>
                    <option value="on">Sim, coletar</option>
                    <option value="off">Não coletar</option>
                  </select>
                </Field>
                <Field label="Falar sobre pagamento" hint="Se o bot pode oferecer link de pagamento, PIX, desconto e parcelamento (conforme suas instruções). 'Sim' libera mesmo que o padrão da plataforma esteja desligado.">
                  <select value={form.allow_payment_talk} onChange={(e) => set('allow_payment_talk', e.target.value)} className={inputCls}>
                    <option value="inherit">Herdar padrão da plataforma</option>
                    <option value="on">Sim, pode falar</option>
                    <option value="off">Não falar</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* ── Textos de lembrete (override deste negócio) ── */}
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Textos dos lembretes</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Deixe em branco para usar o texto padrão da plataforma. Variáveis: <code>{'{cliente}'}</code> <code>{'{servico}'}</code> <code>{'{negocio}'}</code> <code>{'{dias}'}</code> (retorno) · <code>{'{quando}'}</code> <code>{'{hora}'}</code> (véspera).
                </p>
              </div>
              <Field label="Lembrete de retorno (pós-atendimento)">
                <textarea
                  value={form.reminder_return_template}
                  onChange={(e) => set('reminder_return_template', e.target.value)}
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="(usando o texto padrão da plataforma)"
                />
              </Field>
              <Field label="Lembrete de agendamento (véspera)">
                <textarea
                  value={form.reminder_appointment_template}
                  onChange={(e) => set('reminder_appointment_template', e.target.value)}
                  rows={3}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="(usando o texto padrão da plataforma)"
                />
              </Field>
            </div>

            {/* ── Atendimento humano ── */}
            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Atendimento humano</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Controle como o bot passa a conversa para um humano e quando volta a atender.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Atendimento humano ativado</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Quando ligado, o bot pausa se um humano assumir e volta sozinho depois.
                  </p>
                </div>
                <Toggle
                  checked={form.handoff_enabled}
                  onChange={() => set('handoff_enabled', !form.handoff_enabled)}
                />
              </div>

              {form.handoff_enabled && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Pausar o bot quando eu responder</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Se você responder o cliente pelo seu próprio WhatsApp, o bot para de responder automaticamente.
                      </p>
                    </div>
                    <Toggle
                      checked={form.handoff_pause_on_owner_reply}
                      onChange={() => set('handoff_pause_on_owner_reply', !form.handoff_pause_on_owner_reply)}
                    />
                  </div>

                  <Field label="Tempo de retorno do bot (min)" hint="Minutos sem resposta do humano até o bot voltar a atender sozinho.">
                    <input
                      type="number"
                      min={1}
                      value={form.handoff_timeout_min}
                      onChange={(e) => set('handoff_timeout_min', Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Frase de ativação (pergunta do bot)" hint="Pergunta que o bot envia quando não consegue resolver, oferecendo um especialista.">
                    <input
                      value={form.handoff_offer_message}
                      onChange={(e) => set('handoff_offer_message', e.target.value)}
                      placeholder="Quer que eu encaminhe para um especialista?"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Texto do botão" hint="O que o cliente toca/responde para pedir um humano.">
                    <input
                      value={form.handoff_button_label}
                      onChange={(e) => set('handoff_button_label', e.target.value)}
                      placeholder="Quero ajuda de um especialista"
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Confirmação ao cliente" hint="Mensagem enviada ao cliente logo depois que ele pede o especialista.">
                    <textarea
                      value={form.handoff_ack_message}
                      onChange={(e) => set('handoff_ack_message', e.target.value)}
                      rows={3}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      placeholder="Perfeito! Já avisei a equipe 🙌 Em breve um especialista continua seu atendimento por aqui."
                    />
                  </Field>

                  <Field label="Mensagem de retorno (opcional)" hint="Enviada quando o bot volta a atender após o tempo. Deixe vazio para voltar sem avisar.">
                    <input
                      value={form.handoff_resume_message}
                      onChange={(e) => set('handoff_resume_message', e.target.value)}
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Palavra para devolver ao bot (opcional)" hint="Digite essa palavra no chat para devolver o atendimento ao bot na hora. Deixe vazio para desativar.">
                    <input
                      value={form.handoff_owner_resume_keyword}
                      onChange={(e) => set('handoff_owner_resume_keyword', e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                </>
              )}
            </div>
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

        {/* UI-2: nunca renderizar o objeto de erro cru — sempre mensagem amigável */}
        {saveMutation.isError && (
          <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">
            {friendlyMessage(saveMutation.error, 'Não foi possível salvar as configurações. Verifique os campos e tente novamente.')}
          </p>
        )}

        {/* CFG-4: o botão Salvar aparece em TODAS as abas, inclusive Catálogos */}
        <button
          onClick={() => saveMutation.mutate(toPayload(form))}
          disabled={saveMutation.isPending}
          className="w-full h-11 bg-primary hover:bg-primary-dark text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Salvando...' : saved ? '✓ Salvo!' : 'Salvar configurações'}
        </button>
      </div>
    </div>
  )
}

const inputCls = 'w-full h-10 px-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-primary' : 'bg-gray-200'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-400 mb-2">{hint}</p>}
      {children}
    </div>
  )
}
