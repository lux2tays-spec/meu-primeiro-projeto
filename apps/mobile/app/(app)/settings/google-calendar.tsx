import { useEffect } from 'react'
import { View, Text, StyleSheet, ScrollView, Switch, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { googleApi } from '@/lib/api'
import { useGoogleCalendarAuth, getCalendarRedirectUri } from '@/lib/google-auth'
import { colors, font, spacing } from '@/lib/theme'

export default function GoogleCalendarScreen() {
  const queryClient = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['google-calendar-status'],
    queryFn: googleApi.calendarStatus,
  })

  const [calRequest, calResponse, calPromptAsync] = useGoogleCalendarAuth()

  // Handle Google Calendar OAuth response
  useEffect(() => {
    if (calResponse?.type !== 'success') return
    const code = (calResponse as any).params?.code
    if (!code) { Alert.alert('Erro', 'Não foi possível obter código de autorização'); return }

    connectMutation.mutate({ code, redirectUri: getCalendarRedirectUri() })
  }, [calResponse])

  const connectMutation = useMutation({
    mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) =>
      googleApi.calendarConnect(code, redirectUri),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-status'] })
      Alert.alert('Conectado!', 'Google Agenda conectado com sucesso. Seus agendamentos serão sincronizados automaticamente.')
    },
    onError: (err: any) => Alert.alert('Erro', err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => googleApi.calendarToggle(enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['google-calendar-status'] }),
    onError: (err: any) => Alert.alert('Erro', err.message),
  })

  const disconnectMutation = useMutation({
    mutationFn: googleApi.calendarDisconnect,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['google-calendar-status'] })
      Alert.alert('Desconectado', 'Google Agenda desvinculado desta conta.')
    },
    onError: (err: any) => Alert.alert('Erro', err.message),
  })

  if (isLoading) return null

  const isConnected = status?.connected

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Status card */}
        <Card style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={[styles.iconBox, { backgroundColor: '#DBEAFE' }]}>
              <Ionicons name="calendar" size={24} color={colors.info} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>Google Agenda</Text>
              <Text style={styles.statusSub}>
                {isConnected ? 'Conta conectada' : 'Não conectado'}
              </Text>
            </View>
            <View style={[styles.dot, { backgroundColor: isConnected ? colors.success : colors.textDisabled }]} />
          </View>

          {isConnected && (
            <>
              <View style={styles.divider} />
              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>Sincronização ativa</Text>
                  <Text style={styles.toggleSub}>Novos agendamentos serão criados na sua agenda</Text>
                </View>
                <Switch
                  value={status?.sync_enabled}
                  onValueChange={(v) => toggleMutation.mutate(v)}
                  trackColor={{ true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>
            </>
          )}
        </Card>

        {/* How it works */}
        <Card style={styles.infoCard}>
          <Text style={styles.infoTitle}>Como funciona</Text>
          {[
            { icon: 'sync-outline', text: 'Novos agendamentos criados no app ou pelo bot aparecem automaticamente no Google Agenda' },
            { icon: 'people-outline', text: 'Cada membro da equipe conecta a própria conta — você controla quem sincroniza' },
            { icon: 'notifications-outline', text: 'Lembretes do Google Agenda são enviados normalmente (1 hora antes)' },
            { icon: 'shield-checkmark-outline', text: 'Cancelamentos removem automaticamente o evento da agenda' },
          ].map((item, i) => (
            <View key={i} style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name={item.icon as any} size={16} color={colors.primary} />
              </View>
              <Text style={styles.infoText}>{item.text}</Text>
            </View>
          ))}
        </Card>

        {/* Actions */}
        {!isConnected ? (
          <Button
            label="Conectar Google Agenda"
            onPress={() => calPromptAsync()}
            loading={connectMutation.isPending}
            disabled={!calRequest}
          />
        ) : (
          <Button
            label="Desconectar Google Agenda"
            variant="outline"
            onPress={() => Alert.alert(
              'Desconectar',
              'Remover integração com Google Agenda? Eventos já criados não serão apagados.',
              [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Desconectar', style: 'destructive', onPress: () => disconnectMutation.mutate() },
              ]
            )}
            loading={disconnectMutation.isPending}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  statusCard: { gap: spacing.md },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconBox: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  statusTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  statusSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  divider: { height: 1, backgroundColor: colors.border },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  toggleSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2, maxWidth: 220 },
  infoCard: { gap: spacing.md },
  infoTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  infoRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  infoIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  infoText: { flex: 1, fontSize: font.md, color: colors.text, lineHeight: 22 },
})
