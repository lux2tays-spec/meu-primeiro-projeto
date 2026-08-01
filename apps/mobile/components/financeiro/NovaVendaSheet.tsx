import { useState } from 'react'
import { View, Text, Modal, ScrollView, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import { financeiroApi, tenantApi, customersApi, customerFullName } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const PAYMENTS = [
  { v: 'pix', l: 'Pix' }, { v: 'payment_link', l: 'Link' },
  { v: 'credit_card', l: 'Crédito' }, { v: 'debit_card', l: 'Débito' }, { v: 'cash', l: 'Dinheiro' },
]

export function NovaVendaSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const insets = useSafeAreaInsets()
  const [search, setSearch] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<any | null>(null)
  const [newMode, setNewMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [isOutro, setIsOutro] = useState(false)
  const [serviceSearch, setServiceSearch] = useState('')
  const [servicePickerOpen, setServicePickerOpen] = useState(false)
  const [professionalId, setProfessionalId] = useState('')
  const [valor, setValor] = useState('')
  const [notes, setNotes] = useState('')
  const [pm, setPm] = useState('pix')
  const [outroDesc, setOutroDesc] = useState('')

  const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: customers = [] } = useQuery({ queryKey: ['customers', search], queryFn: () => customersApi.list(search), enabled: !newMode && search.length >= 2 })

  const sumFor = (ids: string[]) =>
    (services as any[]).filter((x) => ids.includes(x.id)).reduce((acc, x) => acc + (Number(x.price) || 0), 0)

  // Marca/desmarca um serviço do catálogo. O valor SEMPRE re-soma os preços dos
  // serviços marcados (mas continua editável à mão depois).
  function toggleService(id: string) {
    setIsOutro(false)
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      setValor(next.length ? String(sumFor(next)) : '')
      return next
    })
  }

  function chooseOutro() {
    setIsOutro(true); setSelectedIds([]); setValor('')
  }

  const filteredServices = (services as any[]).filter((sv) =>
    sv.name.toLowerCase().includes(serviceSearch.trim().toLowerCase())
  )
  const selectedLabel = (services as any[])
    .filter((sv) => selectedIds.includes(sv.id))
    .map((sv) => sv.name)
    .join(', ')

  const save = useMutation({
    mutationFn: async () => {
      let cid = customerId
      if (newMode) {
        if (!newName.trim()) throw new Error('Informe o nome do cliente.')
        const c = await customersApi.create({ name: newName.trim(), last_name: newLastName.trim() || undefined, phone: newPhone.trim() })
        cid = c.id
      }
      if (!cid) throw new Error('Selecione ou cadastre um cliente.')
      if (isOutro && !outroDesc.trim()) throw new Error('Descreva o serviço avulso.')
      if (!isOutro && selectedIds.length === 0) throw new Error('Selecione ao menos um serviço.')
      const valorNum = Number(String(valor).replace(',', '.') || 0)
      if (!(valorNum > 0)) throw new Error('Informe um valor maior que zero.')
      return financeiroApi.createVenda({
        customer_id: cid,
        service_ids: isOutro ? undefined : selectedIds,
        custom_service: isOutro ? outroDesc.trim() : undefined,
        professional_id: professionalId || null,
        valor: valorNum, notes: notes.trim() || undefined, payment_method: pm,
      })
    },
    onSuccess: () => {
      useToast.getState().show('Venda registrada!', 'success')
      // Limpa a seleção para a próxima venda não herdar serviços/valor.
      setSelectedIds([]); setIsOutro(false); setServiceSearch(''); setValor(''); setOutroDesc(''); setNotes('')
      setSearch(''); setCustomerId(''); setSelectedCustomer(null); setNewMode(false); setNewName(''); setNewLastName(''); setNewPhone(''); setProfessionalId('')
      onSaved()
    },
    onError: (e: any) => useToast.getState().show(e?.message ?? 'Não foi possível registrar a venda.', 'error'),
  })

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>Nova venda</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled">
          {/* Cliente */}
          <View style={s.rowBetween}>
            <Text style={s.label}>Cliente <Text style={s.req}>*</Text></Text>
            <TouchableOpacity onPress={() => { setNewMode(!newMode); setCustomerId('') }}>
              <Text style={s.link}>{newMode ? 'Buscar existente' : '+ Novo cliente'}</Text>
            </TouchableOpacity>
          </View>
          {newMode ? (
            <View style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <TextInput style={[s.input, { flex: 1 }]} placeholder="Nome" value={newName} onChangeText={setNewName} placeholderTextColor={colors.textDisabled} />
                <TextInput style={[s.input, { flex: 1 }]} placeholder="Sobrenome" value={newLastName} onChangeText={setNewLastName} placeholderTextColor={colors.textDisabled} />
              </View>
              <TextInput style={s.input} placeholder="WhatsApp" value={newPhone} onChangeText={setNewPhone} keyboardType="phone-pad" placeholderTextColor={colors.textDisabled} />
            </View>
          ) : customerId ? (
            // Cliente selecionado: cartão de confirmação (evita re-selecionar).
            <View style={s.selectedCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.selectedName}>{customerFullName(selectedCustomer) || 'Cliente selecionado'}</Text>
                {selectedCustomer?.phone ? <Text style={s.optionSub}>{selectedCustomer.phone}</Text> : null}
              </View>
              <TouchableOpacity onPress={() => { setCustomerId(''); setSelectedCustomer(null); setSearch('') }}>
                <Text style={s.link}>Trocar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <TextInput style={s.input} placeholder="Buscar por nome ou telefone…" value={search} onChangeText={setSearch} placeholderTextColor={colors.textDisabled} />
              {search.length >= 2 && (customers as any[]).map((c) => (
                <TouchableOpacity key={c.id} onPress={() => { setCustomerId(c.id); setSelectedCustomer(c) }} style={s.option}>
                  <Text style={s.optionText}>{customerFullName(c)} <Text style={s.optionSub}>{c.phone}</Text></Text>
                </TouchableOpacity>
              ))}
              {search.length >= 2 && (customers as any[]).length === 0 && (
                <Text style={[s.optionSub, { marginTop: 4 }]}>Nenhum cliente encontrado.</Text>
              )}
            </>
          )}

          {/* Serviços — dropdown (abre modal com busca e múltipla seleção) */}
          <Text style={s.label}>Serviços <Text style={s.req}>*</Text></Text>
          <TouchableOpacity style={s.selectField} onPress={() => { setServiceSearch(''); setServicePickerOpen(true) }}>
            <Text style={[s.selectFieldText, (isOutro || selectedIds.length > 0) ? null : { color: colors.textDisabled }]} numberOfLines={1}>
              {isOutro ? 'Outro serviço (avulso)' : selectedIds.length === 0 ? 'Toque para selecionar serviços' : selectedLabel}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {selectedIds.length > 1 && (
            <Text style={s.optionSub}>{selectedIds.length} serviços — o valor soma automaticamente (você pode ajustar).</Text>
          )}

          {isOutro && (
            <>
              <Text style={s.label}>Descrição do serviço <Text style={s.req}>*</Text></Text>
              <TextInput style={s.input} value={outroDesc} onChangeText={setOutroDesc} placeholder="Ex.: Retoque de sobrancelha" placeholderTextColor={colors.textDisabled} />
            </>
          )}

          {/* Valor */}
          <Text style={s.label}>Valor (R$) <Text style={s.req}>*</Text></Text>
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
          <Text style={s.label}>Forma de pagamento <Text style={s.req}>*</Text></Text>
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
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Seletor de serviços (dropdown) — busca + lista rolável + múltipla seleção */}
      <Modal visible={servicePickerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setServicePickerOpen(false)}>
        <SafeAreaView style={s.container} edges={['top']}>
          <View style={s.header}>
            <Text style={s.title}>Selecionar serviços</Text>
            <TouchableOpacity onPress={() => setServicePickerOpen(false)}><Text style={s.link}>Pronto</Text></TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <TextInput
              style={s.input}
              placeholder="Buscar serviço…"
              value={serviceSearch}
              onChangeText={setServiceSearch}
              placeholderTextColor={colors.textDisabled}
              autoFocus
            />
          </View>
          <FlatList
            data={filteredServices}
            keyExtractor={(it: any) => it.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
            ListHeaderComponent={
              <TouchableOpacity style={s.pickRow} onPress={() => { chooseOutro(); setServicePickerOpen(false) }}>
                <View style={[s.check, isOutro && s.checkOn]}>{isOutro && <Ionicons name="checkmark" size={14} color="#fff" />}</View>
                <Text style={[s.pickName, { fontWeight: '600' }]}>Outro serviço (sem preço fixo)</Text>
              </TouchableOpacity>
            }
            renderItem={({ item }: any) => {
              const on = selectedIds.includes(item.id)
              return (
                <TouchableOpacity style={s.pickRow} onPress={() => toggleService(item.id)}>
                  <View style={[s.check, on && s.checkOn]}>{on && <Ionicons name="checkmark" size={14} color="#fff" />}</View>
                  <Text style={s.pickName} numberOfLines={1}>{item.name}</Text>
                  {Number(item.price) > 0 && (
                    <Text style={s.pickPrice}>R$ {Number(item.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Text>
                  )}
                </TouchableOpacity>
              )
            }}
            ListEmptyComponent={<Text style={[s.optionSub, { paddingVertical: spacing.md }]}>Nenhum serviço encontrado.</Text>}
          />
        </SafeAreaView>
      </Modal>
    </Modal>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
  req: { color: colors.danger, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.md, color: colors.text },
  option: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt, marginTop: 4 },
  optionActive: { backgroundColor: colors.primaryLight },
  optionText: { fontSize: font.md, color: colors.text },
  optionSub: { fontSize: font.sm, color: colors.textSecondary },
  selectedCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.primaryLight, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  selectedName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  // Campo "dropdown" que abre o seletor de serviços
  selectField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  selectFieldText: { flex: 1, fontSize: font.md, color: colors.text, paddingRight: spacing.sm },
  // Linhas do seletor de serviços
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickName: { flex: 1, fontSize: font.md, color: colors.text },
  pickPrice: { fontSize: font.sm, color: colors.textSecondary },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  selChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  selChipTextActive: { color: '#fff' },
})
