import { useState, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert,
  KeyboardAvoidingView, Platform, Image, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Redirect, router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { tenantApi, agentApi, whatsappApi, hoursApi, paymentConfigApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { onboardingSession } from '@/lib/onboarding-session'
import { colors, font, spacing, radius } from '@/lib/theme'

type StepKey = 'negocio' | 'equipe' | 'servicos' | 'horarios' | 'agente' | 'pagamentos' | 'whatsapp'
type IoniconName = keyof typeof Ionicons.glyphMap

const STEPS: { key: StepKey; label: string; icon: IoniconName; why: string }[] = [
  { key: 'negocio',    label: 'Negócio',    icon: 'business-outline',  why: 'Conte quem você é — o bot se apresenta com esses dados.' },
  { key: 'equipe',     label: 'Equipe',     icon: 'people-outline',    why: 'Cadastre quem atende: cada serviço é feito por um profissional.' },
  { key: 'servicos',   label: 'Serviços',   icon: 'pricetag-outline',  why: 'O bot só agenda serviços que você cadastrar aqui.' },
  { key: 'horarios',   label: 'Horários',   icon: 'time-outline',      why: 'O bot só oferece horários dentro do seu funcionamento.' },
  { key: 'agente',     label: 'Agente IA',  icon: 'sparkles-outline',  why: 'Defina o tom e o contexto que a IA usa para responder seus clientes.' },
  { key: 'pagamentos', label: 'Pagamentos', icon: 'card-outline',      why: 'Opcional: conecte o Mercado Pago para cobrar pelo WhatsApp.' },
  { key: 'whatsapp',   label: 'WhatsApp',   icon: 'logo-whatsapp',     why: 'Conecte seu número e o bot começa a atender na hora.' },
]

function showError(err: any) {
  Alert.alert('Erro', err?.message ?? 'Algo deu errado. Tente novamente.')
}

/* ── Cabeçalho de cada passo ───────────────────────────────────── */
function StepHeader({ step }: { step: typeof STEPS[number] }) {
  return (
    <View style={s.stepHeader}>
      <View style={s.stepHeaderRow}>
        <View style={s.stepHeaderIcon}>
          <Ionicons name={step.icon} size={20} color={colors.primary} />
        </View>
        <Text style={s.stepHeaderTitle}>{step.label}</Text>
      </View>
      <Text style={s.stepHeaderWhy}>{step.why}</Text>
    </View>
  )
}

/* ── Rodapé compartilhado (Voltar / Pular etapa / Continuar) ───── */
function Footer({ onBack, onContinue, continueLabel = 'Continuar', busy = false, disabled = false, onSkipStep, skipLabel = 'Pular esta etapa' }: {
  onBack?: () => void
  onContinue: () => void
  continueLabel?: string
  busy?: boolean
  disabled?: boolean
  onSkipStep?: () => void
  skipLabel?: string
}) {
  return (
    <View style={s.footer}>
      <Button
        label={busy ? 'Salvando...' : continueLabel}
        onPress={onContinue}
        loading={busy}
        disabled={disabled}
      />
      <View style={s.footerRow}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.footerLink} disabled={busy}>
            <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
            <Text style={s.footerLinkText}>Voltar</Text>
          </TouchableOpacity>
        ) : <View />}
        {onSkipStep ? (
          <TouchableOpacity onPress={onSkipStep} style={s.footerLink} disabled={busy}>
            <Text style={s.footerLinkText}>{skipLabel}</Text>
          </TouchableOpacity>
        ) : <View />}
      </View>
    </View>
  )
}

