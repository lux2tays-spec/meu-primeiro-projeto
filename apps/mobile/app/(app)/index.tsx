import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { StatCard } from '@/components/StatCard'
import { AppointmentCard } from '@/components/AppointmentCard'
import { Badge } from '@/components/ui/Badge'
import { tenantApi, appointmentsApi } from '@/lib/api'
import { colors, font, spacing } from '@/lib/theme'

const today = new Date().toISOString().split('T')[0]

export default function DashboardScreen() {
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const {
    data: appointments,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['appointments', today],
    queryFn: () => appointmentsApi.list(today),
  })

  const confirmed = appointments?.filter((a) => a.status === 'confirmed').length ?? 0
  const pending = appointments?.filter((a) => a.status === 'pending').length ?? 0
  const total = appointments?.length ?? 0

  const planVariant: Record<string, any> = {
    free: 'warning',
    basico: 'info',
    premium: 'success',
    profissional: 'success',
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Bom dia! 👋</Text>
            <Text style={styles.businessName}>{tenant?.name ?? '...'}</Text>
          </View>
          {tenant && (
            <Badge
              label={tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1)}
              variant={planVariant[tenant.plan] ?? 'default'}
            />
          )}
        </View>

        {/* Trial banner */}
        {tenant?.status === 'trial' && (
          <View style={styles.trialBanner}>
            <Text style={styles.trialText}>
              ⏰ Período de teste — assine para não perder o acesso
            </Text>
          </View>
        )}

        {/* Stats */}
        <Text style={styles.sectionTitle}>Hoje</Text>
        <View style={styles.statsRow}>
          <StatCard
            label="Agendamentos"
            value={total}
            icon="calendar-outline"
            color={colors.primary}
          />
          <StatCard
            label="Confirmados"
            value={confirmed}
            icon="checkmark-circle-outline"
            color={colors.success}
          />
          <StatCard
            label="Pendentes"
            value={pending}
            icon="time-outline"
            color={colors.warning}
          />
        </View>

        {/* Today's appointments */}
        <Text style={styles.sectionTitle}>Próximos agendamentos</Text>
        {isLoading ? (
          <Text style={styles.empty}>Carregando...</Text>
        ) : !appointments?.length ? (
          <Text style={styles.empty}>Nenhum agendamento para hoje</Text>
        ) : (
          <View style={styles.list}>
            {appointments.map((a) => (
              <AppointmentCard
                key={a.id}
                appointment={a}
                onPress={() => router.push(`/(app)/appointments/${a.id}`)}
              />
            ))}
          </View>
        )}
      </ScrollView>
      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/(app)/appointments/new')} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  greeting: { fontSize: font.md, color: colors.textSecondary },
  businessName: { fontSize: font.xl, fontWeight: '700', color: colors.text, marginTop: 2 },
  trialBanner: {
    backgroundColor: colors.warning + '22',
    borderRadius: 12,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
  },
  trialText: { color: colors.warning, fontSize: font.sm, fontWeight: '500' },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  statsRow: { flexDirection: 'row', gap: spacing.md },
  list: { gap: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center', paddingVertical: spacing.xl },
  fab: {
    position: 'absolute',
    bottom: spacing.xl,
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
})
