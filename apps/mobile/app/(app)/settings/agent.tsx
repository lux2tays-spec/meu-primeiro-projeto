import { useState, useEffect } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as DocumentPicker from 'expo-document-picker'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { agentApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const TONES = [
  { value: 'friendly', label: '😊 Amigável', desc: 'Descontraído e próximo do cliente' },
  { value: 'formal',   label: '👔 Formal',   desc: 'Profissional e respeitoso' },
  { value: 'casual',   label: '🤙 Casual',   desc: 'Informal e bem-humorado' },
]

const BUSINESS_TYPES = [
  'Clínica de Estética', 'Salão de Beleza', 'Barbearia', 'Pet Shop',
  'Clínica Odontológica', 'Clínica Médica', 'Academia', 'Pilates',
  'Massoterapia', 'Fisioterapia', 'Nutrição', 'Nail Designer',
  'Tatuagem / Piercing', 'Outro',
]

const BLANK = {
  business_info: '', business_type: '', address: '', neighborhood: '',
  city: '', state: '', instagram_url: '', google_maps_url: '',
  website_url: '', whatsapp_number: '', tone: 'friendly',
  custom_instructions: '', system_prompt: '',
  appointment_reminders_enabled: true,
  reminder1_minutes: 180,
  reminder2_minutes: 30,
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

export default function AgentScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { data: config, isLoading } = useQuery({ queryKey: ['agent-config'], queryFn: agentApi.getConfig })
  const [form, setForm] = useState(BLANK)
  const [section, setSection] = useState<'identity' | 'behavior' | 'catalogs'>('identity')

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

  const saveMutation = useMutation({
    mutationFn: (data: typeof form) => agentApi.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-config'] })
      toast.show('Configuração salva com sucesso!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Erro ao salvar', 'error'),
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      })
      if (res.canceled || !res.assets?.[0]) return null
      const asset = res.assets[0]
      return agentApi.uploadCatalog(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream')
    },
    onSuccess: (uploaded) => {
      if (!uploaded) return
      const next = [...form.catalog_files, uploaded]
      set('catalog_files', next)
      saveMutation.mutate({ ...form, catalog_files: next })
    },
    onError: (err: any) => toast.show(err.message ?? 'Erro no upload', 'error'),
  })

  function removeCatalog(url: string) {
    Alert.alert('Remover arquivo', 'Deseja remover este arquivo do catálogo?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive',
        onPress: () => {
          const next = form.catalog_files.filter((f) => f.url !== url)
          set('catalog_files', next)
          saveMutation.mutate({ ...form, catalog_files: next })
        },
      },
    ])
  }

  function handleSave() {
    saveMutation.mutate(form)
  }

  if (isLoading) return null

  return (
    <SafeAreaView style={s.container} edges={[]}>
      {/* Section tabs */}
      <View style={s.tabs}>
        {([['identity', 'Identidade'], ['behavior', 'Comportamento'], ['catalogs', 'Catálogos']] as const).map(
          ([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[s.tab, section === key && s.tabActive]}
              onPress={() => setSection(key)}
            >
              <Text style={[s.tabText, section === key && s.tabTextActive]}>{label}</Text>
            </TouchableOpacity>
          )
        )}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        {/* ── IDENTIDADE ── */}
        {section === 'identity' && (
          <>
            <Card style={s.tipCard}>
              <Text style={s.tipTitle}>🏢 Identidade do Negócio</Text>
              <Text style={s.tipText}>
                Preencha as informações do seu estabelecimento. A IA usará esses dados para responder
                clientes sobre localização, redes sociais e características do negócio.
              </Text>
            </Card>

            <Label>Tipo de negócio</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.typeScroll}>
              <View style={s.typeRow}>
                {BUSINESS_TYPES.map((bt) => (
                  <TouchableOpacity
                    key={bt}
                    style={[s.typeChip, form.business_type === bt && s.typeChipActive]}
                    onPress={() => set('business_type', form.business_type === bt ? '' : bt)}
                  >
                    <Text style={[s.typeChipText, form.business_type === bt && s.typeChipTextActive]}>
                      {bt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Label hint="O bot usará isso para responder perguntas gerais dos clientes">
              Descrição do negócio
            </Label>
            <Input
              value={form.business_info}
              onChangeText={(v) => set('business_info', v)}
              placeholder="Somos uma clínica de estética especializada em procedimentos faciais..."
              multiline
              numberOfLines={4}
              style={s.textarea}
            />

            <Label>Endereço</Label>
            <Input value={form.address} onChangeText={(v) => set('address', v)} placeholder="Rua e número" />

            <View style={s.row}>
              <View style={s.flex1}>
                <Label>Bairro</Label>
                <Input value={form.neighborhood} onChangeText={(v) => set('neighborhood', v)} placeholder="Bairro" />
              </View>
              <View style={[s.flex1, { marginLeft: spacing.sm }]}>
                <Label>Estado</Label>
                <Input value={form.state} onChangeText={(v) => set('state', v.toUpperCase())} placeholder="SP" maxLength={2} />
              </View>
            </View>

            <Label>Cidade</Label>
            <Input value={form.city} onChangeText={(v) => set('city', v)} placeholder="Cidade" />

            <Label hint="Número exibido ao cliente quando necessário">WhatsApp do negócio</Label>
            <Input value={form.whatsapp_number} onChangeText={(v) => set('whatsapp_number', v)} placeholder="(11) 99999-9999" keyboardType="phone-pad" />

            <Label>Instagram</Label>
            <Input value={form.instagram_url} onChangeText={(v) => set('instagram_url', v)} placeholder="https://instagram.com/seunegocio" autoCapitalize="none" />

            <Label>Google Maps</Label>
            <Input value={form.google_maps_url} onChangeText={(v) => set('google_maps_url', v)} placeholder="https://maps.google.com/..." autoCapitalize="none" />

            <Label>Website</Label>
            <Input value={form.website_url} onChangeText={(v) => set('website_url', v)} placeholder="https://seunegocio.com.br" autoCapitalize="none" />

            <Button label="Salvar identidade" onPress={handleSave} loading={saveMutation.isPending} />
          </>
        )}

        {/* ── COMPORTAMENTO ── */}
        {section === 'behavior' && (
          <>
            <Card style={s.tipCard}>
              <Text style={s.tipTitle}>🤖 Comportamento da IA</Text>
              <Text style={s.tipText}>
                Configure o tom, as instruções e as regras do agente. Quanto mais detalhado, melhor
                ele vai fechar vendas e agendamentos no WhatsApp.
              </Text>
            </Card>

            <Label>Tom de voz</Label>
            <View style={s.toneGrid}>
              {TONES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[s.toneBtn, form.tone === t.value && s.toneBtnActive]}
                  onPress={() => set('tone', t.value)}
                >
                  <Text style={[s.toneBtnLabel, form.tone === t.value && s.toneBtnLabelActive]}>{t.label}</Text>
                  <Text style={[s.toneBtnDesc, form.tone === t.value && s.toneBtnDescActive]}>{t.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Label hint="Descreva como o agente deve se comportar, o que pode e não pode dizer, como fechar uma venda, etc.">
              Instruções para a IA
            </Label>
            <Input
              value={form.custom_instructions}
              onChangeText={(v) => set('custom_instructions', v)}
              placeholder="Ex: Sempre perguntar o nome do cliente antes de agendar. Oferecer parcelamento no cartão ao citar preços. Ao fechar um agendamento, confirmar data e horário. Mencionar o Instagram ao perguntar sobre portfólio..."
              multiline
              numberOfLines={7}
              style={s.textarea}
            />

            <Label hint="Regras técnicas avançadas (opcional)">Instruções adicionais</Label>
            <Input
              value={form.system_prompt}
              onChangeText={(v) => set('system_prompt', v)}
              placeholder="Parâmetros técnicos específicos..."
              multiline
              numberOfLines={3}
              style={s.textarea}
            />

            {/* ── Lembretes de agendamento ── */}
            <View style={s.remindersSection}>
              <View style={s.remindersHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Lembretes de agendamento</Text>
                  <Text style={s.hint}>
                    Envia até 2 mensagens no WhatsApp antes do horário pedindo a confirmação do cliente
                  </Text>
                </View>
                <Switch
                  value={form.appointment_reminders_enabled}
                  onValueChange={(v) => set('appointment_reminders_enabled', v)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>

              {form.appointment_reminders_enabled && (
                <View style={s.row}>
                  <View style={s.flex1}>
                    <Label hint="Ex.: 180 = 3 horas antes">1º lembrete (minutos antes)</Label>
                    <Input
                      value={String(form.reminder1_minutes)}
                      onChangeText={(v) => set('reminder1_minutes', Math.max(0, parseInt(v, 10) || 0))}
                      keyboardType="number-pad"
                      placeholder="180"
                    />
                  </View>
                  <View style={[s.flex1, { marginLeft: spacing.sm }]}>
                    <Label hint="Ex.: 30 = meia hora antes">2º lembrete (minutos antes)</Label>
                    <Input
                      value={String(form.reminder2_minutes)}
                      onChangeText={(v) => set('reminder2_minutes', Math.max(0, parseInt(v, 10) || 0))}
                      keyboardType="number-pad"
                      placeholder="30"
                    />
                  </View>
                </View>
              )}
            </View>

            {/* ── Atendimento humano ── */}
            <View style={s.handoffSection}>
              <View>
                <Text style={s.label}>Atendimento humano</Text>
                <Text style={s.hint}>
                  Controle como o bot passa a conversa para um humano e quando volta a atender.
                </Text>
              </View>

              <View style={s.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Atendimento humano ativado</Text>
                  <Text style={s.hint}>
                    Quando ligado, o bot pausa se um humano assumir e volta sozinho depois.
                  </Text>
                </View>
                <Switch
                  value={form.handoff_enabled}
                  onValueChange={(v) => set('handoff_enabled', v)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>

              {form.handoff_enabled && (
                <>
                  <View style={s.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.label}>Pausar o bot quando eu responder</Text>
                      <Text style={s.hint}>
                        Se você responder o cliente pelo seu próprio WhatsApp, o bot para de responder automaticamente.
                      </Text>
                    </View>
                    <Switch
                      value={form.handoff_pause_on_owner_reply}
                      onValueChange={(v) => set('handoff_pause_on_owner_reply', v)}
                      trackColor={{ true: colors.primary, false: colors.border }}
                      thumbColor="#fff"
                    />
                  </View>

                  <View>
                    <Label hint="Minutos sem resposta do humano até o bot voltar a atender sozinho.">
                      Tempo de retorno do bot (min)
                    </Label>
                    <Input
                      value={String(form.handoff_timeout_min)}
                      onChangeText={(v) => set('handoff_timeout_min', Math.max(1, parseInt(v, 10) || 1))}
                      keyboardType="number-pad"
                      placeholder="30"
                    />
                  </View>

                  <View>
                    <Label hint="Pergunta que o bot envia quando não consegue resolver, oferecendo um especialista.">
                      Frase de ativação (pergunta do bot)
                    </Label>
                    <Input
                      value={form.handoff_offer_message}
                      onChangeText={(v) => set('handoff_offer_message', v)}
                      placeholder="Quer que eu encaminhe para um especialista?"
                    />
                  </View>

                  <View>
                    <Label hint="O que o cliente toca/responde para pedir um humano.">
                      Texto do botão
                    </Label>
                    <Input
                      value={form.handoff_button_label}
                      onChangeText={(v) => set('handoff_button_label', v)}
                      placeholder="Quero ajuda de um especialista"
                    />
                  </View>

                  <View>
                    <Label hint="Mensagem enviada ao cliente logo depois que ele pede o especialista.">
                      Confirmação ao cliente
                    </Label>
                    <Input
                      value={form.handoff_ack_message}
                      onChangeText={(v) => set('handoff_ack_message', v)}
                      placeholder="Perfeito! Já avisei a equipe 🙌 Em breve um especialista continua seu atendimento por aqui."
                      multiline
                      numberOfLines={3}
                      style={s.textarea}
                    />
                  </View>

                  <View>
                    <Label hint="Enviada quando o bot volta a atender após o tempo. Deixe vazio para voltar sem avisar.">
                      Mensagem de retorno (opcional)
                    </Label>
                    <Input
                      value={form.handoff_resume_message}
                      onChangeText={(v) => set('handoff_resume_message', v)}
                      placeholder=""
                    />
                  </View>

                  <View>
                    <Label hint="Digite essa palavra no chat para devolver o atendimento ao bot na hora. Deixe vazio para desativar.">
                      Palavra para devolver ao bot (opcional)
                    </Label>
                    <Input
                      value={form.handoff_owner_resume_keyword}
                      onChangeText={(v) => set('handoff_owner_resume_keyword', v)}
                      placeholder=""
                      autoCapitalize="none"
                    />
                  </View>
                </>
              )}
            </View>

            <Button label="Salvar comportamento" onPress={handleSave} loading={saveMutation.isPending} />
          </>
        )}

        {/* ── CATÁLOGOS ── */}
        {section === 'catalogs' && (
          <>
            <Card style={s.tipCard}>
              <Text style={s.tipTitle}>📄 Catálogos e Materiais</Text>
              <Text style={s.tipText}>
                Faça upload de PDFs ou imagens com tabelas de preços, fotos de procedimentos ou qualquer
                material que a IA possa mencionar durante as conversas.
              </Text>
            </Card>

            <Button
              label={uploadMutation.isPending ? 'Enviando...' : '+ Adicionar arquivo'}
              onPress={() => uploadMutation.mutate()}
              loading={uploadMutation.isPending}
              variant="outline"
            />

            {form.catalog_files.length === 0 ? (
              <Text style={s.emptyText}>Nenhum arquivo enviado ainda</Text>
            ) : (
              form.catalog_files.map((f) => (
                <View key={f.url} style={s.fileRow}>
                  <Text style={s.fileIcon}>{f.name.endsWith('.pdf') ? '📄' : '🖼️'}</Text>
                  <Text style={s.fileName} numberOfLines={1}>{f.name}</Text>
                  <TouchableOpacity onPress={() => removeCatalog(f.url)}>
                    <Text style={s.removeBtn}>Remover</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View style={{ marginBottom: 4 }}>
      <Text style={s.label}>{children}</Text>
      {hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  )
}

const s = StyleSheet.create({
  container:         { flex: 1, backgroundColor: colors.background },
  tabs:              { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  tab:               { flex: 1, paddingVertical: spacing.sm, alignItems: 'center' },
  tabActive:         { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText:           { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  tabTextActive:     { color: colors.primary, fontWeight: '700' },
  content:           { padding: spacing.lg, gap: spacing.md },
  tipCard:           { backgroundColor: colors.primaryLight, gap: spacing.xs },
  tipTitle:          { fontSize: font.md, fontWeight: '700', color: colors.primaryDark },
  tipText:           { fontSize: font.sm, color: colors.primaryDark, lineHeight: 20 },
  label:             { fontSize: font.md, fontWeight: '600', color: colors.text },
  hint:              { fontSize: font.sm, color: colors.textSecondary },
  textarea:          { height: undefined, paddingVertical: spacing.md, textAlignVertical: 'top' },
  typeScroll:        { marginBottom: spacing.xs },
  typeRow:           { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingBottom: spacing.xs },
  typeChip:          { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive:    { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  typeChipText:      { fontSize: font.sm, color: colors.textSecondary },
  typeChipTextActive:{ color: colors.primaryDark, fontWeight: '600' },
  row:               { flexDirection: 'row' },
  flex1:             { flex: 1 },
  toneGrid:          { gap: spacing.sm },
  toneBtn:           { padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  toneBtnActive:     { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  toneBtnLabel:      { fontSize: font.md, fontWeight: '600', color: colors.text },
  toneBtnLabelActive:{ color: colors.primaryDark },
  toneBtnDesc:       { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  toneBtnDescActive: { color: colors.primaryDark },
  remindersSection:  { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.md },
  remindersHeader:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  handoffSection:    { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, gap: spacing.md },
  switchRow:         { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emptyText:         { textAlign: 'center', color: colors.textSecondary, fontSize: font.sm, paddingVertical: spacing.xl },
  fileRow:           { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  fileIcon:          { fontSize: 22 },
  fileName:          { flex: 1, fontSize: font.sm, color: colors.text },
  removeBtn:         { fontSize: font.sm, color: colors.danger, fontWeight: '600' },
})