/* ── Passo 1: Negócio ──────────────────────────────────────────── */
function StepNegocio({ onNext }: { onNext: () => void }) {
  const qc = useQueryClient()
  const { data: tenant, isLoading } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: templates = [] } = useQuery({
    queryKey: ['business-type-templates'],
    queryFn: tenantApi.businessTypeTemplates,
  })

  const [form, setForm] = useState({ name: '', contact_email: '', contact_phone: '', responsible_name: '' })
  const [businessType, setBusinessType] = useState('')

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
      onNext()
    },
    onError: showError,
  })

  if (isLoading) return <ActivityIndicator color={colors.primary} style={s.loading} />

  return (
    <View style={s.stepBody}>
      <StepHeader step={STEPS[0]} />

      {templates.length > 0 && (
        <View style={s.field}>
          <Text style={s.label}>Tipo de negócio</Text>
          <Text style={s.hint}>Escolha um modelo e já preparamos sugestões para o seu segmento.</Text>
          <View style={s.chipsWrap}>
            {templates.map((t) => {
              const selected = businessType === t.business_type
              return (
                <TouchableOpacity
                  key={t.business_type}
                  onPress={() => setBusinessType((cur) => (cur === t.business_type ? '' : t.business_type))}
                  style={[s.chip, selected && s.chipActive]}
                >
                  <Text style={[s.chipText, selected && s.chipTextActive]}>{t.display_name}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}

      <Input
        label="Nome do negócio *"
        value={form.name}
        onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
        placeholder="Minha Empresa"
      />
      <Input
        label="E-mail de contato"
        value={form.contact_email}
        onChangeText={(v) => setForm((f) => ({ ...f, contact_email: v }))}
        placeholder="contato@empresa.com"
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Input
        label="Telefone"
        value={form.contact_phone}
        onChangeText={(v) => setForm((f) => ({ ...f, contact_phone: v }))}
        placeholder="(11) 99999-9999"
        keyboardType="phone-pad"
      />
      <Input
        label="Nome do responsável"
        value={form.responsible_name}
        onChangeText={(v) => setForm((f) => ({ ...f, responsible_name: v }))}
        placeholder="Maria Silva"
      />

      <Footer onContinue={() => save.mutate()} busy={save.isPending} disabled={!form.name.trim()} />
    </View>
  )
}

/* ── Passo 2: Equipe ───────────────────────────────────────────── */
function StepEquipe({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: professionals = [], isLoading } = useQuery({
    queryKey: ['professionals'],
    queryFn: tenantApi.professionals,
  })
  const [form, setForm] = useState({ name: '', phone: '', bio: '' })

  const add = useMutation({
    mutationFn: () =>
      tenantApi.addProfessional({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        bio: form.bio.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['professionals'] })
      setForm({ name: '', phone: '', bio: '' })
    },
    onError: showError,
  })

  const remove = useMutation({
    mutationFn: (id: string) => tenantApi.removeProfessional(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['professionals'] }),
    onError: showError,
  })

  return (
    <View style={s.stepBody}>
      <StepHeader step={STEPS[1]} />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : (professionals as any[]).length === 0 ? (
        <Card style={s.emptyCard}>
          <Text style={s.emptyText}>
            Nenhum profissional ainda. Cadastre ao menos um — no próximo passo você vai escolher quais
            serviços cada um realiza.
          </Text>
        </Card>
      ) : (
        <View style={s.listGap}>
          {(professionals as any[]).map((p) => (
            <Card key={p.id} style={s.itemRow}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{p.name?.[0]?.toUpperCase() ?? 'P'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle} numberOfLines={1}>{p.name}</Text>
                {p.phone ? <Text style={s.itemMeta}>{p.phone}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => remove.mutate(p.id)} disabled={remove.isPending} style={s.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            </Card>
          ))}
        </View>
      )}

      <Card style={s.formCard}>
        <Text style={s.formCardTitle}>Adicionar profissional</Text>
        <Input value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Nome *" />
        <Input
          value={form.phone}
          onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
          placeholder="Telefone (opcional)"
          keyboardType="phone-pad"
        />
        <Input value={form.bio} onChangeText={(v) => setForm((f) => ({ ...f, bio: v }))} placeholder="Especialidade / bio (opcional)" />
        <Button
          label={add.isPending ? 'Adicionando...' : '+ Adicionar'}
          onPress={() => form.name.trim() && add.mutate()}
          loading={add.isPending}
          disabled={!form.name.trim()}
          variant="outline"
        />
      </Card>

      <Footer onBack={onBack} onContinue={onNext} />
    </View>
  )
}

/* ── Passo 3: Serviços ─────────────────────────────────────────── */
const BLANK_SERVICE = { name: '', price: '', duration_minutes: '60', reminder_days: '', professional_ids: [] as string[] }

function StepServicos({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: services = [], isLoading } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  const [form, setForm] = useState(BLANK_SERVICE)

  const add = useMutation({
    mutationFn: () => {
      const price = parseFloat(form.price.replace(',', '.'))
      const duration = Math.max(1, Math.floor(Number(form.duration_minutes) || 0))
      if (isNaN(price) || price < 0) throw new Error('Preço inválido')
      const reminderDays = Math.max(0, Math.floor(Number(form.reminder_days) || 0))
      return tenantApi.createService({
        name: form.name.trim(),
        price,
        duration_minutes: duration,
        reminder_days: reminderDays > 0 ? reminderDays : null,
        professional_ids: form.professional_ids,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] })
      setForm(BLANK_SERVICE)
    },
    onError: showError,
  })

  const remove = useMutation({
    mutationFn: (id: string) => tenantApi.deleteService(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
    onError: showError,
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
    <View style={s.stepBody}>
      <StepHeader step={STEPS[2]} />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : (services as any[]).length === 0 ? (
        <Card style={s.emptyCard}>
          <Text style={s.emptyText}>
            Nenhum serviço ainda. Cadastre o que seu negócio oferece — nome, preço e duração.
          </Text>
        </Card>
      ) : (
        <View style={s.listGap}>
          {(services as any[]).map((sv) => (
            <Card key={sv.id} style={s.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle} numberOfLines={1}>{sv.name}</Text>
                <Text style={s.itemMeta}>
                  {sv.duration_minutes} min · R$ {Number(sv.price).toFixed(2).replace('.', ',')}
                  {sv.professionals?.length > 0 ? ` · ${sv.professionals.map((p: any) => p.name).join(', ')}` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => remove.mutate(sv.id)} disabled={remove.isPending} style={s.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </TouchableOpacity>
            </Card>
          ))}
        </View>
      )}

      <Card style={s.formCard}>
        <Text style={s.formCardTitle}>Adicionar serviço</Text>
        <Input
          value={form.name}
          onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          placeholder="Nome do serviço * (ex.: Limpeza de pele)"
        />
        <View style={s.row}>
          <View style={s.flex1}>
            <Input
              label="Preço (R$) *"
              value={form.price}
              onChangeText={(v) => setForm((f) => ({ ...f, price: v }))}
              keyboardType="decimal-pad"
              placeholder="150,00"
            />
          </View>
          <View style={[s.flex1, { marginLeft: spacing.sm }]}>
            <Input
              label="Duração (min) *"
              value={form.duration_minutes}
              onChangeText={(v) => setForm((f) => ({ ...f, duration_minutes: v.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              placeholder="60"
            />
          </View>
        </View>
        <Input
          label="Lembrar o cliente após (dias, opcional)"
          value={form.reminder_days}
          onChangeText={(v) => setForm((f) => ({ ...f, reminder_days: v.replace(/[^0-9]/g, '') }))}
          keyboardType="number-pad"
          placeholder="Ex.: 30"
        />
        <View>
          <Text style={s.label}>Quem realiza este serviço</Text>
          {(professionals as any[]).length === 0 ? (
            <Text style={s.hintItalic}>Nenhum profissional cadastrado — volte ao passo Equipe para adicionar.</Text>
          ) : (
            <View style={[s.chipsWrap, { marginTop: spacing.xs }]}>
              {(professionals as any[]).map((p) => {
                const selected = form.professional_ids.includes(p.id)
                return (
                  <TouchableOpacity key={p.id} onPress={() => togglePro(p.id)} style={[s.chip, selected && s.chipActive]}>
                    {selected && <Ionicons name="checkmark" size={13} color={colors.primaryDark} style={{ marginRight: 3 }} />}
                    <Text style={[s.chipText, selected && s.chipTextActive]}>{p.name}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          )}
        </View>
        <Button
          label={add.isPending ? 'Adicionando...' : '+ Adicionar'}
          onPress={() => form.name.trim() && add.mutate()}
          loading={add.isPending}
          disabled={!form.name.trim()}
          variant="outline"
        />
      </Card>

      <Footer onBack={onBack} onContinue={onNext} />
    </View>
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

function isValidTime(v: string) { return /^\d{2}:\d{2}$/.test(v) }

function StepHorarios({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: saved, isLoading } = useQuery({ queryKey: ['hours'], queryFn: () => hoursApi.get() })
  const [rows, setRows] = useState<HourRow[]>(DEFAULT_ROWS)

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
    mutationFn: () => {
      for (const r of rows) {
        if (!r.enabled) continue
        if (!isValidTime(r.start_time) || !isValidTime(r.end_time)) {
          throw new Error(`Horário inválido em ${DAYS[r.day_of_week]}. Use o formato HH:MM`)
        }
        if (r.start_time >= r.end_time) {
          throw new Error(`Em ${DAYS[r.day_of_week]}, o horário de abertura deve ser antes do fechamento`)
        }
      }
      return hoursApi.save(rows)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hours'] })
      onNext()
    },
    onError: showError,
  })

  function toggle(i: number) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, enabled: !r.enabled } : r)))
  }
  function setTime(i: number, field: 'start_time' | 'end_time', v: string) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: v } : r)))
  }

  return (
    <View style={s.stepBody}>
      <StepHeader step={STEPS[3]} />

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : (
        <View style={s.listGap}>
          {rows.map((row, i) => (
            <Card key={i} style={s.dayCard}>
              <View style={s.dayHeader}>
                <Text style={[s.dayLabel, !row.enabled && s.dayLabelDisabled]}>{DAYS[i]}</Text>
                <Switch
                  value={row.enabled}
                  onValueChange={() => toggle(i)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
              {row.enabled ? (
                <View style={s.timeRow}>
                  <View style={s.flex1}>
                    <Input
                      value={row.start_time}
                      onChangeText={(v) => setTime(i, 'start_time', v)}
                      placeholder="09:00"
                      style={s.timeInput}
                    />
                  </View>
                  <Text style={s.timeSep}>até</Text>
                  <View style={s.flex1}>
                    <Input
                      value={row.end_time}
                      onChangeText={(v) => setTime(i, 'end_time', v)}
                      placeholder="18:00"
                      style={s.timeInput}
                    />
                  </View>
                </View>
              ) : (
                <Text style={s.closedText}>Fechado</Text>
              )}
            </Card>
          ))}
        </View>
      )}

      <Text style={s.hint}>
        Depois você pode ajustar horários por profissional e cadastrar folgas em Configurações → Horários.
      </Text>

      <Footer onBack={onBack} onContinue={() => save.mutate()} busy={save.isPending} continueLabel="Salvar e continuar" />
    </View>
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

  useEffect(() => {
    if (!config) return
    setTone(config.tone ?? 'friendly')
    setBusinessInfo(config.business_info ?? '')
  }, [config])

  const save = useMutation({
    mutationFn: () => agentApi.updateConfig({ tone, business_info: businessInfo.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-config'] })
      onNext()
    },
    onError: showError,
  })

  if (isLoading) return <ActivityIndicator color={colors.primary} style={s.loading} />

  return (
    <View style={s.stepBody}>
      <StepHeader step={STEPS[4]} />

      <View style={s.field}>
        <Text style={s.label}>Tom de voz do agente</Text>
        <View style={[s.listGap, { marginTop: spacing.xs }]}>
          {TONES.map((t) => {
            const selected = tone === t.value
            return (
              <TouchableOpacity key={t.value} onPress={() => setTone(t.value)} style={[s.toneBtn, selected && s.toneBtnActive]}>
                <Text style={[s.toneBtnLabel, selected && s.toneBtnLabelActive]}>{t.label}</Text>
                <Text style={[s.toneBtnDesc, selected && s.toneBtnDescActive]}>{t.desc}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      <View style={s.field}>
        <Text style={s.label}>Descrição do negócio *</Text>
        <Text style={s.hint}>
          O bot usa esse texto para responder perguntas dos seus clientes. Quanto mais detalhes, melhor.
        </Text>
        <Input
          value={businessInfo}
          onChangeText={setBusinessInfo}
          placeholder="Somos uma clínica de estética especializada em procedimentos faciais e corporais. Atendemos com hora marcada..."
          multiline
          numberOfLines={5}
          style={s.textarea}
        />
      </View>

      <Footer
        onBack={onBack}
        onContinue={() => save.mutate()}
        busy={save.isPending}
        disabled={!businessInfo.trim()}
        onSkipStep={onNext}
      />
    </View>
  )
}

/* ── Passo 6: Pagamentos ───────────────────────────────────────── */
function StepPagamentos({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient()
  const { data: cfg } = useQuery({ queryKey: ['payment-config'], queryFn: paymentConfigApi.get })
  const [accessToken, setAccessToken] = useState('')
  const [publicKey, setPublicKey] = useState('')

  const save = useMutation({
    mutationFn: () =>
      paymentConfigApi.save({
        mp_access_token: accessToken || undefined,
        mp_public_key: publicKey || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-config'] })
      onNext()
    },
    onError: showError,
  })

  const hasInput = Boolean(accessToken.trim() || publicKey.trim())

  return (
    <View style={s.stepBody}>
      <StepHeader step={STEPS[5]} />

      <View style={s.statusRow}>
        <View style={[s.dot, { backgroundColor: cfg?.configured ? colors.success : colors.textDisabled }]} />
        <Text style={s.statusText}>
          {cfg?.configured ? 'Mercado Pago já configurado' : 'Mercado Pago não configurado'}
        </Text>
      </View>

      <Card style={s.infoCard}>
        <Text style={s.infoTitle}>Como obter suas credenciais:</Text>
        <Text style={s.infoText}>
          1. Acesse mercadopago.com.br e faça login{'\n'}
          2. Vá em Seu negócio → Configurações → Credenciais{'\n'}
          3. Copie o Access Token e a Public Key de produção
        </Text>
      </Card>

      <Input
        label={cfg?.mp_access_token ? `Access Token (atual: ${cfg.mp_access_token})` : 'Access Token'}
        value={accessToken}
        onChangeText={setAccessToken}
        placeholder="APP_USR-..."
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Input
        label="Public Key"
        value={publicKey}
        onChangeText={setPublicKey}
        placeholder="APP_USR-..."
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Footer
        onBack={onBack}
        onContinue={() => (hasInput ? save.mutate() : onNext())}
        busy={save.isPending}
        continueLabel={hasInput ? 'Salvar e continuar' : 'Continuar'}
        onSkipStep={hasInput || cfg?.configured ? undefined : onNext}
      />
    </View>
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
    onSuccess: () => {
      setConnecting(true)
      refetchStatus()
    },
    onError: showError,
  })

  useEffect(() => {
    if (status?.status === 'connected') {
      setConnecting(false)
      qc.invalidateQueries({ queryKey: ['whatsapp-status'] })
    }
  }, [status?.status])

  const isConnected = status?.status === 'connected'
  const isPending = status?.status === 'qr_pending'

  return (
    <View style={s.stepBody}>
      <StepHeader step={STEPS[6]} />

      <Card style={s.statusCard}>
        <View style={[s.dot, {
          backgroundColor: isConnected ? colors.success : isPending ? colors.warning : colors.danger,
        }]} />
        <Text style={s.statusText}>
          {isConnected ? 'Conectado' : isPending ? 'Aguardando leitura do QR Code...' : 'Desconectado'}
        </Text>
        {isConnected && status?.phone_number ? (
          <Text style={s.itemMeta}>{status.phone_number}</Text>
        ) : null}
      </Card>

      {isConnected ? (
        <Card style={s.successCard}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark" size={26} color={colors.success} />
          </View>
          <Text style={s.successTitle}>Tudo pronto!</Text>
          <Text style={s.successText}>Seu WhatsApp está conectado e o bot já pode atender seus clientes.</Text>
        </Card>
      ) : isPending ? (
        <Card style={s.qrCard}>
          <Text style={s.qrSub}>
            Abra o WhatsApp no celular do seu negócio → Configurações → Aparelhos conectados → Conectar aparelho
          </Text>
          {qrData?.qrcode ? (
            <Image source={{ uri: qrData.qrcode }} style={s.qrImage} resizeMode="contain" />
          ) : (
            <View style={s.qrPlaceholder}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={s.qrPlaceholderText}>Gerando QR Code...</Text>
            </View>
          )}
          <Text style={s.qrExpiry}>O código expira em 60 segundos e é atualizado automaticamente</Text>
        </Card>
      ) : (
        <>
          <Card style={s.formCard}>
            {[
              'Toque em "Conectar WhatsApp" abaixo',
              'Escaneie o QR Code com o WhatsApp do seu negócio',
              'Pronto! O bot começa a responder seus clientes automaticamente',
            ].map((step, i) => (
              <View key={i} style={s.stepInstr}>
                <View style={s.stepNum}>
                  <Text style={s.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={s.stepInstrText}>{step}</Text>
              </View>
            ))}
          </Card>
          <TouchableOpacity
            style={[s.waBtn, connect.isPending && { opacity: 0.6 }]}
            onPress={() => connect.mutate()}
            disabled={connect.isPending}
            activeOpacity={0.85}
          >
            <Ionicons name="logo-whatsapp" size={18} color="#fff" />
            <Text style={s.waBtnText}>{connect.isPending ? 'Iniciando...' : 'Conectar WhatsApp'}</Text>
          </TouchableOpacity>
          <Text style={s.qrExpiry}>
            Sem o celular por perto? Você pode conectar depois em Configurações → WhatsApp.
          </Text>
        </>
      )}

      <Footer onBack={onBack} onContinue={onFinish} busy={finishing} continueLabel="Concluir" />
    </View>
  )
}

/* ── Wizard ────────────────────────────────────────────────────── */
export default function OnboardingScreen() {
  const token = useAuthStore((st) => st.token)
  const qc = useQueryClient()
  const [stepIndex, setStepIndex] = useState(0)
  const initializedRef = useRef(false)
  const scrollRef = useRef<ScrollView>(null)

  const { data: onboarding } = useQuery({
    queryKey: ['onboarding'],
    queryFn: tenantApi.onboarding,
    enabled: !!token,
  })

  // Abre no primeiro passo pendente (uma vez, ao carregar).
  useEffect(() => {
    if (!onboarding || initializedRef.current) return
    initializedRef.current = true
    const firstPending = STEPS.findIndex((st) => !onboarding.steps.find((x) => x.key === st.key)?.done)
    if (firstPending > 0) setStepIndex(firstPending)
  }, [onboarding])

  const finish = useMutation({
    mutationFn: tenantApi.completeOnboarding,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['onboarding'] })
      router.replace('/(app)')
    },
    onError: showError,
  })

  if (!token) return <Redirect href="/(auth)/login" />

  function skipAll() {
    onboardingSession.skipped = true
    router.replace('/(app)')
  }

  function goNext() {
    qc.invalidateQueries({ queryKey: ['onboarding'] })
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1))
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0))
    scrollRef.current?.scrollTo({ y: 0, animated: false })
  }

  const doneByKey: Record<string, boolean> = {}
  onboarding?.steps.forEach((st) => { doneByKey[st.key] = st.done })
  const current = STEPS[stepIndex]

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {/* Barra superior */}
      <View style={s.topBar}>
        <View style={s.topBarLeft}>
          <View style={s.rocket}>
            <Ionicons name="rocket-outline" size={15} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.topBarTitle} numberOfLines={1}>
              Passo {stepIndex + 1} de {STEPS.length} — {current.label}
            </Text>
            <Text style={s.topBarSub} numberOfLines={1}>Vamos configurar seu negócio em poucos passos</Text>
          </View>
        </View>
        <TouchableOpacity onPress={skipAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.skipAll}>Pular por agora</Text>
        </TouchableOpacity>
      </View>

      {/* Barra de progresso */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${((stepIndex + 1) / STEPS.length) * 100}%` }]} />
      </View>

      {/* Stepper compacto */}
      <View style={s.stepper}>
        {STEPS.map((st, i) => {
          const done = doneByKey[st.key]
          const active = i === stepIndex
          return (
            <TouchableOpacity
              key={st.key}
              onPress={() => {
                setStepIndex(i)
                scrollRef.current?.scrollTo({ y: 0, animated: false })
              }}
              style={[s.stepDot, active && s.stepDotActive, done && !active && s.stepDotDone]}
            >
              {done && !active ? (
                <Ionicons name="checkmark" size={13} color={colors.success} />
              ) : (
                <Text style={[s.stepDotText, active && s.stepDotTextActive]}>{i + 1}</Text>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {current.key === 'negocio' && <StepNegocio onNext={goNext} />}
          {current.key === 'equipe' && <StepEquipe onNext={goNext} onBack={goBack} />}
          {current.key === 'servicos' && <StepServicos onNext={goNext} onBack={goBack} />}
          {current.key === 'horarios' && <StepHorarios onNext={goNext} onBack={goBack} />}
          {current.key === 'agente' && <StepAgente onNext={goNext} onBack={goBack} />}
          {current.key === 'pagamentos' && <StepPagamentos onNext={goNext} onBack={goBack} />}
          {current.key === 'whatsapp' && (
            <StepWhatsApp onFinish={() => finish.mutate()} onBack={goBack} finishing={finish.isPending} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  topBarLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rocket: {
    width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  topBarTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  topBarSub: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },
  skipAll: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  // Progress bar
  progressTrack: { height: 4, backgroundColor: colors.surfaceAlt },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 2 },
  // Stepper
  stepper: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  stepDot: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary },
  stepDotDone: { backgroundColor: colors.success + '22' },
  stepDotText: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary },
  stepDotTextActive: { color: '#fff' },
  // Content
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  stepBody: { gap: spacing.md },
  loading: { paddingVertical: spacing.xl },
  // Step header
  stepHeader: { gap: spacing.sm },
  stepHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepHeaderIcon: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  stepHeaderTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  stepHeaderWhy: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  // Footer
  footer: { gap: spacing.sm, marginTop: spacing.sm },
  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLink: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs, gap: 2,
  },
  footerLinkText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  // Fields
  field: { gap: spacing.xs },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  hint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  hintItalic: { fontSize: font.sm, color: colors.textDisabled, fontStyle: 'italic', marginTop: spacing.xs },
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  textarea: { height: 120, paddingVertical: spacing.md, textAlignVertical: 'top' },
  // Chips
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.primaryDark },
  // Lists
  listGap: { gap: spacing.sm },
  emptyCard: { backgroundColor: colors.surfaceAlt },
  emptyText: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
  iconBtn: { padding: 4 },
  avatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  // Form card
  formCard: { gap: spacing.md },
  formCardTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  // Horários
  dayCard: { gap: spacing.sm },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  dayLabelDisabled: { color: colors.textDisabled },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeSep: { fontSize: font.sm, color: colors.textSecondary },
  timeInput: { height: 44 },
  closedText: { fontSize: font.sm, color: colors.textDisabled },
  // Agente
  toneBtn: {
    padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  toneBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toneBtnLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  toneBtnLabelActive: { color: colors.primaryDark },
  toneBtnDesc: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  toneBtnDescActive: { color: colors.primaryDark },
  // Pagamentos / WhatsApp status
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  infoCard: { backgroundColor: colors.primaryLight, gap: spacing.xs },
  infoTitle: { fontSize: font.sm, fontWeight: '700', color: colors.primaryDark },
  infoText: { fontSize: font.sm, color: colors.primaryDark, lineHeight: 22 },
  // WhatsApp
  successCard: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  successIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.success + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: font.lg, fontWeight: '700', color: colors.success },
  successText: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  qrCard: { alignItems: 'center', gap: spacing.md },
  qrSub: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  qrImage: { width: 220, height: 220, borderRadius: radius.md },
  qrPlaceholder: {
    width: 220, height: 220, alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
  },
  qrPlaceholderText: { color: colors.textSecondary, fontSize: font.sm },
  qrExpiry: { fontSize: font.sm, color: colors.textDisabled, textAlign: 'center' },
  stepInstr: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  stepInstrText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 22 },
  waBtn: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.whatsapp,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
  },
  waBtnText: { fontSize: font.md, fontWeight: '600', color: '#fff' },
})
