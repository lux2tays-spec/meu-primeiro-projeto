import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Badge } from './ui/Badge'
import { Card } from './ui/Card'
import { colors, font, spacing } from '@/lib/theme'

const statusMap: Record<string, { label: string; variant: any }> = {
  pending:   { label: 'Pendente',   variant: 'warning' },
  confirmed: { label: 'Confirmado', variant: 'info' },
  completed: { label: 'Concluído',  variant: 'success' },
  cancelled: { label: 'Cancelado',  variant: 'danger' },
}

interface Props {
  appointment: {
    id: string
    starts_at: string
    ends_at: string
    status: string
    customer_name: string
    professional_name: string
    service_name: string
  }
  onPress?: () => void
}

export function AppointmentCard({ appointment, onPress }: Props) {
  const start = new Date(appointment.starts_at)
  const end = new Date(appointment.ends_at)
  const timeStr = `${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
  const { label, variant } = statusMap[appointment.status] ?? statusMap.pending

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Card style={styles.card}>
        <View style={styles.timeBar}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.time}>{timeStr}</Text>
          <Badge label={label} variant={variant} />
        </View>
        <Text style={styles.customer}>{appointment.customer_name}</Text>
        <View style={styles.meta}>
          <Text style={styles.metaText}>{appointment.service_name}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.metaText}>{appointment.professional_name}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
  timeBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  time: { fontSize: font.sm, color: colors.textSecondary, flex: 1 },
  customer: { fontSize: font.md, fontWeight: '600', color: colors.text },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  metaText: { fontSize: font.sm, color: colors.textSecondary },
  dot: { color: colors.textDisabled },
})
