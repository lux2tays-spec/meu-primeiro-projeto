import { View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { tenantApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const REMINDER_OPTIONS = [
  { label: 'Sem lembrete', value: null },
  { label: '7 dias', value: 7 },
  { label: '14 dias', value: 14 },
  { label: '21 dias', value: 21 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

const emptyForm = {
  name: '',
  description: '',
  duration_minutes: '60',
  price: '',
  reminder_days: null as number | null,
  professional_ids: [] as string[],
}
type FormErrors = { name?: string; duration_minutes?: string; price?: string }

export default function ServicesScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [modalVisible, setModalVisible] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: tenantApi.services })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  const createMutation = useMutation({
    mutationFn: (data: any) => tenantApi.createService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      closeModal()
      toast.show('Serviço adicionado com sucesso!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar o serviço.', 'error'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => tenantApi.updateService(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      closeModal()
      toast.show('Serviço atualizado!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível atualizar.', 'error'),
  })

  const deleteMutation = useMutation({
    mutationFn: tenantApi.deleteService,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] })
      toast.show('Serviço excluído.', 'success')
    },
    onError: (err: any) => toast.show(err.message, 'error'),
  })

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setErrors({})
    setModalVisible(true)
  }

  function openEdit(item: any) {
    setEditing(item)
    setForm({
      name: item.name,
      description: item.description ?? '',
      duration_minutes: String(item.duration_minutes),
      price: Number(item.price).toFixed(2).replace('.', ','),
      reminder_days: item.reminder_days ?? null,
      professional_ids: (item.professionals ?? []).map((p: any) => p.id),
    })
    setErrors({})
    setModalVisible(true)
  }

  function closeModal() {
    setModalVisible(false)
    setEditing(null)
    setForm(emptyForm)
    setErrors({})
  }

  function setField(key: keyof typeof emptyForm) {
    return (v: string) => {
      setForm((f) => ({ ...f, [key]: v }))
      if (errors[key as keyof FormErrors]) setErrors((e) => ({ ...e, [key]: undefined }))
    }
  }

  function toggleProfessional(id: string) {
    setForm((f) => ({
      ...f,
      professional_ids: f.professional_ids.includes(id)
        ? f.professional_ids.filter((x) => x !== id)
        : [...f.professional_ids, id],
    }))
  }

  function validate() {
    const e: FormErrors = {}
    if (!form.name.trim()) e.name = 'Informe o nome do serviço'
    const dur = Number(form.duration_minutes)
    if (!form.duration_minutes || isNaN(dur) || dur <= 0) e.duration_minutes = 'Duração inválida'
    const price = parseFloat(form.price.replace(',', '.'))
    if (!form.price || isNaN(price) || price < 0) e.price = 'Preço inválido'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSave() {
    if (!validate()) return
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      duration_minutes: Number(form.duration_minutes),
      price: parseFloat(form.price.replace(',', '.')),
      reminder_days: form.reminder_days,
      professional_ids: form.professional_ids,
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  function confirmDelete(item: any) {
    Alert.alert(
      'Excluir serviço',
      `Deseja excluir "${item.name}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: () => deleteMutation.mutate(item.id) },
      ]
    )
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <SafeAreaView style={s.container} edges={[]}>
      <FlatList
        data={services as any[]}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <Button label="+ Adicionar serviço" onPress={openCreate} style={s.addBtn} />
        }
        ListEmptyComponent={
          <Text style={s.empty}>Nenhum serviço cadastrado</Text>
        }
        renderItem={({ item }) => (
          <Card style={s.serviceCard}>
            <View style={{ flex: 1 }}>
              <Text style={s.serviceName}>{item.name}</Text>
              {item.description ? <Text style={s.serviceDesc}>{item.description}</Text> : null}
              <View style={s.serviceMeta}>
                <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                <Text style={s.serviceMetaText}>{item.duration_minutes} min</Text>
                <Text style={s.dot}>·</Text>
                <Text style={s.servicePrice}>
                  R$ {Number(item.price).toFixed(2).replace('.', ',')}
                </Text>
              </View>
              {/* Lembrete */}
              {item.reminder_days > 0 && (
                <View style={s.reminderBadge}>
                  <Ionicons name="notifications-outline" size={12} color={colors.warning} />
                  <Text style={s.reminderBadgeText}>Lembrete em {item.reminder_days} dias</Text>
                </View>
              )}
              {/* Profissionais vinculados */}
              {item.professionals?.length > 0 && (
                <View style={s.prosRow}>
                  {item.professionals.map((p: any) => (
                    <View key={p.id} style={s.proChip}>
                      <Text style={s.proChipText}>{p.name}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={s.cardActions}>
              <TouchableOpacity onPress={() => openEdit(item)} style={s.iconBtn}>
                <Ionicons name="create-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(item)} style={s.iconBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </Card>
        )}
      />

      {/* Modal criar / editar */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={s.modal} edges={['top']}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{editing ? 'Editar Serviço' : 'Novo Serviço'}</Text>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
            <Input
              label="Nome do serviço *"
              value={form.name}
              onChangeText={setField('name')}
              placeholder="Ex: Limpeza de pele"
              error={errors.name}
            />
            <Input
              label="Descrição (opcional)"
              value={form.description}
              onChangeText={setField('description')}
              placeholder="Breve descrição do serviço"
            />
            <Input
              label="Duração (minutos) *"
              value={form.duration_minutes}
              onChangeText={setField('duration_minutes')}
              keyboardType="number-pad"
              placeholder="60"
              error={errors.duration_minutes}
            />
            <Input
              label="Preço (R$) *"
              value={form.price}
              onChangeText={setField('price')}
              keyboardType="decimal-pad"
              placeholder="150,00"
              error={errors.price}
            />

            {/* Período de lembrete */}
            <View style={s.proSection}>
              <Text style={s.proSectionLabel}>Período para lembrar os clientes</Text>
              <Text style={s.reminderHint}>
                O cliente receberá uma mensagem no WhatsApp após este período sugerindo agendar novamente.
              </Text>
              <View style={s.proChipsWrap}>
                {REMINDER_OPTIONS.map((opt) => {
                  const selected = form.reminder_days === opt.value
                  return (
                    <TouchableOpacity
                      key={String(opt.value)}
                      onPress={() => setForm((f) => ({ ...f, reminder_days: opt.value }))}
                      style={[s.proSelectChip, selected && s.proSelectChipActive]}
                    >
                      {selected && <Ionicons name="checkmark" size={13} color="#fff" style={{ marginRight: 3 }} />}
                      <Text style={[s.proSelectChipText, selected && s.proSelectChipTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            {/* Seleção de profissionais */}
            <View style={s.proSection}>
              <Text style={s.proSectionLabel}>Profissionais que realizam este serviço</Text>
              {(professionals as any[]).length === 0 ? (
                <Text style={s.proEmptyHint}>
                  Nenhum profissional cadastrado. Vá em Configurações → Colaboradores e habilite alguém para prestar serviços.
                </Text>
              ) : (
                <View style={s.proChipsWrap}>
                  {(professionals as any[]).map((p) => {
                    const selected = form.professional_ids.includes(p.id)
                    return (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => toggleProfessional(p.id)}
                        style={[s.proSelectChip, selected && s.proSelectChipActive]}
                      >
                        {selected && (
                          <Ionicons name="checkmark" size={13} color="#fff" style={{ marginRight: 3 }} />
                        )}
                        <Text style={[s.proSelectChipText, selected && s.proSelectChipTextActive]}>
                          {p.name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              )}
            </View>

            <Button
              label={editing ? 'Salvar alterações' : 'Salvar serviço'}
              onPress={handleSave}
              loading={isPending}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg },
  addBtn: { marginBottom: spacing.md },
  serviceCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  serviceName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  serviceDesc: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  serviceMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  serviceMetaText: { fontSize: font.sm, color: colors.textSecondary },
  dot: { color: colors.textDisabled },
  servicePrice: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  prosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.sm },
  proChip: {
    backgroundColor: colors.primaryLight, borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  proChipText: { fontSize: 11, color: colors.primary, fontWeight: '600' },
  cardActions: { flexDirection: 'column', gap: spacing.sm, paddingTop: 2 },
  iconBtn: { padding: 4 },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.xl, fontSize: font.md },
  // Modal
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.lg,
  },
  modalTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  modalContent: { padding: spacing.lg, gap: spacing.md },
  // Professional selection
  proSection: { gap: spacing.sm },
  proSectionLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  proChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  proSelectChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  proSelectChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  proSelectChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  proSelectChipTextActive: { color: '#fff' },
  proEmptyHint: { fontSize: font.sm, color: colors.textDisabled, fontStyle: 'italic' },
  reminderHint: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  reminderBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.xs },
  reminderBadgeText: { fontSize: 11, color: colors.warning, fontWeight: '600' },
})
