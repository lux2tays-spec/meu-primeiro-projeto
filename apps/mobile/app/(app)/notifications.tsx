import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Linking } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { notificationsApi, type AppNotification } from '@/lib/api'
import { colors, spacing, font, radius } from '@/lib/theme'

// Central de avisos in-app do aplicativo. Lista os avisos do usuário, permite
// marcar como lido e abre o link do aviso (ex.: /calendar para "finalizar serviço").
export default function NotificationsScreen() {
  const router = useRouter()
  const qc = useQueryClient()

  const { data, isRefetching, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list(50),
    refetchInterval: 60_000,
  })
  const notifications = data?.notifications ?? []
  const unread = data?.unread ?? 0

  async function openItem(n: AppNotification) {
    if (!n.read_at) {
      try { await notificationsApi.markRead(n.id) } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ['notifications'] })
      qc.invalidateQueries({ queryKey: ['notifications-unread'] })
    }
    if (n.link) {
      // Link externo (broadcast com URL) abre no navegador; caminho interno navega no app.
      if (/^https?:\/\//i.test(n.link)) {
        Linking.openURL(n.link).catch(() => {})
      } else {
        const path = n.link.startsWith('/') ? n.link : `/${n.link}`
        router.push(('/(app)' + path) as any)
      }
    }
  }

  async function markAll() {
    try { await notificationsApi.markAllRead() } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ['notifications'] })
    qc.invalidateQueries({ queryKey: ['notifications-unread'] })
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notificações</Text>
        {unread > 0 ? (
          <TouchableOpacity onPress={markAll} hitSlop={8}>
            <Text style={styles.markAll}>Marcar lidas</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={40} color={colors.textDisabled} />
            <Text style={styles.emptyText}>Nenhuma notificação por aqui.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.read_at && styles.cardUnread]}
            onPress={() => openItem(item)}
            activeOpacity={0.7}
          >
            {!item.read_at && <View style={styles.dot} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardBody}>{item.body}</Text>
              <Text style={styles.cardWhen}>{formatWhen(item.created_at)}</Text>
            </View>
            {item.link && <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { width: 80 },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  markAll: { fontSize: font.sm, fontWeight: '700', color: colors.primary, width: 80, textAlign: 'right' },
  list: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: spacing.md },
  emptyText: { fontSize: font.md, color: colors.textSecondary },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardUnread: { borderColor: colors.primary, backgroundColor: colors.surface },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  cardTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  cardWhen: { fontSize: 11, color: colors.textDisabled, marginTop: 4 },
})
