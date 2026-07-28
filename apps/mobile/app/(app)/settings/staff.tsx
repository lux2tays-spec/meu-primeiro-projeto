import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { tenantApi, professionalsApi, isPlanLimitError } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const ROLES = [
  { value: 'admin', label: 'Administrador', desc: 'Acesso completo exceto assinatura' },
  { value: 'staff', label: 'Colaborador', desc: 'Ver agenda e atualizar agendamentos' },
]

const OWNER_ROLE = { value: 'owner', label: 'Proprietário', desc: 'Acesso total, incluindo assinatura' }

const roleVariant: Record<string, any> = { owner: 'success', admin: 'info', staff: 'default' }
const roleLabel: Record<string, string> = { owner: 'Proprietário', admin: 'Admin', staff: 'Colaborador' }

type FormErrors = { name?: string; email?: string; password?: string }
const emptyForm = { name: '', email: '', password: '', role: 'staff', also_professional: false }

type EditErrors = { name?: string; email?: string }
const emptyEditForm = { name: '', email: '', phone: '', role: 'staff' }

const emptyProfForm = { name: '', phone: '', bio: '' }

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

  // Profissional (com ou sem acesso ao app) — criar/editar nome, telefone e bio
  const [profModalVisible, setProfModalVisible] = useState(false)
  const [profEditing, setProfEditing] = useState<any>(null)
  const [profForm, setProfForm] = useState(emptyProfForm)
  const [profError, setProfError] = useState<string | undefined>(undefined)

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
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  function isProfessional(userId: string) {
    return (professionals as any[]).some((p) => p.user_id === userId)
  }

  function professionalId(userId: string) {
    return (professionals as any[]).find((p) => p.user_id === userId)?.id
  }

  const inviteMutation = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      const member = await tenantApi.addStaff({ name: data.name, email: data.email, password: data.password, role: data.role })
      if (data.also_professional) {
        await tenantApi.addProfessional({ name: data.name, user_id: member.id })
      }
      return member
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      setModalVisible(false)
      setForm(emptyForm)
      toast.show('Colaborador adicionado!', 'success')
    },
    onError: (err: any) => {
      const msg: string = err.message ?? ''
      if (isPlanLimitError(err)) {
        showPlanLimitToast()
      } else if (msg.toLowerCase().includes('email') || msg.toLowerCase().includes('e-mail')) {
        setErrors((e) => ({ ...e, email: 'Este e-mail já está em uso' }))
      } else {
        toast.show(msg || 'Não foi possível adicionar o colaborador.', 'error')
      }
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => tenantApi.removeStaff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff'] })
      setRemoveTarget(null)
      toast.show('Colaborador removido.', 'info')
    },
    onError: (err: any) => {
      setRemoveTarget(null)
      Alert.alert('Não foi possível remover', err.message ?? 'Tente novamente.')
    },
  })

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
      closeEditModal()
      toast.show('Colaborador atualizado!', 'success')
    },
    onError: (err: any) => {
      Alert.alert('Não foi possível salvar', err.message ?? 'Tente novamente.')
    },
  })

  const addAsProfessional = useMutation({
    mutationFn: ({ userId, name }: { userId: string; name: string }) =>
      tenantApi.addProfessional({ name, user_id: userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      toast.show('Habilitado como profissional!', 'success')
    },
    onError: (err: any) => {
      if (isPlanLimitError(err)) showPlanLimitToast()
      else toast.show(err.message ?? 'Não foi possível habilitar como profissional.', 'error')
    },
  })

  const removeAsProfessional = useMutation({
    mutationFn: tenantApi.removeProfessional,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      toast.show('Removido como profissional.', 'info')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível remover.', 'error'),
  })

  // Cria profissional SEM usuário (sem acesso ao app) — POST /professionals sem user_id.
  const createProfMutation = useMutation({
    mutationFn: (data: typeof emptyProfForm) =>
      professionalsApi.create({
        name: data.name.trim(),
        phone: data.phone.trim() || undefined,
        bio: data.bio.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      closeProfModal()
      toast.show('Profissional adicionado!', 'success')
    },
    onError: (err: any) => {
      if (isPlanLimitError(err)) showPlanLimitToast()
      else toast.show(err.message ?? 'Não foi possível adicionar o profissional.', 'error')
    },
  })

  // Edita nome/telefone/bio de qualquer profissional — PATCH /professionals/:id.
  const updateProfMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof emptyProfForm }) =>
      professionalsApi.update(id, {
        name: data.name.trim(),
        phone: data.phone.trim() || null,
        bio: data.bio.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      closeProfModal()
      toast.show('Profissional atualizado!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar o profissional.', 'error'),
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

  function openProfCreate() {
    setProfEditing(null)
    setProfForm(emptyProfForm)
    setProfError(undefined)
    setProfModalVisible(true)
  }

  function openProfEdit(p: any) {
    setProfEditing(p)
    setProfForm({ name: p.name ?? '', phone: p.phone ?? '', bio: p.bio ?? '' })
    setProfError(undefined)
    setProfModalVisible(true)
  }

  function closeProfModal() {
    setProfModalVisible(false)
    setProfEditing(null)
    setProfForm(emptyProfForm)
    setProfError(undefined)
  }

  function handleSaveProf() {
    if (!profForm.name.trim()) {
      setProfError('Informe o nome do profissional')
      return
    }
    if (profEditing) updateProfMutation.mutate({ id: profEditing.id, data: profForm })
    else createProfMutation.mutate(profForm)
  }

  function confirmRemoveProf(p: any) {
    Alert.alert(
      'Remover profissional',
      `${p.name} deixará de aparecer na agenda e nos serviços.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeAsProfessional.mutate(p.id) },
      ]
    )
  }

  function handleToggleProfessional(u: any) {
    const isProf = isProfessional(u.id)
    const profId = professionalId(u.id)
    if (isProf) {
      Alert.alert('Remover como profissional', `${u.name} não poderá mais ser selecionado para serviços.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeAsProfessional.mutate(profId) },
      ])
    } else {
      addAsProfessional.mutate({ userId: u.id, name: u.name })
    }
  }

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <FlatList
        data={staff as any[]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          canManage
            ? <Button label="+ Adicionar colaborador" onPress={() => setModalVisible(true)} style={{ marginBottom: spacing.md }} />
            : null
        }
        ListEmptyComponent={<Text style={s.empty}>Nenhum colaborador cadastrado</Text>}
        ListFooterComponent={
          <View style={s.profSection}>
            <Text style={s.profSectionTitle}>Profissionais</Text>
            <Text style={s.profSectionHint}>
              Quem aparece na agenda e nos serviços. Um profissional pode ou não ter acesso ao app.
            </Text>
            {(professionals as any[]).length === 0 ? (
              <Text style={s.profEmpty}>Nenhum profissional cadastrado.</Text>
            ) : (
              (professionals as any[]).map((p) => (
                <Card key={p.id} style={s.profCard}>
                  <View style={s.profAvatar}>
                    <Ionicons name="person-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.nameRow}>
                      <Text style={s.name}>{p.name}</Text>
                      {!p.user_id && <Badge label="Sem acesso ao app" variant="warning" />}
                    </View>
                    {p.phone ? <Text style={s.email}>{p.phone}</Text> : null}
                    {p.bio ? <Text style={s.profBio} numberOfLines={2}>{p.bio}</Text> : null}
                  </View>
                  {canManage && (
                    <View style={s.cardActions}>
                      <TouchableOpacity
                        onPress={() => openProfEdit(p)}
                        style={{ padding: 4 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Editar profissional ${p.name}`}
                      >
                        <Ionicons name="create-outline" size={18} color={colors.primary} />
                      </TouchableOpacity>
                      {!p.user_id && (
                        <TouchableOpacity
                          onPress={() => confirmRemoveProf(p)}
                          style={{ padding: 4 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Remover profissional ${p.name}`}
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </Card>
              ))
            )}
            {canManage && (
              <Button
                label="+ Adicionar profissional (sem acesso)"
                variant="outline"
                onPress={openProfCreate}
              />
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isProf = isProfessional(item.id)
          return (
            <Card style={s.card}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.nameRow}>
                  <Text style={s.name}>{item.name}</Text>
                  <Badge label={roleLabel[item.role] ?? item.role} variant={roleVariant[item.role] ?? 'default'} />
                  {isProf && <Badge label="Profissional" variant="info" />}
                </View>
                <Text style={s.email}>{item.email}</Text>
                {/* Professional toggle */}
                {canManage && (
                  <TouchableOpacity
                    style={[s.proToggle, isProf && s.proToggleActive]}
                    onPress={() => handleToggleProfessional(item)}
                    disabled={addAsProfessional.isPending || removeAsProfessional.isPending}
                  >
                    <Ionicons
                      name={isProf ? 'checkmark-circle' : 'add-circle-outline'}
                      size={14}
                      color={isProf ? colors.primary : colors.textSecondary}
                    />
                    <Text style={[s.proToggleText, isProf && s.proToggleTextActive]}>
                      {isProf ? 'Presta serviços' : 'Habilitar para serviços'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {canManage && (
                <View style={s.cardActions}>
                  <TouchableOpacity
                    onPress={() => openEditModal(item)}
                    style={{ padding: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Editar colaborador ${item.name}`}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.primary} />
                  </TouchableOpacity>
                  {item.id !== myUserId && (
                    <TouchableOpacity
                      onPress={() => setRemoveTarget({ id: item.id, name: item.name })}
                      style={{ padding: 4 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remover colaborador ${item.name}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </Card>
          )
        }}
      />

      {/* Add modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={s.modal} edges={['top']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Novo colaborador</Text>
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

            {/* Also professional */}
            <TouchableOpacity style={s.checkRow} onPress={() => setForm((f) => ({ ...f, also_professional: !f.also_professional }))}>
              <View style={[s.checkbox, form.also_professional && s.checkboxChecked]}>
                {form.also_professional && <Ionicons name="checkmark" size={13} color="#fff" />}
              </View>
              <Text style={s.checkLabel}>Também presta serviços (cadastrar como profissional)</Text>
            </TouchableOpacity>

            <Button label="Adicionar colaborador" onPress={() => { if (validate()) inviteMutation.mutate(form) }} loading={inviteMutation.isPending} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Edit modal */}
      <Modal visible={!!editTarget} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeEditModal}>
        <SafeAreaView style={s.modal} edges={['top']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Editar colaborador</Text>
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

      {/* Professional create/edit modal */}
      <Modal visible={profModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeProfModal}>
        <SafeAreaView style={s.modal} edges={['top']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>
              {profEditing ? 'Editar profissional' : 'Novo profissional'}
            </Text>
            <TouchableOpacity onPress={closeProfModal} accessibilityRole="button" accessibilityLabel="Fechar">
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
            {!profEditing && (
              <Text style={s.profSectionHint}>
                Profissional que atende na agenda mas não usa o app (ex.: um prestador externo).
                Ele não recebe login nem senha.
              </Text>
            )}
            <Input
              label="Nome *"
              value={profForm.name}
              onChangeText={(v) => { setProfForm((f) => ({ ...f, name: v })); setProfError(undefined) }}
              placeholder="Maria Silva"
              error={profError}
            />
            <Input
              label="Telefone"
              value={profForm.phone}
              onChangeText={(v) => setProfForm((f) => ({ ...f, phone: v }))}
              placeholder="(11) 99999-9999"
              keyboardType="phone-pad"
            />
            <Input
              label="Bio (opcional)"
              value={profForm.bio}
              onChangeText={(v) => setProfForm((f) => ({ ...f, bio: v }))}
              placeholder="Especialidades, mini currículo..."
              multiline
              numberOfLines={3}
              style={{ height: undefined, paddingVertical: spacing.md, textAlignVertical: 'top' }}
            />
            <Button
              label={profEditing ? 'Salvar alterações' : 'Adicionar profissional'}
              onPress={handleSaveProf}
              loading={createProfMutation.isPending || updateProfMutation.isPending}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <ConfirmDialog
        visible={!!removeTarget}
        title="Remover colaborador"
        message={`Remover ${removeTarget?.name ?? ''} da equipe? Ele perderá o acesso imediatamente.`}
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
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardActions: { flexDirection: 'column', gap: spacing.sm },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  avatarText: { fontSize: font.md, fontWeight: '700', color: colors.primary },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  name: { fontSize: font.md, fontWeight: '600', color: colors.text },
  email: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  proToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: spacing.sm, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: radius.full, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  proToggleActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  proToggleText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  proToggleTextActive: { color: colors.primary },
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
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 2,
    borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkLabel: { flex: 1, fontSize: font.sm, color: colors.text },
  // Profissionais
  profSection: { marginTop: spacing.xl, gap: spacing.sm },
  profSectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  profSectionHint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  profEmpty: { fontSize: font.sm, color: colors.textDisabled, fontStyle: 'italic', paddingVertical: spacing.sm },
  profCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  profAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  profBio: { fontSize: font.sm, color: colors.textDisabled, marginTop: 2 },
})
