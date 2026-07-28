import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { StatCard } from '@/components/StatCard'
import { AppointmentCard } from '@/components/AppointmentCard'
import { Badge } from '@/components/ui/Badge'
import { tenantApi, appointmentsApi } from '@/lib/api'
import { colors, font, spacing } from '@/lib/theme'

/** YYYY-MM-DD local (não UTC). */
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Saudação conforme a hora do dia. */
function greetingByHour(hour: number) {
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export default function DashboardScreen() {
  // Calculado a cada render (não no load do módulo) — assim a data não
  // "congela" quando o app fica aberto e o dia vira.
  const now = new Date()
  const today = toDateStr(now)
  const greeting = greetingByHour(now.getHours())

  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const { data: onboarding } = useQuery({ queryKey: ['onboarding'], queryFn: tenantApi.onboarding })
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
            <Text style={styles.greeting}>{greeting}! 👋</Text>
            <Text style={styles.businessName}>{tenant?.name ?? '...'}</Text>
          </View>
          {tenant && (
            <Badge
              label={tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1)}
              variant={planVariant[tenant.plan] ?? 'default'}
            />
          )}
        </View>

        {/* Onboarding progress card */}
        {onboarding && !onboarding.completed && (
          <TouchableOpacity
            style={styles.onboardingCard}
            onPress={() => router.push('/onboarding')}
            activeOpacity={0.85}
          >
            <View style={styles.onboardingHeader}>
              <View style={styles.onboardingIcon}>
                <Ionicons name="rocket-outline" size={16} color={colors.primary} />
              </View>
              <Text style={styles.onboardingTitle}>
                Configuração {onboarding.progress.done}/{onboarding.progress.total}
              </Text>
            </View>
            <View style={styles.onboardingTrack}>
              <View
                style={[
                  styles.onboardingFill,
                  { width: `${(onboarding.progress.done / (onboarding.progress.total || 1)) * 100}%` },
                ]}
              />
            </View>
            <View style={styles.onboardingCta}>
              <Text style={styles.onboardingCtaText}>Continuar configuração</Text>
              <Ionicons name="chevron-forward" size={15} color={colors.primary} />
            </View>
          </TouchableOpacity>
        )}

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
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
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
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/(app)/appointments/new')}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Novo agendamento"
      >
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
  onboardingCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primaryLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  onboardingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  onboardingIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onboardingTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  onboardingTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  onboardingFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  onboardingCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  onboardingCtaText: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
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
