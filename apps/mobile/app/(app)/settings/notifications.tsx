import { View, Text, ScrollView, StyleSheet, Switch, ActivityIndicator, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi, type NotificationPrefs } from '@/lib/api'
import { registerForPushNotifications } from '@/lib/push'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const CHANNELS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  // O canal "no sistema" (sino) é sempre a caixa de entrada e não é opcional.
  { key: 'channel_push', label: 'Push no celular', hint: 'Notificação no aparelho.' },
  { key: 'channel_email', label: 'E-mail', hint: 'Receber os avisos por e-mail.' },
  { key: 'channel_whatsapp', label: 'WhatsApp', hint: 'Receber os avisos no seu WhatsApp.' },
]

const EVENTS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'evt_appointment_reminder', label: 'Lembretes de agenda', hint: 'Antes dos horários agendados.' },
  { key: 'evt_new_customer', label: 'Novos clientes no WhatsApp', hint: 'Quando um novo contato inicia conversa.' },
  { key: 'evt_confirmation', label: 'Confirmações de agendamento', hint: 'Quando um agendamento é confirmado.' },
  { key: 'evt_reschedule', label: 'Reajustes de horário', hint: 'Quando um agendamento é remarcado.' },
  { key: 'evt_service_completion', label: 'Concluir serviço', hint: 'Quando um horário passa e falta marcar como realizado.' },
  { key: 'evt_broadcast', label: 'Avisos da plataforma', hint: 'Novidades, promoções e comunicados.' },
]

export default function NotificationSettingsScreen() {
  const qc = useQueryClient()
  const toast = useToast()
  const { data, isLoading } = useQuery({ queryKey: ['notification-prefs'], queryFn: notificationsApi.preferences })
  const prefs = data

  // Diagnóstico de push
  const { data: pushStatus, refetch: refetchStatus } = useQuery({ queryKey: ['push-status'], queryFn: notificationsApi.pushStatus })
  const reactivate = useMutation({
    mutationFn: async () => { await registerForPushNotifications() },
    onSuccess: async () => { await refetchStatus(); toast.show('Tentativa de registro concluída.', 'info') },
  })
  const test = useMutation({
    mutationFn: notificationsApi.testPush,
    onSuccess: (r: any) => {
      if (r?.ok) {
        toast.show('Push de teste enviado! Deve chegar em segundos.', 'success')
      } else {
        // Mostra o motivo real (HTTP/ticket da Expo) para diagnóstico.
        const lines = [
          r?.detail ?? r?.reason ?? 'Falha ao enviar push de teste.',
          r?.status ? `HTTP: ${r.status}` : null,
          r?.ticket_error ? `Erro Expo: ${r.ticket_error}` : null,
          r?.expo ? `Resposta: ${typeof r.expo === 'string' ? r.expo : JSON.stringify(r.expo)}`.slice(0, 400) : null,
        ].filter(Boolean)
        Alert.alert('Não foi possível enviar o push', lines.join('\n\n'))
      }
    },
    onError: (e: any) => Alert.alert('Falha no teste de push', e?.message ?? 'Erro desconhecido.'),
  })

  const save = useMutation({
    mutationFn: (next: Partial<NotificationPrefs>) => notificationsApi.updatePreferences(next),
    onMutate: async (next) => {
      // Atualização otimista para o switch responder na hora.
      const prev = qc.getQueryData<NotificationPrefs>(['notification-prefs'])
      if (prev) qc.setQueryData(['notification-prefs'], { ...prev, ...next })
      return { prev }
    },
    onError: (_e, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notification-prefs'], ctx.prev)
    },
    onSuccess: (res) => qc.setQueryData(['notification-prefs'], res),
  })

  function toggle(key: keyof NotificationPrefs) {
    if (!prefs) return
    save.mutate({ [key]: !prefs[key] } as Partial<NotificationPrefs>)
  }

  if (isLoading || !prefs) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Diagnóstico de push */}
        <Text style={styles.sectionLabel}>Push (diagnóstico)</Text>
        <View style={styles.card}>
          <View style={styles.diagRow}>
            <Text style={styles.rowLabel}>Status do push</Text>
            <Text style={[styles.diagBadge, { color: pushStatus?.registered ? colors.success : colors.danger }]}>
              {pushStatus?.registered ? 'Registrado ✓' : 'Não registrado'}
            </Text>
          </View>
          <Text style={styles.rowHint}>
            {pushStatus?.registered
              ? 'Seu aparelho está registrado para receber push. Use "Enviar teste" para confirmar a entrega.'
              : 'Nenhum token registrado. Toque em "Reativar push" e aceite a permissão de notificações.'}
          </Text>
          <View style={styles.diagBtns}>
            <TouchableOpacity style={styles.diagBtnOutline} onPress={() => reactivate.mutate()} disabled={reactivate.isPending}>
              <Text style={styles.diagBtnOutlineText}>{reactivate.isPending ? '...' : 'Reativar push'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.diagBtnFilled} onPress={() => test.mutate()} disabled={test.isPending}>
              <Text style={styles.diagBtnFilledText}>{test.isPending ? 'Enviando...' : 'Enviar teste'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Canais de entrega</Text>
        <View style={styles.card}>
          {CHANNELS.map(({ key, label, hint }, i) => (
            <Row key={key} label={label} hint={hint} value={!!prefs[key]} onToggle={() => toggle(key)} last={i === CHANNELS.length - 1} />
          ))}
        </View>

        <Text style={styles.sectionLabel}>Tipos de aviso</Text>
        <View style={styles.card}>
          {EVENTS.map(({ key, label, hint }, i) => (
            <Row key={key} label={label} hint={hint} value={!!prefs[key]} onToggle={() => toggle(key)} last={i === EVENTS.length - 1} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Row({ label, hint, value, onToggle, last }: {
  label: string; hint: string; value: boolean; onToggle: () => void; last: boolean
}) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#fff"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.sm },
  sectionLabel: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.xs, textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  rowHint: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2, paddingVertical: spacing.sm },
  diagRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.md },
  diagBadge: { fontSize: font.sm, fontWeight: '700' },
  diagBtns: { flexDirection: 'row', gap: spacing.sm, paddingBottom: spacing.md },
  diagBtnOutline: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary },
  diagBtnOutlineText: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
  diagBtnFilled: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  diagBtnFilledText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
})
