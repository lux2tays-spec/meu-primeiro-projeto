import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { supportApi, SupportTicketSummary } from '@/lib/api'
import { colors, font, spacing } from '@/lib/theme'

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return (
    d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' às ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  )
}

export default function TicketsScreen() {
  const { data: tickets, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['support', 'tickets'],
    queryFn: supportApi.tickets,
  })

  function renderTicket({ item }: { item: SupportTicketSummary }) {
    const isOpen = item.status === 'open'
    const isHigh = item.priority === 'high' || (item.priority as string) === 'alta'
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push({ pathname: '/(app)/settings/ticket/[id]', params: { id: item.id } })}
      >
        <Card style={styles.ticketCard}>
          <View style={styles.ticketHeader}>
            <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
            <Badge label={isOpen ? 'Aberto' : 'Resolvido'} variant={isOpen ? 'warning' : 'success'} />
          </View>
          {!!item.last_message && (
            <Text style={styles.ticketLastMessage} numberOfLines={2}>{item.last_message}</Text>
          )}
          <View style={styles.ticketFooter}>
            {isHigh && <Badge label="Prioridade alta" variant="danger" />}
            <Text style={styles.ticketDate}>Atualizado em {formatUpdatedAt(item.updated_at)}</Text>
          </View>
        </Card>
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.textDisabled} />
          <Text style={styles.stateTitle}>Não foi possível carregar seus chamados</Text>
          <Button label="Tentar novamente" variant="outline" onPress={() => refetch()} style={styles.retryBtn} />
        </View>
      ) : (
        <FlatList
          data={tickets ?? []}
          keyExtractor={(t) => t.id}
          renderItem={renderTicket}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="file-tray-outline" size={40} color={colors.textDisabled} />
              <Text style={styles.stateTitle}>Nenhum chamado aberto.</Text>
              <Text style={styles.stateSub}>
                Precisa de ajuda? Abra um chamado e nossa equipe responde por aqui.
              </Text>
            </View>
          }
        />
      )}

      {!isLoading && !isError && (
        <View style={styles.footer}>
          <Button label="+ Abrir chamado" onPress={() => router.push('/(app)/settings/ticket-new')} />
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  list: { padding: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  ticketCard: { gap: spacing.xs },
  ticketHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  ticketSubject: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  ticketLastMessage: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 19 },
  ticketFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  ticketDate: { fontSize: font.sm, color: colors.textDisabled, flexShrink: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  stateTitle: { fontSize: font.md, fontWeight: '600', color: colors.textSecondary, textAlign: 'center' },
  stateSub: { fontSize: font.sm, color: colors.textDisabled, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: spacing.sm, alignSelf: 'stretch' },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
})
