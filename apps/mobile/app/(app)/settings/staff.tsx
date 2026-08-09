import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { tenantApi, isPlanLimitError } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

// Equipe = Profissionais: cada membro tem acesso ao app (login) E aparece na
// agenda/serviços. Não há mais "profissional externo sem acesso". Os itens abaixo
// são níveis de ACESSO (permissão), não tipos de pessoa.
const ROLES = [
  { value: 'admin', label: 'Administrador', desc: 'Acesso completo exceto assinatura' },
  { value: 'staff', label: 'Colaborador', desc: 'Ver agenda e atualizar agendamentos' },
]

const OWNER_ROLE = { value: 'owner', label: 'Proprietário', desc: 'Acesso total, incluindo assinatura' }

const roleVariant: Record<string, any> = { owner: 'success', admin: 'info', staff: 'default' }
const roleLabel: Record<string, string> = { owner: 'Proprietário', admin: 'Admin', staff: 'Colaborador' }

type FormErrors = { name?: string; email?: string; password?: string }
const emptyForm = { name: '', email: '', password: '', role: 'staff' }

type EditErrors = { name?: string; email?: string }
const emptyEditForm = { name: '', email: '', phone: '', role: 'staff' }

function validateEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) }

export default function StaffScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [editTarget, setEditTarget] = useState<any>(null)
  const [editForm, setEditForm] = useState(emptyEditForm)
  const [editErrors, setEditErrors] = useState<EditErrors>({})

  const role = useAuthStore((s) => s.role)
  const myUserId = useAuthStore((s) => s.userId)
  const canManage = ['owner', 'admin', 'root'].includes(role ?? '')
  const isOwner = role === 'owner' || role === 'root'
  // "Proprietário" só aparece como opção para quem é owner/root (CFG-10).
  const editRoles = isOwner ? [OWNER_ROLE, ...ROLES] : ROLES

  // CTA padrão quando o backend recusa por limite do plano (HTTP 402).
  function showPlanLimitToast() {
    toast.show(
      'Você atingiu o limite do seu plano. Faça upgrade para adicionar mais.',
      'warning',
      { label: 'Ver planos', onPress: () => router.push('/(app)/settings/subscription') }
    )
  }

  const { data: staff = [] } = useQuery({ queryKey: ['staff'], queryFn: tenantApi.staff })

  // Adiciona um membro. O backend cria automaticamente o profissional vinculado
  // (todo membro é agendável), então não há passo/opção extra aqui.
  const inviteMutation = useMutation({
    mutationFn: (data: typeof emptyForm) =>
      tenantApi.addStaff({ name: data.name, email: data.email, password: data.password, role: data.role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      setModalVisible(false)
      setForm(emptyForm)
      toast.show('Membro adicionado!', 'success')
    },
    onError: (err: any) => {
      const msg: string = err.message ?? ''
      if (isPlanLimitError(err)) {
        showPlanLimitToast()
      } else if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('e-mail')) {
        setErrors((e) => ({ ...e, email: 'Este e-mail já está em uso' }))
      } else {
        toast.show(msg || 'Não foi possível adicionar o membro.', 'error')
      }
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => tenantApi.removeStaff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      setRemoveTarget(null)
      toast.show('Membro removido.', 'info')
    },
    onError: (err: any) => {
      setRemoveTarget(null)
      toast.show(err.message ?? 'Não foi possível remover.', 'error')
    },
  })

  // Editar nome sincroniza o nome do profissional no backend (agenda/serviços).
  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof emptyEditForm }) =>
      tenantApi.editStaff(id, {
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim() || null,
        role: data.role,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      closeEditModal()
      toast.show('Membro atualizado!', 'success')
    },
    onError: (err: any) => {
      toast.show(err.message ?? 'Não foi possível salvar.', 'error')
    },
  })

  function setField(key: keyof typeof emptyForm) {
    return (v: string) => {
      setForm((f) => ({ ...f, [key]: v }))
      if (errors[key as keyof FormErrors]) setErrors((e) => ({ ...e, [key]: undefined }))
    }
  }

  function validate() {
    const e: FormErrors = {}
    if (!form.name.trim()) e.name = 'Informe o nome'
    if (!form.email.trim()) e.email = 'Informe o e-mail'
    else if (!validateEmail(form.email)) e.email = 'E-mail inválido'
    if (!form.password) e.password = 'Informe uma senha inicial'
    else if (form.password.length < 6) e.password = 'Mínimo 6 caracteres'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function closeModal() { setModalVisible(false); setForm(emptyForm); setErrors({}) }

  function openEditModal(u: any) {
    setEditTarget(u)
    setEditForm({ name: u.name ?? '', email: u.email ?? '', phone: u.phone ?? '', role: u.role })
    setEditErrors({})
  }

  function closeEditModal() { setEditTarget(null); setEditForm(emptyEditForm); setEditErrors({}) }

  function setEditField(key: keyof typeof emptyEditForm) {
    return (v: string) => {
      setEditForm((f) => ({ ...f, [key]: v }))
      if (editErrors[key as keyof EditErrors]) setEditErrors((e) => ({ ...e, [key]: undefined }))
    }
  }

  function validateEdit() {
    const e: EditErrors = {}
    if (!editForm.name.trim()) e.name = 'Informe o nome'
    if (!editForm.email.trim()) e.email = 'Informe o e-mail'
    else if (!validateEmail(editForm.email.trim())) e.email = 'E-mail inválido'
    setEditErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSaveEdit() {
    if (!editTarget || !validateEdit()) return
    editMutation.mutate({ id: editTarget.id, data: editForm })
  }

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <FlatList
        data={staff as any[]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <View style={{ marginBottom: spacing.md, gap: spacing.sm }}>
            <Text style={s.headerHint}>
              Todos da equipe têm acesso ao app e aparecem na agenda e nos serviços.
            </Text>
            {canManage && (
              <Button label="+ Adicionar à equipe" onPress={() => setModalVisible(true)} />
            )}
          </View>
        }
        ListEmptyComponent={<Text style={s.empty}>Nenhum membro na equipe</Text>}
        renderItem={({ item }) => (
          <Card style={s.card}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={s.name}>{item.name}</Text>
                <Badge label={roleLabel[item.role] ?? item.role} variant={roleVariant[item.role] ?? 'default'} />
              </View>
              <Text style={s.email}>{item.email}</Text>
            </View>
            {canManage && (
              <View style={s.cardActions}>
                <TouchableOpacity
                  onPress={() => openEditModal(item)}
                  style={{ padding: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Editar ${item.name}`}
                >
                  <Ionicons name="create-outline" size={18} color={colors.primary} />
                </TouchableOpacity>
                {item.id !== myUserId && (
                  <TouchableOpacity
                    onPress={() => setRemoveTarget({ id: item.id, name: item.name })}
                    style={{ padding: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Remover ${item.name}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Card>
        )}
      />

      {/* Add modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={s.modal} edges={['top']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Novo membro</Text>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
            <Input label="Nome *" value={form.name} onChangeText={setField('name')} placeholder="Maria Silva" error={errors.name} />
            <Input label="E-mail *" value={form.email} onChangeText={setField('email')} placeholder="maria@email.com" keyboardType="email-address" autoCapitalize="none" error={errors.email} />
            <Input label="Senha inicial *" value={form.password} onChangeText={setField('password')} placeholder="Mínimo 6 caracteres" secureTextEntry error={errors.password} />

            <View style={s.field}>
              <Text style={s.fieldLabel}>Nível de acesso</Text>
              {ROLES.map((r) => (
                <TouchableOpacity key={r.value} style={[s.roleBtn, form.role === r.value && s.roleBtnActive]}
                  onPress={() => setForm((f) => ({ ...f, role: r.value }))}>
                  <Text style={[s.roleName, form.role === r.value && s.roleNameActive]}>{r.label}</Text>
                  <Text style={s.roleDesc}>{r.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.headerHint}>
              O novo membro já entra como profissional agendável — não precisa de cadastro à parte.
            </Text>

            <Button label="Adicionar à equipe" onPress={() => { if (validate()) inviteMutation.mutate(form) }} loading={inviteMutation.isPending} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editTarget} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditModal}>
        <SafeAreaView style={s.modal} edges={['top']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Editar membro</Text>
            <TouchableOpacity onPress={closeEditModal}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
            <Input label="Nome *" value={editForm.name} onChangeText={setEditField('name')} placeholder="Maria Silva" error={editErrors.name} />
            <Input label="E-mail *" value={editForm.email} onChangeText={setEditField('email')} placeholder="maria@email.com" keyboardType="email-address" autoCapitalize="none" error={editErrors.email} />
            <Input label="Telefone" value={editForm.phone} onChangeText={setEditField('phone')} placeholder="(11) 99999-9999" keyboardType="phone-pad" />

            <View style={s.field}>
              <Text style={s.fieldLabel}>Nível de acesso</Text>
              {editTarget?.role === 'owner' && !isOwner ? (
                // Admin não pode alterar o papel do proprietário.
                <View style={[s.roleBtn, s.roleBtnActive]}>
                  <Text style={s.roleName}>Proprietário</Text>
                  <Text style={s.roleDesc}>Somente o proprietário pode alterar este nível de acesso</Text>
                </View>
              ) : (
                editRoles.map((r) => (
                  <TouchableOpacity key={r.value} style={[s.roleBtn, editForm.role === r.value && s.roleBtnActive]}
                    onPress={() => setEditForm((f) => ({ ...f, role: r.value }))}>
                    <Text style={[s.roleName, editForm.role === r.value && s.roleNameActive]}>{r.label}</Text>
                    <Text style={s.roleDesc}>{r.desc}</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <Button label="Salvar alterações" onPress={handleSaveEdit} loading={editMutation.isPending} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <ConfirmDialog
        visible={!!removeTarget}
        title="Remover da equipe"
        message={`Remover ${removeTarget?.name ?? ''} da equipe? Ele perderá o acesso e deixará de aparecer na agenda.`}
        confirmLabel="Remover"
        loading={removeMutation.isPending}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget.id)}
        onCancel={() => setRemoveTarget(null)}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg },
  headerHint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardActions: { flexDirection: 'column', gap: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  avatarText: { fontSize: font.md, fontWeight: '700', color: colors.primary },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  name: { fontSize: font.md, fontWeight: '600', color: colors.text },
  email: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.xl, fontSize: font.md },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  modalContent: { padding: spacing.lg, gap: spacing.md },
  field: { gap: spacing.sm },
  fieldLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  roleBtn: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border },
  roleBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  roleNameActive: { color: colors.primaryDark },
  roleDesc: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
})
