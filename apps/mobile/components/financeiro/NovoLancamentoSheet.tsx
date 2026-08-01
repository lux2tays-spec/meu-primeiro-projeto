import { useState } from 'react'
import { View, Text, Modal, ScrollView, TextInput, TouchableOpacity, Switch, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation } from '@tanstack/react-query'
import { financeiroApi } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const CATEGORIAS_RECEITA = ['Venda avulsa', 'Aporte de sócio', 'Reembolso', 'Rendimento', 'Outro']
const today = () => new Date().toISOString().slice(0, 10)
type Mode = 'menu' | 'despesa' | 'receita' | 'meta'

export function NovoLancamentoSheet({ visible, onClose, onSaved, currentMeta }: {
  visible: boolean; onClose: () => void; onSaved: () => void; currentMeta: number
}) {
  const [mode, setMode] = useState<Mode>('menu')
  function close() { setMode('menu'); onClose() }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={s.container} edges={['top']}>
        <View style={s.header}>
          <Text style={s.title}>{mode === 'menu' ? 'Novo lançamento' : mode === 'despesa' ? 'Nova despesa' : mode === 'receita' ? 'Nova receita' : 'Meta de lucro'}</Text>
          <TouchableOpacity onPress={close}><Ionicons name="close" size={24} color={colors.text} /></TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {mode === 'menu' && (
            <>
              <MenuBtn label="Nova receita" hint="Aporte, reembolso, rendimento…" color="#22C55E" onPress={() => setMode('receita')} />
              <MenuBtn label="Nova despesa" hint="Fixa ou variável, recorrente" color="#EF4444" onPress={() => setMode('despesa')} />
              <MenuBtn label="Meta de lucro" hint="Quanto você quer de lucro" color="#F59E0B" onPress={() => setMode('meta')} />
            </>
          )}
          {mode === 'despesa' && <DespesaForm onSaved={onSaved} />}
          {mode === 'receita' && <ReceitaForm onSaved={onSaved} />}
          {mode === 'meta' && <MetaForm onSaved={onSaved} currentMeta={currentMeta} />}
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function MenuBtn({ label, hint, color, onPress }: { label: string; hint: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.menuBtn}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.menuLabel}>{label}</Text>
        <Text style={s.menuHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
    </TouchableOpacity>
  )
}

