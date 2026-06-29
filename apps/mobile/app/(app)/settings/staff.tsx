import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { tenantApi, api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const ROLES = [
  { value: 'admin', label: 'Administrador', desc: 'Acesso completo exceto assinatura' },
  { value: 'staff', label: 'Colaborador', desc: 'Ver agenda e atualizar agendamentos' },
]

const roleVariant: Record<string, any> = { owner: 'success', admin: 'info', staff: 'default' }
const roleLabel: Record<string, string> = { owner: 'Proprietário', admin: 'Admin', staff: 'Colaborador' }

type FormErrors = { name?: string; email?: string; password?: string }
const emptyForm = { name: '', email: '', password: '', role: 'staff', also_professional: false }

function validateEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) }

export default function StaffScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [modalVisible, setModalVisible] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

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
      if (msg.toLowerCase().includes('limite')) {
        toast.show('Limite de usuários do seu plano atingido.', 'warning')
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
    onError: (err: any) => { setRemoveTarget(null); toast.show(err.message ?? 'Não foi possível remover.', 'error') },
  })

  const addAsProfessional = useMutation({
    mutationFn: ({ userId, name }: { userId: string; name: string }) =>
      tenantApi.addProfessional({ name, user_id: userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      toast.show('Habilitado como profissional!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Erro ao habilitar.', 'error'),
  })

  const removeAsProfessional = useMutation({
    mutationFn: tenantApi.removeProfessional,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['professionals'] })
      toast.show('Removido como profissional.', 'info')
    },
    onError: (err: any) => toast.show(err.message ?? 'Erro ao remover.', 'error'),
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
          <Button label="+ Adicionar colaborador" onPress={() => setModalVisible(true)} style={{ marginBottom: spacing.md }} />
        }
        ListEmptyComponent={<Text style={s.empty}>Nenhum colaborador cadastrado</Text>}
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
              </View>
              {item.role !== 'owner' && (
                <TouchableOpacity onPress={() => setRemoveTarget({ id: item.id, name: item.name })} style={{ padding: 4 }}>
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </TouchableOpacity>
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
})
