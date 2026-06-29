import { useState } from 'react'
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'
import { Card } from '@/components/ui/Card'

export default function CustomersScreen() {
  const [search, setSearch] = useState('')

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<any[]>('/tenant/customers'),
  })

  const filtered = customers?.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  ) ?? []

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Clientes</Text>
        <Text style={styles.count}>{customers?.length ?? 0} cadastrados</Text>
      </View>

      {/* Search */}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nome ou telefone..."
          placeholderTextColor={colors.textDisabled}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {isLoading ? 'Carregando...' : 'Nenhum cliente encontrado'}
          </Text>
        }
        renderItem={({ item }) => (
          <Card style={styles.customerCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <View style={styles.phoneRow}>
                <Ionicons name="logo-whatsapp" size={14} color={colors.whatsapp} />
                <Text style={styles.phone}>{item.phone}</Text>
              </View>
              {item.email && <Text style={styles.email}>{item.email}</Text>}
            </View>
          </Card>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, marginBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  count: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  customerCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: font.lg, fontWeight: '700', color: colors.primary },
  info: { flex: 1 },
  name: { fontSize: font.md, fontWeight: '600', color: colors.text },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  phone: { fontSize: font.sm, color: colors.textSecondary },
  email: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.xl, fontSize: font.md },
})
