import { View, Text, StyleSheet, ScrollView, Alert, Linking, TouchableOpacity } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery } from '@tanstack/react-query'
import { SettingsRow } from '@/components/ui/SettingsRow'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/lib/store'
import { useBrandingStore } from '@/lib/branding'
import { tenantApi, authApi } from '@/lib/api'
import { unregisterPushToken } from '@/lib/push'
import { useCapabilities, promptUpgrade } from '@/lib/capabilities'
import { colors, font, spacing } from '@/lib/theme'

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://aiconfirma.com.br'

export default function SettingsScreen() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const appName = useBrandingStore((s) => s.appName)
  const role = useAuthStore((s) => s.role)
  const { can } = useCapabilities()
  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })

  function handleLogout() {
    Alert.alert('Sair', 'Deseja sair da conta?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: async () => { await unregisterPushToken(); clearAuth(); router.replace('/(auth)/login') } },
    ])
  }

  async function performDelete() {
    try {
      await authApi.deleteAccount()
      clearAuth()
      router.replace('/(auth)/login')
    } catch (e: any) {
      Alert.alert('Erro', e?.message ?? 'Não foi possível excluir a conta. Tente novamente.')
    }
  }

  function handleDeleteAccount() {
    const isOwner = role === 'owner' || role === 'root'
    const message = isOwner
      ? 'Isso apaga permanentemente sua conta e TODOS os dados do negócio (clientes, agendamentos, conversas, configurações). Esta ação não pode ser desfeita.'
      : 'Isso remove permanentemente seu acesso e sua conta. Esta ação não pode ser desfeita.'
    Alert.alert('Excluir conta', message, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Tem certeza?', 'Confirme para excluir definitivamente.', [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Excluir definitivamente', style: 'destructive', onPress: performDelete },
          ]),
      },
    ])
  }

  const planVariant: Record<string, any> = {
    free: 'warning', basico: 'info', premium: 'success', profissional: 'success',
  }

  const canManageBusiness = ['owner', 'admin', 'root'].includes(role ?? '')

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Business info card */}
        {tenant && (
          <TouchableOpacity
            activeOpacity={canManageBusiness ? 0.7 : 1}
            disabled={!canManageBusiness}
            onPress={() => router.push('/(app)/settings/business')}
          >
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
              {canManageBusiness && (
                <Text style={styles.businessChevron}>›</Text>
              )}
            </Card>
          </TouchableOpacity>
        )}

        {/* Trial/assinatura vencida — bloqueio */}
        {tenant && (() => {
          const trialExpired = tenant.status === 'trial' && tenant.trial_ends_at && new Date(tenant.trial_ends_at).getTime() < Date.now()
          const blocked = trialExpired || tenant.status === 'suspended' || tenant.status === 'cancelled'
          if (!blocked) return null
          const title = tenant.status === 'cancelled' ? 'Assinatura cancelada'
            : tenant.status === 'suspended' ? 'Assinatura suspensa'
            : 'Período de teste encerrado'
          return (
            <TouchableOpacity style={styles.blockedBanner} onPress={() => router.push('/(app)/settings/subscription')}>
              <Text style={styles.blockedIcon}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.blockedTitle}>{title}</Text>
                <Text style={styles.blockedSub}>WhatsApp desconectado. Toque para assinar e reativar o atendimento.</Text>
              </View>
              <Text style={styles.blockedChevron}>›</Text>
            </TouchableOpacity>
          )
        })()}

        {/* Automação */}
        <Text style={styles.section}>Automação</Text>
        <Card style={styles.group}>
          <SettingsRow icon="chatbubbles-outline" label="WhatsApp" subtitle="Conectar número via QR Code" onPress={() => router.push('/(app)/settings/whatsapp')} />
          <View style={styles.divider} />
          <SettingsRow icon="sparkles-outline" label="Agente IA" subtitle="Configurar personalidade e instruções do bot" onPress={() => router.push('/(app)/settings/agent')} />
          <View style={styles.divider} />
          <SettingsRow icon="calendar-outline" label="Google Agenda" subtitle="Sincronizar agendamentos com seu Google Calendar" locked={!can('google_calendar')} onPress={() => can('google_calendar') ? router.push('/(app)/settings/google-calendar') : promptUpgrade('Google Agenda')} />
        </Card>

        {/* Negócio */}
        <Text style={styles.section}>Negócio</Text>
        <Card style={styles.group}>
          {canManageBusiness && (
            <>
              <SettingsRow icon="business-outline" label="Dados do negócio" subtitle="Nome da empresa e informações de contato" onPress={() => router.push('/(app)/settings/business')} />
              <View style={styles.divider} />
            </>
          )}
          <SettingsRow icon="cut-outline" label="Serviços" subtitle="Gerenciar serviços e preços" onPress={() => router.push('/(app)/settings/services')} />
          <View style={styles.divider} />
          <SettingsRow icon="people-outline" label="Colaboradores" subtitle="Permissões e prestadores de serviço" onPress={() => router.push('/(app)/settings/staff')} />
          <View style={styles.divider} />
          <SettingsRow icon="time-outline" label="Horários de Funcionamento" subtitle="Dias e horas de atendimento" onPress={() => router.push('/(app)/settings/hours')} />
        </Card>

        {/* Financeiro */}
        <Text style={styles.section}>Financeiro</Text>
        <Card style={styles.group}>
          <SettingsRow icon="wallet-outline" label="Meios de Pagamento" subtitle="Conectar Mercado Pago e gerar links" onPress={() => router.push('/(app)/settings/payments')} />
          <View style={styles.divider} />
          <SettingsRow icon="cash-outline" label="Comissões" subtitle="Comissões dos profissionais por serviço" locked={!can('commissions')} onPress={() => can('commissions') ? router.push('/(app)/comissoes') : promptUpgrade('Comissões')} />
          <View style={styles.divider} />
          <SettingsRow icon="card-outline" label="Assinatura" subtitle="Plano atual, faturamento e cartões" onPress={() => router.push('/(app)/settings/subscription')} />
          <View style={styles.divider} />
          <SettingsRow icon="share-social-outline" label="Painel de Afiliado" subtitle="Indique e ganhe por cada indicação" locked={!can('affiliate')} onPress={() => can('affiliate') ? router.push('/(app)/settings/affiliate') : promptUpgrade('Painel de Afiliado')} />
        </Card>

        {/* Ajuda */}
        <Text style={styles.section}>Ajuda</Text>
        <Card style={styles.group}>
          <SettingsRow icon="headset-outline" label="Suporte" subtitle="Fale com nossa equipe" onPress={() => router.push('/(app)/settings/support')} />
          <View style={styles.divider} />
          <SettingsRow icon="sparkles-outline" label="Assistente de suporte (IA)" subtitle="Tire dúvidas agora com nossa IA" onPress={() => router.push('/(app)/settings/support-chat')} />
          <View style={styles.divider} />
          <SettingsRow icon="file-tray-full-outline" label="Meus chamados" subtitle="Acompanhe suas solicitações" onPress={() => router.push('/(app)/settings/tickets')} />
          <View style={styles.divider} />
          <SettingsRow icon="shield-checkmark-outline" label="Política de Privacidade" onPress={() => Linking.openURL(`${WEB_URL}/privacidade`)} />
          <View style={styles.divider} />
          <SettingsRow icon="document-text-outline" label="Termos de Uso" onPress={() => Linking.openURL(`${WEB_URL}/termos`)} />
        </Card>

        {/* Conta */}
        <Text style={styles.section}>Conta</Text>
        <Card style={styles.group}>
          <SettingsRow icon="person-circle-outline" label="Meu Perfil" subtitle="Nome, telefone, e-mail de login e senha" onPress={() => router.push('/(app)/settings/perfil')} />
          <SettingsRow icon="notifications-outline" label="Notificações" subtitle="Escolha como e sobre o que ser avisado" onPress={() => router.push('/(app)/settings/notifications' as any)} />
          <View style={styles.divider} />
          <SettingsRow icon="log-out-outline" iconColor={colors.danger} label="Sair" showChevron={false} onPress={handleLogout} />
        </Card>

        <Text style={styles.version}>{`${appName} v1.0.0`}</Text>
        {/* Excluir conta: discreto no rodapé (exigência das lojas de ter exclusão no app). */}
        <TouchableOpacity onPress={handleDeleteAccount} style={{ alignSelf: 'center', paddingVertical: spacing.md }}>
          <Text style={styles.deleteLink}>Excluir minha conta</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  businessCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  blockedBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#FEE2E2', borderColor: '#FCA5A5', borderWidth: 1, borderRadius: 14, padding: spacing.md },
  blockedIcon: { fontSize: 18 },
  blockedTitle: { fontSize: font.md, fontWeight: '700', color: '#B91C1C' },
  blockedSub: { fontSize: font.sm, color: '#B91C1C', opacity: 0.85, marginTop: 2 },
  blockedChevron: { fontSize: 22, color: '#B91C1C', fontWeight: '700' },
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
  businessChevron: { fontSize: 24, color: colors.textDisabled, fontWeight: '400' },
  badgeRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  section: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8 },
  group: { gap: 0 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: -spacing.md },
  version: { textAlign: 'center', color: colors.textDisabled, fontSize: font.sm },
  deleteLink: { color: colors.textDisabled, fontSize: font.sm, textDecorationLine: 'underline' },
})
