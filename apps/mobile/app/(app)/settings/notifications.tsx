import { View, Text, ScrollView, StyleSheet, Switch, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi, type NotificationPrefs } from '@/lib/api'
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
  const { data, isLoading } = useQuery({ queryKey: ['notification-prefs'], queryFn: notificationsApi.preferences })
  const prefs = data

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
  rowHint: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
})
