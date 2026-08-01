import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Alert, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeiroApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { NovaVendaSheet } from '@/components/financeiro/NovaVendaSheet'
import { EditVendaSheet } from '@/components/financeiro/EditVendaSheet'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const PM_LABEL: Record<string, string> = { pix: 'Pix', payment_link: 'Link', credit_card: 'Crédito', debit_card: 'Débito', cash: 'Dinheiro' }
const fmtBRL = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function VendasScreen() {
  const qc = useQueryClient()
  const toast = useToast()
  const now = new Date()
  const [preset, setPreset] = useState<'hoje' | '7' | 'mes' | 'mespassado'>('mes')
  const [novaVenda, setNovaVenda] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  // Log da equipe: só o proprietário vê, e começa oculto (toggle).
  const role = useAuthStore((s) => s.role)
  const isOwner = role === 'owner' || role === 'root'
  const [showLog, setShowLog] = useState(false)

  const { from, to } = (() => {
    const t = new Date()
    if (preset === 'hoje') return { from: isoDate(t), to: isoDate(t) }
    if (preset === '7') return { from: isoDate(new Date(t.getTime() - 6 * 86400000)), to: isoDate(t) }
    if (preset === 'mespassado') {
      const s = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const e = new Date(t.getFullYear(), t.getMonth(), 0)
      return { from: isoDate(s), to: isoDate(e) }
    }
    return { from: isoDate(new Date(t.getFullYear(), t.getMonth(), 1)), to: isoDate(t) }
  })()

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['vendas-range', from, to],
    queryFn: () => financeiroApi.vendasRange(from, to, 1, 100),
  })
  const { data: log = [] } = useQuery({ queryKey: ['activity-log'], queryFn: financeiroApi.activityLog, enabled: isOwner && showLog })

  const vendas = data?.data ?? []
  const totalValor = data?.total_valor ?? 0

  function afterChange() {
    qc.invalidateQueries({ queryKey: ['vendas-range'] })
    qc.invalidateQueries({ queryKey: ['activity-log'] })
    qc.invalidateQueries({ queryKey: ['fin-resumo'] })
    qc.invalidateQueries({ queryKey: ['fin-resumo-dashboard'] })
  }

  const del = useMutation({
    mutationFn: (id: string) => financeiroApi.deleteVenda(id),
    onSuccess: () => { toast.show('Venda excluída', 'success'); afterChange() },
    onError: (e: any) => toast.show(e?.message ?? 'Não foi possível excluir.', 'error'),
  })

  function confirmDelete(v: any) {
    Alert.alert('Excluir venda', `Excluir a venda de ${fmtBRL(Number(v.valor))}? Ficará registrado no log do proprietário.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: () => del.mutate(v.id) },
    ])
  }

  const PRESETS: { k: typeof preset; l: string }[] = [
    { k: 'hoje', l: 'Hoje' }, { k: '7', l: '7 dias' }, { k: 'mes', l: 'Este mês' }, { k: 'mespassado', l: 'Mês passado' },
  ]

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}>
        <View style={s.header}>
          <Text style={s.title}>Vendas</Text>
          <TouchableOpacity style={s.novaBtn} onPress={() => setNovaVenda(true)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={s.novaBtnText}>Nova venda</Text>
          </TouchableOpacity>
        </View>

        {/* Período */}
        <View style={s.presetRow}>
          {PRESETS.map((p) => (
            <TouchableOpacity key={p.k} onPress={() => setPreset(p.k)} style={[s.presetChip, preset === p.k && s.presetChipActive]}>
              <Text style={[s.presetText, preset === p.k && s.presetTextActive]}>{p.l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Total */}
        <View style={s.totalCard}>
          <Text style={s.totalLabel}>{vendas.length} venda(s) no período</Text>
          <Text style={s.totalValue}>Total: {fmtBRL(totalValor)}</Text>
        </View>

        {/* Lista */}
        {isLoading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} /> : vendas.length === 0 ? (
          <Text style={s.empty}>Nenhuma venda neste período.</Text>
        ) : (
          vendas.map((v: any) => (
            <View key={v.id} style={s.vendaCard}>
              <View style={{ flex: 1 }}>
                <Text style={s.vendaCliente}>{v.cliente_nome}</Text>
                <Text style={s.vendaServico}>{v.servico_nome}{v.notes ? ` · ${v.notes}` : ''}</Text>
                <Text style={s.vendaMeta}>
                  {new Date(v.starts_at).toLocaleDateString('pt-BR')} · {v.payment_method ? PM_LABEL[v.payment_method] : '—'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={s.vendaValor}>{fmtBRL(Number(v.valor))}</Text>
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                  <TouchableOpacity onPress={() => setEditing(v)}><Text style={s.editLink}>Editar</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => confirmDelete(v)}><Text style={s.delLink}>Excluir</Text></TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}

        {/* Log da equipe — apenas proprietário, com botão ocultar/exibir */}
        {isOwner && (
          <>
            <TouchableOpacity style={s.logToggle} onPress={() => setShowLog((v) => !v)} accessibilityRole="button">
              <Text style={[s.sectionTitle, { marginTop: 0 }]}>Log de atividades da equipe</Text>
              <Ionicons name={showLog ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            {showLog && (
              <View style={s.logCard}>
                {(log as any[]).length === 0 ? (
                  <Text style={s.empty}>Nenhuma atividade registrada ainda.</Text>
                ) : (
                  (log as any[]).map((l) => (
                    <View key={l.id} style={s.logRow}>
                      <Text style={s.logSummary}>{l.summary}</Text>
                      <Text style={s.logMeta}>{l.actor_name ? `${l.actor_name} · ` : ''}{new Date(l.created_at).toLocaleDateString('pt-BR')}</Text>
                    </View>
                  ))
                )}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <NovaVendaSheet visible={novaVenda} onClose={() => setNovaVenda(false)} onSaved={() => { setNovaVenda(false); afterChange() }} />
      {editing && <EditVendaSheet venda={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); afterChange() }} />}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  novaBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md },
  novaBtnText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  presetChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  presetChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  presetTextActive: { color: '#fff' },
  totalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: font.sm, color: colors.textSecondary },
  totalValue: { fontSize: font.lg, fontWeight: '800', color: colors.success },
  empty: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  vendaCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, flexDirection: 'row', gap: spacing.md },
  vendaCliente: { fontSize: font.md, fontWeight: '700', color: colors.text },
  vendaServico: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  vendaMeta: { fontSize: 11, color: colors.textDisabled, marginTop: 2 },
  vendaValor: { fontSize: font.md, fontWeight: '800', color: colors.success },
  editLink: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  delLink: { fontSize: font.sm, fontWeight: '700', color: colors.danger },
  sectionTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  logToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.xs },
  logCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  logRow: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.sm },
  logSummary: { fontSize: font.sm, color: colors.text },
  logMeta: { fontSize: 11, color: colors.textDisabled, marginTop: 2 },
})
