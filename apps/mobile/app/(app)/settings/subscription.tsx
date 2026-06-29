import { View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { tenantApi } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'

const PLANS = [
  { id: 'basico',       label: 'Básico',       price: 'R$ 89/mês',  agendas: 1, users: 1 },
  { id: 'premium',      label: 'Premium',      price: 'R$ 169/mês', agendas: 3, users: 3 },
  { id: 'profissional', label: 'Profissional', price: 'R$ 299/mês', agendas: 10, users: 10 },
]

export default function SubscriptionScreen() {
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })

  const currentPlan = PLANS.find((p) => p.id === tenant?.plan)

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Current plan */}
        <Card style={styles.currentCard}>
          <View style={styles.currentHeader}>
            <Text style={styles.currentLabel}>Plano atual</Text>
            <Badge
              label={tenant?.status === 'trial' ? 'Trial' : 'Ativo'}
              variant={tenant?.status === 'trial' ? 'warning' : 'success'}
            />
          </View>
          <Text style={styles.planName}>{currentPlan?.label ?? (tenant?.plan === 'free' ? 'Gratuito (Trial)' : tenant?.plan)}</Text>
          {currentPlan && <Text style={styles.planPrice}>{currentPlan.price}</Text>}
          {tenant?.status === 'trial' && (
            <View style={styles.trialInfo}>
              <Ionicons name="time-outline" size={16} color={colors.warning} />
              <Text style={styles.trialText}>
                Trial expira em {tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleDateString('pt-BR') : '—'}
              </Text>
            </View>
          )}
        </Card>

        {/* Plans comparison */}
        <Text style={styles.sectionTitle}>Escolha um plano</Text>
        {PLANS.map((plan) => {
          const isCurrent = plan.id === tenant?.plan
          return (
            <TouchableOpacity
              key={plan.id}
              activeOpacity={0.8}
              onPress={() => Alert.alert('Assinar', `Deseja assinar o plano ${plan.label}?`, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Assinar', onPress: () => Alert.alert('Em breve', 'Redirecionando para pagamento...') },
              ])}
            >
              <Card style={[styles.planCard, isCurrent && styles.planCardActive]}>
                <View style={styles.planRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planCardName, isCurrent && styles.planCardNameActive]}>{plan.label}</Text>
                    <Text style={styles.planCardPrice}>{plan.price}</Text>
                  </View>
                  {isCurrent && <Badge label="Atual" variant="success" />}
                </View>
                <View style={styles.planFeatures}>
                  <View style={styles.feature}>
                    <Ionicons name="calendar-outline" size={14} color={isCurrent ? colors.primaryDark : colors.textSecondary} />
                    <Text style={[styles.featureText, isCurrent && styles.featureTextActive]}>{plan.agendas} agenda{plan.agendas > 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.feature}>
                    <Ionicons name="people-outline" size={14} color={isCurrent ? colors.primaryDark : colors.textSecondary} />
                    <Text style={[styles.featureText, isCurrent && styles.featureTextActive]}>{plan.users} usuário{plan.users > 1 ? 's' : ''}</Text>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          )
        })}

        {/* Cancel */}
        {tenant?.plan !== 'free' && (
          <Button
            label="Cancelar assinatura"
            variant="ghost"
            onPress={() => Alert.alert(
              'Cancelar assinatura',
              'Você perderá o acesso ao final do período pago. Deseja continuar?',
              [
                { text: 'Manter assinatura', style: 'cancel' },
                { text: 'Cancelar', style: 'destructive', onPress: () => {} },
              ]
            )}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  currentCard: { gap: spacing.sm },
  currentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  currentLabel: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  planName: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  planPrice: { fontSize: font.lg, color: colors.primary, fontWeight: '600' },
  trialInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  trialText: { fontSize: font.sm, color: colors.warning, fontWeight: '500' },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  planCard: { gap: spacing.sm },
  planCardActive: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  planRow: { flexDirection: 'row', alignItems: 'flex-start' },
  planCardName: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  planCardNameActive: { color: colors.primaryDark },
  planCardPrice: { fontSize: font.md, color: colors.textSecondary, marginTop: 2 },
  planFeatures: { flexDirection: 'row', gap: spacing.lg },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  featureText: { fontSize: font.sm, color: colors.textSecondary },
  featureTextActive: { color: colors.primaryDark },
})
