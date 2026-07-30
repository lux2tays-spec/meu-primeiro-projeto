import { useState } from 'react'
import { View, Text, Modal, ScrollView, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import { financeiroApi, tenantApi, customersApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const PAYMENTS = [
  { v: 'pix', l: 'Pix' }, { v: 'payment_link', l: 'Link' },
  { v: 'credit_card', l: 'Crédito' }, { v: 'debit_card', l: 'Débito' }, { v: 'cash', l: 'Dinheiro' },
]

export function NovaVendaSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [newMode, setNewMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [professionalId, setProfessionalId] = useState('')
  const [valor, setValor] = useState('')
  const [notes, setNotes] = useState('')
  const [pm, setPm] = useState('pix')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: customers = [] } = useQuery({ queryKey: ['customers', search], queryFn: () => customersApi.list(search), enabled: !newMode && search.length >= 2 })

  function pickService(id: string) {
    setServiceId(id)
    const s = (services as any[]).find((x) => x.id === id)
    if (s && !valor) setValor(String(Number(s.price)))
  }

  const save = useMutation({
    mutationFn: async () => {
      let cid = customerId
      if (newMode) {
        const c = await customersApi.create({ name: newName.trim(), phone: newPhone.trim() })
        cid = c.id
      }
      if (!cid) throw new Error('Selecione ou cadastre um cliente.')
      if (!serviceId) throw new Error('Selecione o serviço.')
      const valorNum = Number(String(valor).replace(',', '.') || 0)
      if (!(valorNum > 0)) throw new Error('Informe um valor maior que zero.')
      return financeiroApi.createVenda({ customer_id: cid, service_id: serviceId, professional_id: professionalId || null, valor: valorNum, notes: notes.trim() || undefined, payment_method: pm })
    },
    onSuccess: () => { useToast.getState().show('Venda registrada!', 'success'); onSaved() },
    onError: (e: any) => useToast.getState().show(e?.message ?? 'Não foi possível registrar a venda.', 'error'),
  })

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Nova venda</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {/* Cliente */}
          <View style={s.rowBetween}>
            <Text style={s.label}>Cliente</Text>
            <TouchableOpacity onPress={() => { setNewMode(!newMode); setCustomerId('') }}>
              <Text style={s.link}>{newMode ? 'Buscar existente' : '+ Novo cliente'}</Text>
            </TouchableOpacity>
          </View>
          {newMode ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="Nome" value={newName} onChangeText={setNewName} placeholderTextColor={colors.textDisabled} />
              <TextInput style={[s.input, { flex: 1 }]} placeholder="WhatsApp" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" placeholderTextColor={colors.textDisabled} />
            </View>
          ) : (
            <>
              <TextInput style={s.input} placeholder="Buscar por nome ou telefone…" value={search} onChangeText={(t) => { setSearch(t); setCustomerId('') }} placeholderTextColor={colors.textDisabled} />
              {search.length >= 2 && (customers as any[]).map((c) => (
                <TouchableOpacity key={c.id} onPress={() => { setCustomerId(c.id); setSearch(c.name) }} style={[s.option, customerId === c.id && s.optionActive]}>
                  <Text style={s.optionText}>{c.name} <Text style={s.optionSub}>{c.phone}</Text></Text>
                </TouchableOpacity>
              ))}
            </>
          )}

          {/* Serviço */}
          <Text style={s.label}>Serviço</Text>
          <View style={s.chipsWrap}>
            {(services as any[]).map((sv) => (
              <TouchableOpacity key={sv.id} onPress={() => pickService(sv.id)} style={[s.selChip, serviceId === sv.id && s.selChipActive]}>
                <Text style={[s.selChipText, serviceId === sv.id && s.selChipTextActive]}>{sv.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Valor */}
          <Text style={s.label}>Valor (R$)</Text>
          <TextInput style={s.input} value={valor} onChangeText={(t) => setValor(t.replace(/[^0-9,\.]/g, ''))} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.textDisabled} />

          {/* Profissional opcional */}
          <Text style={s.label}>Profissional (opcional)</Text>
          <View style={s.chipsWrap}>
            <TouchableOpacity onPress={() => setProfessionalId('')} style={[s.selChip, !professionalId && s.selChipActive]}>
              <Text style={[s.selChipText, !professionalId && s.selChipTextActive]}>—</Text>
            </TouchableOpacity>
            {(professionals as any[]).map((p) => (
              <TouchableOpacity key={p.id} onPress={() => setProfessionalId(p.id)} style={[s.selChip, professionalId === p.id && s.selChipActive]}>
                <Text style={[s.selChipText, professionalId === p.id && s.selChipTextActive]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Forma de pagamento */}
          <Text style={s.label}>Forma de pagamento</Text>
          <View style={s.chipsWrap}>
            {PAYMENTS.map((p) => (
              <TouchableOpacity key={p.v} onPress={() => setPm(p.v)} style={[s.selChip, pm === p.v && s.selChipActive]}>
                <Text style={[s.selChipText, pm === p.v && s.selChipTextActive]}>{p.l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Nota */}
          <Text style={s.label}>Descrição / Nota (opcional)</Text>
          <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="Observação" placeholderTextColor={colors.textDisabled} />

          <View style={{ height: spacing.md }} />
          <Button label="Registrar venda" onPress={() => save.mutate()} loading={save.isPending} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.md, color: colors.text },
  option: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginTop: 4 },
  optionActive: { backgroundColor: colors.primaryLight },
  optionText: { fontSize: font.md, color: colors.text },
  optionSub: { fontSize: font.sm, color: colors.textSecondary },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  selChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  selChipTextActive: { color: '#fff' },
})
