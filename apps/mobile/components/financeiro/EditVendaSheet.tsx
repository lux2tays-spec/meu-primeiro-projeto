import { useState } from 'react'
import { View, Text, Modal, ScrollView, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import { tenantApi, appointmentsApiExt } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const PAYMENTS = [
  { v: 'pix', l: 'Pix' }, { v: 'payment_link', l: 'Link' },
  { v: 'credit_card', l: 'Crédito' }, { v: 'debit_card', l: 'Débito' }, { v: 'cash', l: 'Dinheiro' },
]

export function EditVendaSheet({ venda, onClose, onSaved }: { venda: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const start = new Date(venda.starts_at)
  const [serviceId, setServiceId] = useState<string>(venda.service_id)
  const [valor, setValor] = useState(String(Number(venda.valor)))
  const [pm, setPm] = useState(venda.payment_method ?? 'pix')
  const [notes, setNotes] = useState(venda.notes ?? '')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })

  const save = useMutation({
    mutationFn: () => appointmentsApiExt.put(venda.id, {
      service_id: serviceId,
      price_snapshot: Number(String(valor).replace(',', '.') || 0),
      payment_method: pm,
      notes: notes.trim() ? notes.trim() : null,
      starts_at: start.toISOString(),
    }),
    onSuccess: () => { toast.show('Venda atualizada', 'success'); onSaved() },
    onError: (e: any) => toast.show(e?.message ?? 'Não foi possível salvar.', 'error'),
  })

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Editar venda</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={s.hint}>Cliente: {venda.cliente_nome}</Text>
            <Text style={s.label}>Serviço</Text>
            <View style={s.chipsWrap}>
              {(services as any[]).map((sv) => (
                <TouchableOpacity key={sv.id} onPress={() => { setServiceId(sv.id); setValor(String(Number(sv.price))) }} style={[s.selChip, serviceId === sv.id && s.selChipActive]}>
                  <Text style={[s.selChipText, serviceId === sv.id && s.selChipTextActive]}>{sv.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>Valor (R$)</Text>
            <TextInput style={s.input} value={valor} onChangeText={(t) => setValor(t.replace(/[^0-9,\.]/g, ''))} keyboardType="decimal-pad" placeholderTextColor={colors.textDisabled} />
            <Text style={s.label}>Forma de pagamento</Text>
            <View style={s.chipsWrap}>
              {PAYMENTS.map((p) => (
                <TouchableOpacity key={p.v} onPress={() => setPm(p.v)} style={[s.selChip, pm === p.v && s.selChipActive]}>
                  <Text style={[s.selChipText, pm === p.v && s.selChipTextActive]}>{p.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.label}>Nota (opcional)</Text>
            <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="Observação" placeholderTextColor={colors.textDisabled} />
            <View style={{ height: spacing.md }} />
            <Button label="Salvar alterações" onPress={() => save.mutate()} loading={save.isPending} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  body: { padding: spacing.lg, gap: spacing.sm },
  hint: { fontSize: font.sm, color: colors.textSecondary },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.md, color: colors.text },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  selChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  selChipTextActive: { color: '#fff' },
})
