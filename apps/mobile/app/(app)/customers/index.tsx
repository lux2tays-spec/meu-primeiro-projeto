import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, tenantApi } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'
import { useAuthStore } from '@/lib/store'
import { Card } from '@/components/ui/Card'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  completed: 'Realizado',
  cancelled: 'Cancelado',
}
const STATUS_COLOR: Record<string, string> = {
  pending: colors.warning,
  confirmed: colors.primary,
  completed: colors.success,
  cancelled: colors.danger,
}

function formatPrice(v: any): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function CustomersScreen() {
  const role = useAuthStore((s) => s.role)
  const canManage = role === 'owner' || role === 'admin' || role === 'root'
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => api.get<any[]>('/tenant/customers'),
  })

  const filtered = customers?.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? '').includes(search)
  ) ?? []

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Clientes</Text>
          <Text style={styles.count}>{customers?.length ?? 0} cadastrados</Text>
        </View>
        {canManage && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setAddOpen(true)}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addBtnText}>Novo</Text>
          </TouchableOpacity>
        )}
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
          <TouchableOpacity activeOpacity={0.7} onPress={() => setDetailId(item.id)}>
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
                {item.email ? <Text style={styles.email}>{item.email}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </Card>
          </TouchableOpacity>
        )}
      />

      <AddCustomerModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false)
          queryClient.invalidateQueries({ queryKey: ['customers'] })
        }}
      />

      <CustomerDetailModal
        customerId={detailId}
        onClose={() => setDetailId(null)}
      />
    </SafeAreaView>
  )
}

// ── Add customer modal ────────────────────────────────────────────────────────
function AddCustomerModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  const reset = () => {
    setName('')
    setPhone('')
    setEmail('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      tenantApi.addCustomer({ name: name.trim(), phone: phone.trim(), email: email.trim() || undefined }),
    onSuccess: () => {
      reset()
      onCreated()
    },
    onError: (err: any) => {
      Alert.alert('Não foi possível salvar', err?.message ?? 'Tente novamente.')
    },
  })

  const canSubmit = name.trim().length > 0 && phone.trim().length >= 8 && !mutation.isPending

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Novo cliente</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>Nome *</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Nome do cliente"
            placeholderTextColor={colors.textDisabled}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.fieldLabel}>WhatsApp / Telefone *</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Ex: 5511999998888"
            placeholderTextColor={colors.textDisabled}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.fieldLabel}>E-mail (opcional)</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="email@exemplo.com"
            placeholderTextColor={colors.textDisabled}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <TouchableOpacity
            style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
            disabled={!canSubmit}
            onPress={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Salvar cliente</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

// ── Customer detail modal (enriched) ──────────────────────────────────────────
function CustomerDetailModal({
  customerId,
  onClose,
}: {
  customerId: string | null
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => tenantApi.customer(customerId!),
    enabled: !!customerId,
  })

  const interests: string[] = data?.interested_services
    ? String(data.interested_services)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    : []
  const appointments: any[] = data?.appointments ?? []

  return (
    <Modal visible={!!customerId} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalSheet, { maxHeight: '85%' }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {data?.name ?? 'Cliente'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Contact */}
              <View style={styles.detailContactRow}>
                <Ionicons name="logo-whatsapp" size={16} color={colors.whatsapp} />
                <Text style={styles.detailContactText}>{data?.phone}</Text>
              </View>
              {data?.email ? (
                <View style={styles.detailContactRow}>
                  <Ionicons name="mail-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.detailContactText}>{data.email}</Text>
                </View>
              ) : null}

              {/* Interest */}
              <Text style={styles.sectionTitle}>Interesse</Text>
              {interests.length > 0 ? (
                <View style={styles.chipWrap}>
                  {interests.map((s, i) => (
                    <View key={`${s}-${i}`} style={styles.chip}>
                      <Text style={styles.chipText}>{s}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.sectionEmpty}>Nenhum interesse registrado ainda.</Text>
              )}
              {data?.last_interest_at ? (
                <Text style={styles.metaText}>Último interesse em {data.last_interest_at}</Text>
              ) : null}

              {/* Services history */}
              <Text style={styles.sectionTitle}>Serviços realizados</Text>
              {appointments.length > 0 ? (
                appointments.map((a) => (
                  <View key={a.id} style={styles.apptRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.apptService}>{a.service_name}</Text>
                      <Text style={styles.apptMeta}>
                        {a.date} às {a.time}
                        {a.professional_name ? ` · ${a.professional_name}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      {a.price != null ? <Text style={styles.apptPrice}>{formatPrice(a.price)}</Text> : null}
                      <View
                        style={[
                          styles.statusBadge,
                          { backgroundColor: (STATUS_COLOR[a.status] ?? colors.textSecondary) + '22' },
                        ]}
                      >
                        <Text
                          style={[styles.statusText, { color: STATUS_COLOR[a.status] ?? colors.textSecondary }]}
                        >
                          {STATUS_LABEL[a.status] ?? a.status}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.sectionEmpty}>Nenhum atendimento registrado.</Text>
              )}
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    marginBottom: spacing.md,
  },
  title: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  count: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.md,
  },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
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

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  modalTitle: { fontSize: font.xl, fontWeight: '800', color: colors.text, flex: 1 },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: 6, marginTop: spacing.sm },
  fieldInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    fontSize: font.md,
    color: colors.text,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: font.md },

  // Detail
  detailContactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  detailContactText: { fontSize: font.md, color: colors.text },
  sectionTitle: { fontSize: font.md, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionEmpty: { fontSize: font.sm, color: colors.textSecondary },
  metaText: { fontSize: font.sm, color: colors.textDisabled, marginTop: 4 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  chipText: { fontSize: font.sm, color: colors.primary, fontWeight: '600' },
  apptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  apptService: { fontSize: font.md, fontWeight: '600', color: colors.text },
  apptMeta: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  apptPrice: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm },
  statusText: { fontSize: font.sm, fontWeight: '700' },
})
