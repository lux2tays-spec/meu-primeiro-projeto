import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, TextInput, Modal,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeiroApi } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

type Tab = 'vendas' | 'links'

export default function FinanceiroScreen() {
  const qc = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear]   = useState(now.getFullYear())
  const [tab, setTab]     = useState<Tab>('vendas')

  // Link form
  const [showModal, setShowModal] = useState(false)
  const [linkTitle, setLinkTitle]       = useState('')
  const [linkDesc, setLinkDesc]         = useState('')
  const [linkAmount, setLinkAmount]     = useState('')

  const { data: resumo, isRefetching: r1, refetch: ref1 } = useQuery({
    queryKey: ['fin-resumo', month, year],
    queryFn: () => financeiroApi.resumo(month, year),
  })

  const { data: vendas = [], isLoading: loadingVendas, isRefetching: r2, refetch: ref2 } = useQuery({
    queryKey: ['fin-vendas', month, year],
    queryFn: () => financeiroApi.vendas(month, year),
    enabled: tab === 'vendas',
  })

  const { data: links = [], isLoading: loadingLinks, isRefetching: r3, refetch: ref3 } = useQuery({
    queryKey: ['fin-links'],
    queryFn: financeiroApi.paymentLinks,
    enabled: tab === 'links',
  })

  const createLink = useMutation({
    mutationFn: financeiroApi.createPaymentLink,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fin-links'] })
      setShowModal(false)
      setLinkTitle(''); setLinkDesc(''); setLinkAmount('')
    },
    onError: (e: any) => Alert.alert('Erro', e.message),
  })

  const deleteLink = useMutation({
    mutationFn: financeiroApi.deletePaymentLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fin-links'] }),
  })

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  function nextMonth() {
    const nm = month === 12 ? 1 : month + 1
    const ny = month === 12 ? year + 1 : year
    if (ny > now.getFullYear() || (ny === now.getFullYear() && nm > now.getMonth() + 1)) return
    setMonth(nm); setYear(ny)
  }

  const isRefreshing = r1 || r2 || r3
  function onRefresh() { ref1(); if (tab === 'vendas') ref2(); else ref3() }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Header */}
        <Text style={s.title}>Financeiro</Text>

        {/* Month picker */}
        <View style={s.monthRow}>
          <TouchableOpacity onPress={prevMonth} style={s.monthBtn}>
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={s.monthLabel}>{MONTHS[month - 1]} {year}</Text>
          <TouchableOpacity onPress={nextMonth} style={s.monthBtn}>
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* KPIs */}
        <View style={s.kpiRow}>
          <View style={[s.kpi, { backgroundColor: '#ECFDF5' }]}>
            <Text style={s.kpiLabel}>Receita</Text>
            <Text style={[s.kpiValue, { color: colors.success }]}>{fmtBRL(resumo?.receita_total ?? 0)}</Text>
          </View>
          <View style={[s.kpi, { backgroundColor: colors.primaryLight }]}>
            <Text style={s.kpiLabel}>Vendas</Text>
            <Text style={[s.kpiValue, { color: colors.primary }]}>{resumo?.total_vendas ?? 0}</Text>
          </View>
          <View style={[s.kpi, { backgroundColor: '#FFF7ED' }]}>
            <Text style={s.kpiLabel}>Em aberto</Text>
            <Text style={[s.kpiValue, { color: colors.warning }]}>{resumo?.agendamentos_abertos ?? 0}</Text>
          </View>
        </View>

        {/* Tabs */}
        <View style={s.tabRow}>
          {(['vendas', 'links'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)}
              style={[s.tabBtn, tab === t && s.tabBtnActive]}>
              <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>
                {t === 'vendas' ? 'Vendas' : 'Links de Pagamento'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Vendas ─────────────────────────────── */}
        {tab === 'vendas' && (
          loadingVendas ? (
            <Text style={s.empty}>Carregando...</Text>
          ) : (vendas as any[]).length === 0 ? (
            <Text style={s.empty}>Nenhuma venda concluída neste período</Text>
          ) : (
            <View style={s.list}>
              {(vendas as any[]).map((v) => (
                <View key={v.id} style={s.card}>
                  <View style={s.cardRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardName}>{v.cliente_nome}</Text>
                      <Text style={s.cardSub}>{v.servico_nome}</Text>
                      <Text style={s.cardMeta}>{v.profissional_nome} · {fmtDate(v.starts_at)}</Text>
                    </View>
                    <Text style={s.cardValue}>{fmtBRL(Number(v.valor))}</Text>
                  </View>
                </View>
              ))}
            </View>
          )
        )}

        {/* ── Links de Pagamento ──────────────────── */}
        {tab === 'links' && (
          <View style={s.list}>
            <TouchableOpacity style={s.addLinkBtn} onPress={() => setShowModal(true)}>
              <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
              <Text style={s.addLinkText}>Novo link de pagamento</Text>
            </TouchableOpacity>

            {loadingLinks ? (
              <Text style={s.empty}>Carregando...</Text>
            ) : (links as any[]).length === 0 ? (
              <Text style={s.empty}>Nenhum link criado</Text>
            ) : (
              (links as any[]).map((l) => (
                <View key={l.id} style={s.card}>
                  <View style={s.cardRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardName}>{l.title}</Text>
                      {l.description ? <Text style={s.cardSub}>{l.description}</Text> : null}
                      <Text style={[s.cardValue, { marginTop: 4, fontSize: font.md }]}>{fmtBRL(Number(l.amount))}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => Alert.alert('Excluir link', 'Tem certeza?', [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Excluir', style: 'destructive', onPress: () => deleteLink.mutate(l.id) },
                      ])}
                      style={s.deleteBtn}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                  {l.mp_url ? (
                    <Text style={s.linkUrl} numberOfLines={1}>{l.mp_url}</Text>
                  ) : (
                    <Text style={s.noLink}>Sem link MP — configure Mercado Pago em Config</Text>
                  )}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal criar link */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Novo link de pagamento</Text>
            <TouchableOpacity onPress={() => setShowModal(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            <View>
              <Text style={s.label}>Título</Text>
              <TextInput style={s.input} value={linkTitle} onChangeText={setLinkTitle}
                placeholder="Ex: Pacote mensal" placeholderTextColor={colors.textDisabled} />
            </View>
            <View>
              <Text style={s.label}>Descrição (opcional)</Text>
              <TextInput style={s.input} value={linkDesc} onChangeText={setLinkDesc}
                placeholder="Detalhes da cobrança" placeholderTextColor={colors.textDisabled} />
            </View>
            <View>
              <Text style={s.label}>Valor (R$)</Text>
              <TextInput style={s.input} value={linkAmount} onChangeText={setLinkAmount}
                placeholder="0,00" keyboardType="decimal-pad" placeholderTextColor={colors.textDisabled} />
            </View>

            <TouchableOpacity
              style={[s.submitBtn, (!linkTitle || !linkAmount) && { opacity: 0.5 }]}
              disabled={!linkTitle || !linkAmount || createLink.isPending}
              onPress={() => createLink.mutate({
                title: linkTitle,
                description: linkDesc || undefined,
                amount: Number(linkAmount.replace(',', '.')),
              })}
            >
              <Text style={s.submitBtnText}>{createLink.isPending ? 'Criando...' : 'Criar link'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  title: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg },
  monthBtn: { padding: spacing.sm },
  monthLabel: { fontSize: font.lg, fontWeight: '700', color: colors.text, minWidth: 100, textAlign: 'center' },
  kpiRow: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  kpiLabel: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  kpiValue: { fontSize: font.lg, fontWeight: '800' },
  tabRow: { flexDirection: 'row', backgroundColor: '#EEE', borderRadius: radius.lg, padding: 4, gap: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center' },
  tabBtnActive: { backgroundColor: colors.surface },
  tabLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  tabLabelActive: { color: colors.text },
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  cardMeta: { fontSize: font.sm, color: colors.textDisabled, marginTop: 2 },
  cardValue: { fontSize: font.lg, fontWeight: '800', color: colors.success },
  deleteBtn: { padding: spacing.xs },
  linkUrl: { fontSize: 11, color: colors.primary, marginTop: 4 },
  noLink: { fontSize: 11, color: colors.textDisabled, marginTop: 4, fontStyle: 'italic' },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xl, fontSize: font.md },
  addLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.primaryLight, justifyContent: 'center',
  },
  addLinkText: { color: colors.primary, fontWeight: '700', fontSize: font.md },
  // Modal
  modal: { flex: 1, backgroundColor: colors.surface },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: font.md, color: colors.text, backgroundColor: colors.surface,
  },
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: radius.lg,
    padding: spacing.md, alignItems: 'center', marginTop: spacing.sm,
  },
  submitBtnText: { color: '#fff', fontWeight: '700', fontSize: font.md },
})
