import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { SettingsRow } from '@/components/ui/SettingsRow'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/lib/store'
import { tenantApi } from '@/lib/api'
import { colors, font, spacing } from '@/lib/theme'

export default function SettingsScreen() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })

  function handleLogout() {
    Alert.alert('Sair', 'Deseja sair da conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => { clearAuth(); router.replace('/(auth)/login') } },
    ])
  }

  const planVariant: Record<string, any> = {
    free: 'warning', basico: 'info', premium: 'success', profissional: 'success',
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Business info card */}
        {tenant && (
          <Card style={styles.businessCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{tenant.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.businessName}>{tenant.name}</Text>
              <View style={styles.badgeRow}>
                <Badge
                  label={`Plano ${tenant.plan.charAt(0).toUpperCase() + tenant.plan.slice(1)}`}
                  variant={planVariant[tenant.plan] ?? 'default'}
                />
                {tenant.status === 'trial' && (
                  <Badge label="Trial" variant="warning" />
                )}
              </View>
            </View>
          </Card>
        )}

        {/* Automação */}
        <Text style={styles.section}>Automação</Text>
        <Card style={styles.group}>
          <SettingsRow icon="logo-whatsapp" iconColor={colors.whatsapp} label="WhatsApp" subtitle="Conectar número via QR Code" onPress={() => router.push('/(app)/settings/whatsapp')} />
          <View style={styles.divider} />
          <SettingsRow icon="sparkles-outline" iconColor="#A855F7" label="Agente IA" subtitle="Configurar personalidade e instruções do bot" onPress={() => router.push('/(app)/settings/agent')} />
          <View style={styles.divider} />
          <SettingsRow icon="calendar-outline" iconColor={colors.info} label="Google Agenda" subtitle="Sincronizar agendamentos com seu Google Calendar" onPress={() => router.push('/(app)/settings/google-calendar')} />
        </Card>

        {/* Negócio */}
        <Text style={styles.section}>Negócio</Text>
        <Card style={styles.group}>
          <SettingsRow icon="cut-outline" label="Serviços" subtitle="Gerenciar serviços e preços" onPress={() => router.push('/(app)/settings/services')} />
          <View style={styles.divider} />
          <SettingsRow icon="people-outline" label="Colaboradores" subtitle="Permissões e prestadores de serviço" onPress={() => router.push('/(app)/settings/staff')} />
          <View style={styles.divider} />
          <SettingsRow icon="time-outline" label="Horários de Funcionamento" subtitle="Dias e horas de atendimento" onPress={() => router.push('/(app)/settings/hours')} />
        </Card>

        {/* Financeiro */}
        <Text style={styles.section}>Financeiro</Text>
        <Card style={styles.group}>
          <SettingsRow icon="logo-paypal" iconColor="#009EE3" label="Meios de Pagamento" subtitle="Conectar Mercado Pago e gerar links" onPress={() => router.push('/(app)/settings/payments')} />
          <View style={styles.divider} />
          <SettingsRow icon="card-outline" iconColor={colors.success} label="Assinatura" subtitle="Plano atual, faturamento e cartões" onPress={() => router.push('/(app)/settings/subscription')} />
          <View style={styles.divider} />
          <SettingsRow icon="share-social-outline" iconColor={colors.info} label="Painel de Afiliado" subtitle="Indique e ganhe por cada indicação" onPress={() => router.push('/(app)/settings/affiliate')} />
        </Card>

        {/* Ajuda */}
        <Text style={styles.section}>Ajuda</Text>
        <Card style={styles.group}>
          <SettingsRow icon="headset-outline" iconColor={colors.warning} label="Suporte" subtitle="Fale com nossa equipe" onPress={() => router.push('/(app)/settings/support')} />
        </Card>

        {/* Logout */}
        <Card style={styles.group}>
          <SettingsRow icon="log-out-outline" iconColor={colors.danger} label="Sair" showChevron={false} onPress={handleLogout} />
        </Card>

        <Text style={styles.version}>AgendaBot v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  businessCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: font.xl, fontWeight: '800', color: colors.primary },
  businessName: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  badgeRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  section: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  group: { gap: 0 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: -spacing.md },
  version: { textAlign: 'center', color: colors.textDisabled, fontSize: font.sm, paddingBottom: spacing.xl },
})
