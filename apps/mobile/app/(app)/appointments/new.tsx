import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { tenantApi, appointmentsApi, slotsApi, api } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

type Step = 'professional' | 'service' | 'customer' | 'datetime' | 'confirm'

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={si.row}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[si.dot, i < current && si.dotDone, i === current - 1 && si.dotCurrent]} />
      ))}
    </View>
  )
}
const si = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotCurrent: { backgroundColor: colors.primary, width: 24 },
  dotDone: { backgroundColor: colors.primary },
})

const STEPS: Step[] = ['professional', 'service', 'customer', 'datetime', 'confirm']

function toDateStr(d: Date) { return d.toISOString().split('T')[0] }

export default function NewAppointmentScreen() {
  const toast = useToast()
  const { prefillDate } = useLocalSearchParams<{ prefillDate?: string }>()

  const [step, setStep] = useState<Step>('professional')
  const [selected, setSelected] = useState<{
    professional?: any
    service?: any
    customer?: any
    slot?: string
    date?: string
    notes?: string
  }>({ date: prefillDate ?? toDateStr(new Date()) })

  const [customerSearch, setCustomerSearch] = useState('')
  const [newCustomerName, setNewCustomerName] = useState('')
  const [newCustomerPhone, setNewCustomerPhone] = useState('')
  const [isNewCustomer, setIsNewCustomer] = useState(false)

  const { data: professionals, isLoading: loadingPros } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: tenantApi.services })
  const { data: customers } = useQuery({ queryKey: ['customers'], queryFn: () => api.get<any[]>('/tenant/customers') })

  const { data: slots, isLoading: loadingSlots } = useQuery({
    queryKey: ['slots', selected.professional?.id, selected.service?.id, selected.date],
    queryFn: () => slotsApi.getSlots(selected.professional!.id, selected.service!.id, selected.date!),
    enabled: step === 'datetime' && !!selected.professional && !!selected.service && !!selected.date,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      let customerId = selected.customer?.id

      // Create customer if new
      if (isNewCustomer) {
        const newCust = await api.post<any>('/tenant/customers', {
          name: newCustomerName,
          phone: newCustomerPhone,
        })
        customerId = newCust.id
      }

      return appointmentsApi.create({
        customer_id: customerId,
        professional_id: selected.professional!.id,
        service_id: selected.service!.id,
        starts_at: selected.slot!,
        notes: selected.notes || undefined,
      })
    },
    onSuccess: () => {
      toast.show('Agendamento criado com sucesso!', 'success')
      router.back()
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível criar o agendamento.', 'error'),
  })

  const stepIndex = STEPS.indexOf(step) + 1
  const filteredCustomers = customers?.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone.includes(customerSearch)
  ) ?? []

  const dateObj = new Date(selected.date + 'T12:00:00')

  function prevStep() {
    const idx = STEPS.indexOf(step)
    if (idx > 0) setStep(STEPS[idx - 1])
    else router.back()
  }

  function nextStep() {
    const idx = STEPS.indexOf(step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1])
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={prevStep} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Novo agendamento</Text>
        <View style={{ width: 36 }} />
      </View>

      <StepIndicator current={stepIndex} total={STEPS.length} />

      <ScrollView contentContainerStyle={styles.content}>

        {/* Step 1: Professional */}
        {step === 'professional' && (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>Qual profissional?</Text>
            {loadingPros ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
            ) : !professionals?.length ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={48} color={colors.textDisabled} />
                <Text style={styles.emptyStateTitle}>Nenhum profissional cadastrado</Text>
                <Text style={styles.emptyStateSub}>
                  Vá em Configurações → Colaboradores e habilite alguém para prestar serviços.
                </Text>
                <TouchableOpacity
                  style={styles.emptyStateBtn}
                  onPress={() => router.replace('/(app)/settings/staff')}
                >
                  <Text style={styles.emptyStateBtnText}>Ir para Colaboradores</Text>
                </TouchableOpacity>
              </View>
            ) : (
              professionals.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.optionCard, selected.professional?.id === p.id && styles.optionCardActive]}
                  onPress={() => { setSelected((s) => ({ ...s, professional: p })); nextStep() }}
                >
                  <View style={styles.optionAvatar}>
                    <Text style={styles.optionAvatarText}>{p.name.charAt(0)}</Text>
                  </View>
                  <Text style={styles.optionLabel}>{p.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
                </TouchableOpacity>
              ))
            )}
          </View>
        )}

        {/* Step 2: Service */}
        {step === 'service' && (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>Qual serviço?</Text>
            {services?.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.optionCard, selected.service?.id === s.id && styles.optionCardActive]}
                onPress={() => { setSelected((prev) => ({ ...prev, service: s })); nextStep() }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionLabel}>{s.name}</Text>
                  <Text style={styles.optionSub}>{s.duration_minutes} min · R$ {Number(s.price).toFixed(2).replace('.', ',')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Step 3: Customer */}
        {step === 'customer' && (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>Para qual cliente?</Text>
            <TouchableOpacity
              style={[styles.optionCard, isNewCustomer && styles.optionCardActive]}
              onPress={() => setIsNewCustomer(!isNewCustomer)}
            >
              <Ionicons name="person-add-outline" size={20} color={colors.primary} />
              <Text style={[styles.optionLabel, { color: colors.primary }]}>+ Novo cliente</Text>
            </TouchableOpacity>

            {isNewCustomer && (
              <Card style={styles.newCustomerForm}>
                <Input label="Nome" value={newCustomerName} onChangeText={setNewCustomerName} placeholder="Nome do cliente" />
                <Input label="WhatsApp" value={newCustomerPhone} onChangeText={setNewCustomerPhone} placeholder="+55 11 99999-9999" keyboardType="phone-pad" />
                <Button
                  label="Usar este cliente"
                  onPress={() => {
                    if (!newCustomerName || !newCustomerPhone) {
                      toast.show('Preencha o nome e o telefone do cliente', 'warning')
                      return
                    }
                    setSelected((s) => ({ ...s, customer: null }))
                    nextStep()
                  }}
                />
              </Card>
            )}

            {!isNewCustomer && (
              <>
                <View style={styles.searchBox}>
                  <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Buscar cliente..."
                    placeholderTextColor={colors.textDisabled}
                    value={customerSearch}
                    onChangeText={setCustomerSearch}
                  />
                </View>
                {filteredCustomers.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.optionCard, selected.customer?.id === c.id && styles.optionCardActive]}
                    onPress={() => { setSelected((s) => ({ ...s, customer: c })); nextStep() }}
                  >
                    <View style={styles.optionAvatar}>
                      <Text style={styles.optionAvatarText}>{c.name.charAt(0)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionLabel}>{c.name}</Text>
                      <Text style={styles.optionSub}>{c.phone}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}

        {/* Step 4: Date + Time slot */}
        {step === 'datetime' && (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>Quando?</Text>
            {/* Date nav */}
            <View style={styles.dateNav}>
              <TouchableOpacity onPress={() => { const d = new Date(dateObj); d.setDate(d.getDate() - 1); setSelected((s) => ({ ...s, date: toDateStr(d), slot: undefined })) }}>
                <Ionicons name="chevron-back" size={22} color={colors.primary} />
              </TouchableOpacity>
              <Text style={styles.dateLabel}>
                {dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </Text>
              <TouchableOpacity onPress={() => { const d = new Date(dateObj); d.setDate(d.getDate() + 1); setSelected((s) => ({ ...s, date: toDateStr(d), slot: undefined })) }}>
                <Ionicons name="chevron-forward" size={22} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {loadingSlots ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
            ) : !slots?.length ? (
              <Text style={styles.noSlots}>Sem horários disponíveis neste dia</Text>
            ) : (
              <View style={styles.slotsGrid}>
                {slots.map((slot) => {
                  const time = new Date(slot).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  const isSelected = selected.slot === slot
                  return (
                    <TouchableOpacity
                      key={slot}
                      style={[styles.slotBtn, isSelected && styles.slotBtnSelected]}
                      onPress={() => setSelected((s) => ({ ...s, slot }))}
                    >
                      <Text style={[styles.slotText, isSelected && styles.slotTextSelected]}>{time}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            )}

            {selected.slot && (
              <Button label="Continuar" onPress={nextStep} style={{ marginTop: spacing.lg }} />
            )}
          </View>
        )}

        {/* Step 5: Confirm */}
        {step === 'confirm' && (
          <View style={styles.step}>
            <Text style={styles.stepTitle}>Confirmar agendamento</Text>
            <Card style={styles.summary}>
              <SummaryRow icon="person-outline" label="Profissional" value={selected.professional?.name} />
              <SummaryRow icon="cut-outline" label="Serviço" value={`${selected.service?.name} (${selected.service?.duration_minutes} min)`} />
              <SummaryRow icon="people-outline" label="Cliente" value={isNewCustomer ? newCustomerName : selected.customer?.name} />
              <SummaryRow
                icon="calendar-outline"
                label="Data e hora"
                value={selected.slot ? new Date(selected.slot).toLocaleString('pt-BR', {
                  weekday: 'short', day: 'numeric', month: 'short',
                  hour: '2-digit', minute: '2-digit'
                }) : ''}
              />
              <SummaryRow
                icon="cash-outline"
                label="Valor"
                value={`R$ ${Number(selected.service?.price ?? 0).toFixed(2).replace('.', ',')}`}
              />
            </Card>
            <Input
              label="Observações (opcional)"
              value={selected.notes ?? ''}
              onChangeText={(v) => setSelected((s) => ({ ...s, notes: v }))}
              placeholder="Informações adicionais para o agendamento..."
              multiline
              numberOfLines={3}
              style={{ height: undefined, paddingVertical: spacing.md, textAlignVertical: 'top' }}
            />
            <Button
              label="Confirmar agendamento"
              onPress={() => createMutation.mutate()}
              loading={createMutation.isPending}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function SummaryRow({ icon, label, value }: { icon: any; label: string; value?: string }) {
  return (
    <View style={sr.row}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={sr.label}>{label}</Text>
      <Text style={sr.value}>{value}</Text>
    </View>
  )
}
const sr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { fontSize: font.sm, color: colors.textSecondary, width: 90 },
  value: { flex: 1, fontSize: font.sm, fontWeight: '600', color: colors.text },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  step: { gap: spacing.md },
  stepTitle: { fontSize: font.xl, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  optionCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  optionAvatarText: { fontSize: font.md, fontWeight: '700', color: colors.primary },
  optionLabel: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  optionSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  newCustomerForm: { gap: spacing.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, gap: spacing.sm, height: 44, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  dateLabel: { fontSize: font.md, fontWeight: '600', color: colors.text, textTransform: 'capitalize', flex: 1, textAlign: 'center' },
  noSlots: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.xl, fontSize: font.md },
  slotsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slotBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  slotBtnSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  slotText: { fontSize: font.md, fontWeight: '600', color: colors.text },
  slotTextSelected: { color: '#fff' },
  summary: { gap: spacing.sm },
  emptyState: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyStateTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyStateSub: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyStateBtn: { backgroundColor: colors.primary, borderRadius: radius.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.sm },
  emptyStateBtnText: { color: '#fff', fontWeight: '700', fontSize: font.md },
})
