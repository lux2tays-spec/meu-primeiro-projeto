import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { notificationsApi } from '@/lib/api'
import { colors } from '@/lib/theme'

// Sino de notificações do app: ícone + badge de não-lidos. Abre a central de avisos.
export function NotificationBell() {
  const { data } = useQuery({
    queryKey: ['notifications-unread'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 60_000,
  })
  const unread = data?.unread ?? 0

  return (
    <TouchableOpacity
      onPress={() => router.push('/(app)/notifications' as any)}
      hitSlop={8}
      style={styles.btn}
      accessibilityLabel="Notificações"
    >
      <Ionicons name="notifications-outline" size={24} color={colors.text} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  btn: { padding: 4 },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
})