function DespesaForm({ onSaved }: { onSaved: () => void }) {
  const { data: subtypes = [] } = useQuery({ queryKey: ['expense-subtypes'], queryFn: financeiroApi.expenseSubtypes })
  const [tipo, setTipo] = useState<'Fixa' | 'Variável'>('Fixa')
  const [subtipo, setSubtipo] = useState('')
  const [customSub, setCustomSub] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [pct, setPct] = useState('')
  const [recorrente, setRecorrente] = useState(true)

  const tipoSubs = (subtypes as any[]).filter((x) => x.tipo === tipo)
  const sel = (subtypes as any[]).find((x) => x.tipo === tipo && x.nome === subtipo)
  const isPercent = !!sel?.is_percent
  const isOutro = subtipo === 'Outro'

  const save = useMutation({
    mutationFn: () => financeiroApi.createDespesa({
      descricao: descricao.trim(), tipo, subtipo: isOutro ? (customSub.trim() || 'Outro') : subtipo,
      valor: isPercent ? null : Number(valor.replace(',', '.') || 0),
      pct: isPercent ? Number(pct.replace(',', '.') || 0) : null,
      data: today(), recorrente,
    }),
    onSuccess: () => { useToast.getState().show('Despesa salva!', 'success'); onSaved() },
    onError: (e: any) => useToast.getState().show(e?.message ?? 'Não foi possível salvar.', 'error'),
  })

  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={s.label}>Tipo</Text>
      <View style={s.chipsWrap}>
        {(['Fixa', 'Variável'] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => { setTipo(t); setSubtipo(''); setRecorrente(t === 'Fixa') }} style={[s.selChip, tipo === t && s.selChipActive]}>
            <Text style={[s.selChipText, tipo === t && s.selChipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.label}>Categoria</Text>
      <View style={s.chipsWrap}>
        {tipoSubs.map((x) => (
          <TouchableOpacity key={x.nome} onPress={() => setSubtipo(x.nome)} style={[s.selChip, subtipo === x.nome && s.selChipActive]}>
            <Text style={[s.selChipText, subtipo === x.nome && s.selChipTextActive]}>{x.nome}{x.is_percent ? ' %' : ''}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {isOutro && <TextInput style={s.input} placeholder="Categoria personalizada" value={customSub} onChangeText={setCustomSub} placeholderTextColor={colors.textDisabled} />}
      <Text style={s.label}>Descrição</Text>
      <TextInput style={s.input} value={descricao} onChangeText={setDescricao} placeholder="Ex.: Conta de luz" placeholderTextColor={colors.textDisabled} />
      {isPercent ? (
        <>
          <Text style={s.label}>Percentual (%)</Text>
          <TextInput style={s.input} value={pct} onChangeText={setPct} keyboardType="decimal-pad" placeholder="Ex.: 3,2" placeholderTextColor={colors.textDisabled} />
          <Text style={s.hint}>Cobrado como % sobre as vendas do mês.</Text>
        </>
      ) : (
        <>
          <Text style={s.label}>Valor (R$)</Text>
          <TextInput style={s.input} value={valor} onChangeText={(t) => setValor(t.replace(/[^0-9,\.]/g, ''))} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.textDisabled} />
        </>
      )}
      <View style={s.rowBetween}>
        <Text style={s.label}>Repetir todo mês</Text>
        <Switch value={recorrente} onValueChange={setRecorrente} trackColor={{ false: colors.border, true: colors.primary }} thumbColor="#fff" />
      </View>
      <View style={{ height: spacing.sm }} />
      <Button label="Salvar despesa" onPress={() => save.mutate()} loading={save.isPending}
        disabled={!descricao.trim() || !subtipo || (isPercent ? !(Number(pct.replace(',', '.')) > 0) : false)} />
    </View>
  )
}

function ReceitaForm({ onSaved }: { onSaved: () => void }) {
  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS_RECEITA[0])
  const [valor, setValor] = useState('')
  const save = useMutation({
    mutationFn: () => financeiroApi.createOutraReceita({ descricao: descricao.trim(), categoria, valor: Number(valor.replace(',', '.') || 0), data: today() }),
    onSuccess: () => { useToast.getState().show('Receita salva!', 'success'); onSaved() },
    onError: (e: any) => useToast.getState().show(e?.message ?? 'Não foi possível salvar.', 'error'),
  })
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={s.hint}>Entradas que não são vendas (aporte, reembolso, rendimento…).</Text>
      <Text style={s.label}>Descrição</Text>
      <TextInput style={s.input} value={descricao} onChangeText={setDescricao} placeholder="Ex.: Aporte do sócio" placeholderTextColor={colors.textDisabled} />
      <Text style={s.label}>Categoria</Text>
      <View style={s.chipsWrap}>
        {CATEGORIAS_RECEITA.map((c) => (
          <TouchableOpacity key={c} onPress={() => setCategoria(c)} style={[s.selChip, categoria === c && s.selChipActive]}>
            <Text style={[s.selChipText, categoria === c && s.selChipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.label}>Valor (R$)</Text>
      <TextInput style={s.input} value={valor} onChangeText={(t) => setValor(t.replace(/[^0-9,\.]/g, ''))} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={colors.textDisabled} />
      <View style={{ height: spacing.sm }} />
      <Button label="Salvar receita" onPress={() => save.mutate()} loading={save.isPending} disabled={!descricao.trim() || !(Number(valor.replace(',', '.')) > 0)} />
    </View>
  )
}

function MetaForm({ onSaved, currentMeta }: { onSaved: () => void; currentMeta: number }) {
  const [meta, setMeta] = useState(currentMeta ? String(currentMeta) : '')
  const save = useMutation({
    mutationFn: () => financeiroApi.setMetaLucro(Number(meta.replace(',', '.') || 0)),
    onSuccess: () => { useToast.getState().show('Meta salva!', 'success'); onSaved() },
    onError: (e: any) => useToast.getState().show(e?.message ?? 'Não foi possível salvar.', 'error'),
  })
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={s.label}>Meta de lucro mensal (R$)</Text>
      <TextInput style={s.input} value={meta} onChangeText={(t) => setMeta(t.replace(/[^0-9,\.]/g, ''))} keyboardType="decimal-pad" placeholder="Ex.: 8000" placeholderTextColor={colors.textDisabled} />
      <Text style={s.hint}>A partir dela e das suas despesas, calculamos quanto precisa faturar no mês.</Text>
      <View style={{ height: spacing.sm }} />
      <Button label="Salvar meta" onPress={() => save.mutate()} loading={save.isPending} />
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  body: { padding: spacing.lg, gap: spacing.sm },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.xs },
  hint: { fontSize: font.sm, color: colors.textSecondary },
  input: { borderWidth: 1.5, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: font.md, color: colors.text },
  menuBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  menuLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  menuHint: { fontSize: font.sm, color: colors.textSecondary },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  selChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  selChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  selChipTextActive: { color: '#fff' },
})
