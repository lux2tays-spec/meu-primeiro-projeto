import { useEffect, useState } from 'react'
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
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tenantApi, customersApi, customerFullName } from '@/lib/api'
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

// Open a WhatsApp chat with the customer (digits-only phone → wa.me).
async function openWhatsApp(phone?: string | null) {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (!digits) return
  const url = `https://wa.me/${digits}`
  try {
    await Linking.openURL(url)
  } catch {
    Alert.alert('WhatsApp', 'Não foi possível abrir o WhatsApp neste dispositivo.')
  }
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
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  // Busca no SERVIDOR com debounce — não filtra uma lista limitada localmente.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const { data: customers, isLoading, isError, refetch } = useQuery({
    queryKey: ['customers', debouncedSearch],
    queryFn: () => customersApi.list(debouncedSearch || undefined),
  })

  const filtered = customers ?? []

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Clientes</Text>
          <Text style={styles.count}>
            {filtered.length} {debouncedSearch ? 'encontrados' : 'cadastrados'}
          </Text>
        </View>
        {canManage && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setAddOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Adicionar novo cliente"
          >
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
          isError ? (
            <View style={styles.errorBox}>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.textDisabled} />
              <Text style={styles.empty}>Não foi possível carregar os clientes.</Text>
              <TouchableOpacity
                onPress={() => refetch()}
                style={styles.retryBtn}
                accessibilityRole="button"
                accessibilityLabel="Tentar carregar os clientes novamente"
              >
                <Text style={styles.retryText}>Tentar novamente</Text>
              </TouchableOpacity>
            </View>
          ) : isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
          ) : (
            <Text style={styles.empty}>Nenhum cliente encontrado</Text>
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.7} onPress={() => setDetailId(item.id)}>
            <Card style={styles.customerCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{customerFullName(item)}</Text>
                <TouchableOpacity
                  style={styles.phoneRow}
                  activeOpacity={0.6}
                  onPress={() => openWhatsApp(item.phone)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                >
                  <Ionicons name="logo-whatsapp" size={14} color={colors.whatsapp} />
                  <Text style={[styles.phone, styles.phoneLink]}>{item.phone}</Text>
                </TouchableOpacity>
                {item.email ? <Text style={styles.email}>{item.email}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </Card>
          </TouchableOpacity>
        )}
      />

      <AddCustomerModal
        visible={addOpen}
        initialName={search}
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
  initialName,
  onClose,
  onCreated,
}: {
  visible: boolean
  initialName?: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  // #7 — when the modal opens, carry the text the user already typed (search)
  // into the Nome field instead of starting blank.
  useEffect(() => {
    if (visible) {
      setName(initialName?.trim() ?? '')
      setLastName('')
      setPhone('')
      setEmail('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const mutation = useMutation({
    mutationFn: () =>
      tenantApi.addCustomer({
        name: name.trim(),
        last_name: lastName.trim() || undefined,
        phone: phone.trim(),
        email: email.trim() || undefined,
      }),
    onSuccess: () => {
      onCreated()
    },
    onError: (err: any) => {
      Alert.alert('Não foi possível salvar', err?.message ?? 'Tente novamente.')
    },
  })

  const canSubmit = name.trim().length > 0 && phone.trim().length >= 8 && !mutation.isPending

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Novo cliente</Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar">
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

          <Text style={styles.fieldLabel}>Sobrenome</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Sobrenome do cliente"
            placeholderTextColor={colors.textDisabled}
            value={lastName}
            onChangeText={setLastName}
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
      </KeyboardAvoidingView>
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
  const role = useAuthStore((s) => s.role)
  // Only owner/admin/root can edit/delete customers — staff cannot (#8)
  const canManage = role === 'owner' || role === 'admin' || role === 'root'
  const queryClient = useQueryClient()

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => tenantApi.customer(customerId!),
    enabled: !!customerId,
  })

  // Reset edit state whenever the modal opens for another customer
  useEffect(() => {
    setEditing(false)
  }, [customerId])

  const updateMutation = useMutation({
    mutationFn: () =>
      customersApi.update(customerId!, {
        name: editName.trim(),
        last_name: editLastName.trim() || undefined,
        phone: editPhone.replace(/\D/g, '') || undefined,
        email: editEmail.trim() || undefined,
      }),
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
    },
    onError: (err: any) => {
      Alert.alert('Não foi possível salvar', err?.message ?? 'Tente novamente.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => customersApi.remove(customerId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      onClose()
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? '')
      Alert.alert(
        'Não foi possível excluir',
        msg.includes('403') || /permiss/i.test(msg)
          ? 'Você não tem permissão para excluir clientes.'
          : msg || 'Tente novamente.'
      )
    },
  })

  function confirmDelete() {
    Alert.alert(
      'Excluir cliente',
      'Excluir este cliente e todo o histórico dele? Não pode ser desfeito.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ]
    )
  }

  function startEditing() {
    setEditName(data?.name ?? '')
    setEditLastName(data?.last_name ?? '')
    setEditPhone(data?.phone ?? '')
    setEditEmail(data?.email ?? '')
    setEditing(true)
  }

  // Telefone: vazio = mantém o atual; preenchido precisa ter ao menos 8 dígitos.
  const editPhoneOk = !editPhone.trim() || editPhone.replace(/\D/g, '').length >= 8

  const interests: string[] = data?.interested_services
    ? String(data.interested_services)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    : []
  const appointments: any[] = data?.appointments ?? []

  // SAL-22: total gasto pelo cliente (soma dos atendimentos concluídos).
  const totalSpent = appointments
    .filter((a) => a.status === 'completed')
    .reduce((sum, a) => sum + (Number(a.price) || 0), 0)

  // SAL-22: novo agendamento já com este cliente pré-selecionado.
  function startNewAppointment() {
    if (!data) return
    onClose()
    router.push({
      pathname: '/(app)/appointments/new',
      params: {
        prefillCustomerId: data.id,
        prefillCustomerName: customerFullName(data) || data.name || '',
        prefillCustomerPhone: data.phone ?? '',
      },
    })
  }

  return (
    <Modal visible={!!customerId} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.modalSheet, { maxHeight: '85%' }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {customerFullName(data) || 'Cliente'}
            </Text>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar">
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.xl }} />
          ) : editing ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Nome</Text>
              <TextInput style={styles.fieldInput} value={editName} onChangeText={setEditName}
                placeholder="Nome" placeholderTextColor={colors.textDisabled} />
              <Text style={styles.fieldLabel}>Sobrenome</Text>
              <TextInput style={styles.fieldInput} value={editLastName} onChangeText={setEditLastName}
                placeholder="Sobrenome" placeholderTextColor={colors.textDisabled} />
              <Text style={styles.fieldLabel}>WhatsApp / Telefone</Text>
              <TextInput style={styles.fieldInput} value={editPhone} onChangeText={setEditPhone}
                placeholder="Ex: 5511999998888" placeholderTextColor={colors.textDisabled}
                keyboardType="phone-pad" />
              <Text style={styles.fieldLabel}>E-mail</Text>
              <TextInput style={styles.fieldInput} value={editEmail} onChangeText={setEditEmail}
                placeholder="email@exemplo.com" placeholderTextColor={colors.textDisabled}
                autoCapitalize="none" keyboardType="email-address" />
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (!editName.trim() || !editPhoneOk || updateMutation.isPending) && styles.primaryBtnDisabled,
                ]}
                disabled={!editName.trim() || !editPhoneOk || updateMutation.isPending}
                accessibilityRole="button"
                accessibilityLabel="Salvar alterações do cliente"
                onPress={() => updateMutation.mutate()}>
                <Text style={styles.primaryBtnText}>{updateMutation.isPending ? 'Salvando...' : 'Salvar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { marginTop: spacing.sm }]} onPress={() => setEditing(false)}>
                <Text style={styles.secondaryBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Contact */}
              <TouchableOpacity
                style={styles.detailContactRow}
                activeOpacity={0.6}
                onPress={() => openWhatsApp(data?.phone)}
              >
                <Ionicons name="logo-whatsapp" size={16} color={colors.whatsapp} />
                <Text style={[styles.detailContactText, styles.phoneLink]}>{data?.phone}</Text>
              </TouchableOpacity>
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
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionTitle}>Serviços realizados</Text>
                {totalSpent > 0 && (
                  <Text style={styles.totalSpent}>Total gasto: {formatPrice(totalSpent)}</Text>
                )}
              </View>
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

              {/* SAL-22: agendar direto do perfil do cliente */}
              <TouchableOpacity
                style={styles.newApptBtn}
                onPress={startNewAppointment}
                accessibilityRole="button"
                accessibilityLabel="Novo agendamento para este cliente"
              >
                <Ionicons name="calendar-outline" size={18} color="#fff" />
                <Text style={styles.newApptBtnText}>Novo agendamento</Text>
              </TouchableOpacity>

              {/* Admin actions (#8) — only owner/admin/root */}
              {canManage && (
                <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={startEditing}>
                    <Ionicons name="create-outline" size={18} color={colors.primary} />
                    <Text style={styles.secondaryBtnText}>Editar cliente</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerBtn} onPress={confirmDelete} disabled={deleteMutation.isPending}>
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    <Text style={styles.dangerBtnText}>{deleteMutation.isPending ? 'Excluindo...' : 'Excluir cliente'}</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={{ height: spacing.xl }} />
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
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
  phoneLink: { color: colors.whatsapp, textDecorationLine: 'underline' },
  email: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.xl, fontSize: font.md },
  errorBox: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  retryBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.primaryLight,
  },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: font.sm },

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
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  secondaryBtnText: { color: colors.primary, fontWeight: '700', fontSize: font.md },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger + '55', backgroundColor: colors.danger + '11',
  },
  dangerBtnText: { color: colors.danger, fontWeight: '700', fontSize: font.md },

  // Detail
  detailContactRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  detailContactText: { fontSize: font.md, color: colors.text },
  sectionTitle: { fontSize: font.md, fontWeight: '800', color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitleRow: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    gap: spacing.sm, flexWrap: 'wrap',
  },
  totalSpent: { fontSize: font.sm, fontWeight: '700', color: colors.success },
  newApptBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.lg,
  },
  newApptBtnText: { color: '#fff', fontWeight: '700', fontSize: font.md },
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
