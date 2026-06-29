import { useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useAuthStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'

const statusMap: Record<string, { label: string; variant: any }> = {
  pending:   { label: 'Pendente',   variant: 'warning' },
  confirmed: { label: 'Confirmado', variant: 'info' },
  completed: { label: 'Concluído',  variant: 'success' },
  cancelled: { label: 'Cancelado',  variant: 'danger' },
}

const statusActions: Record<string, { label: string; next: string }[]> = {
  pending:   [{ label: 'Confirmar', next: 'confirmed' }, { label: 'Cancelar', next: 'cancelled' }],
  confirmed: [{ label: 'Concluir',  next: 'completed' }, { label: 'Cancelar', next: 'cancelled' }],
  completed: [],
  cancelled: [],
}

export default function AppointmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { role, userId } = useAuthStore()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [notes, setNotes] = useState('')
  const [pendingAction, setPendingAction] = useState<{ label: string; next: string } | null>(null)

  const { data: appt, isLoading } = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => api.get<any>(`/appointments/${id}`),
    onSuccess: (data: any) => setNotes(data.notes ?? ''),
  } as any)

  const canEdit = (() => {
    if (!appt || !role) return false
    if (role === 'root' || role === 'owner' || role === 'admin') return true
    return appt.created_by === userId || appt.professional_user_id === userId
  })()

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.patch<any>(`/appointments/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointment', id] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      setIsEditing(false)
      toast.show('Observações salvas com sucesso!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar as alterações.', 'error'),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.patch<any>(`/appointments/${id}/status`, { status }),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ['appointment', id] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      setPendingAction(null)
      const msgs: Record<string, string> = {
        confirmed: 'Agendamento confirmado!',
        completed: 'Agendamento concluído!',
        cancelled: 'Agendamento cancelado.',
      }
      toast.show(msgs[status] ?? 'Status atualizado.', status === 'cancelled' ? 'info' : 'success')
    },
    onError: (err: any) => {
      setPendingAction(null)
      toast.show(err.message ?? 'Não foi possível atualizar o status.', 'error')
    },
  })

  if (isLoading || !appt) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <Text style={{ textAlign: 'center', padding: spacing.xl, color: colors.textSecondary }}>Carregando...</Text>
      </SafeAreaView>
    )
  }

  const { label, variant } = statusMap[appt.status] ?? statusMap.pending
  const actions = statusActions[appt.status] ?? []
  const start = new Date(appt.starts_at)
  const end = new Date(appt.ends_at)

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Agendamento</Text>
        {canEdit && !isEditing && (
          <TouchableOpacity onPress={() => setIsEditing(true)}>
            <Ionicons name="create-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
        )}
        {isEditing && (
          <TouchableOpacity onPress={() => setIsEditing(false)}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusRow}>
          <Badge label={label} variant={variant} />
        </View>

        <Card style={styles.infoCard}>
          <InfoRow icon="person-outline" label="Cliente" value={appt.customer_name} sub={appt.customer_phone} />
          <View style={styles.divider} />
          <InfoRow icon="cut-outline" label="Serviço" value={appt.service_name} sub={`${appt.duration_minutes} min · R$ ${Number(appt.price).toFixed(2).replace('.', ',')}`} />
          <View style={styles.divider} />
          <InfoRow icon="person-circle-outline" label="Profissional" value={appt.professional_name} />
          <View style={styles.divider} />
          <InfoRow
            icon="calendar-outline"
            label="Data"
            value={start.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            sub={`${start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
          />
        </Card>

        <Card style={styles.notesCard}>
          <Text style={styles.notesLabel}>Observações</Text>
          {isEditing ? (
            <>
              <Input
                value={notes}
                onChangeText={setNotes}
                placeholder="Adicione observações..."
                multiline
                numberOfLines={4}
                style={{ height: undefined, paddingVertical: spacing.sm, textAlignVertical: 'top' }}
              />
              <Button
                label="Salvar observações"
                onPress={() => updateMutation.mutate({ notes: notes || null })}
                loading={updateMutation.isPending}
              />
            </>
          ) : (
            <Text style={styles.notesText}>{appt.notes ?? 'Nenhuma observação'}</Text>
          )}
        </Card>

        {canEdit && actions.length > 0 && !isEditing && (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.next}
                label={action.label}
                variant={action.next === 'cancelled' ? 'outline' : 'primary'}
                loading={statusMutation.isPending && pendingAction?.next === action.next}
                disabled={statusMutation.isPending}
                onPress={() => setPendingAction(action)}
              />
            ))}
          </View>
        )}

        {!canEdit && (
          <Card style={styles.readOnlyBadge}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.readOnlyText}>Você pode visualizar, mas não editar este agendamento</Text>
          </Card>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!pendingAction}
        title={pendingAction?.label ?? ''}
        message={`Deseja ${(pendingAction?.label ?? '').toLowerCase()} este agendamento?`}
        confirmLabel={pendingAction?.label ?? 'Confirmar'}
        variant={pendingAction?.next === 'cancelled' ? 'danger' : 'primary'}
        loading={statusMutation.isPending}
        onConfirm={() => pendingAction && statusMutation.mutate(pendingAction.next)}
        onCancel={() => setPendingAction(null)}
      />
    </SafeAreaView>
  )
}

function InfoRow({ icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <View style={ir.row}>
      <Ionicons name={icon} size={18} color={colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={ir.label}>{label}</Text>
        <Text style={ir.value}>{value}</Text>
        {sub && <Text style={ir.sub}>{sub}</Text>}
      </View>
    </View>
  )
}
const ir = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  label: { fontSize: font.sm, color: colors.textSecondary },
  value: { fontSize: font.md, fontWeight: '600', color: colors.text, marginTop: 1 },
  sub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  content: { padding: spacing.lg, gap: spacing.lg },
  statusRow: { alignItems: 'flex-start' },
  infoCard: { gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.border },
  notesCard: { gap: spacing.sm },
  notesLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  notesText: { fontSize: font.md, color: colors.textSecondary, lineHeight: 22 },
  actions: { gap: spacing.sm },
  readOnlyBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceAlt },
  readOnlyText: { flex: 1, fontSize: font.sm, color: colors.textSecondary },
})
