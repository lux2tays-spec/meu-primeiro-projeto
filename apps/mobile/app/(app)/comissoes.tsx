import { useMemo, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/Input'
import { commissionsApi, tenantApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

function fmtBRL(v: number) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Máscara DD/MM/AAAA enquanto digita. */
function maskDate(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** DD/MM/AAAA → YYYY-MM-DD (null se inválida ou vazia). */
function toISODate(v: string): string | null {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
  if (
    date.getFullYear() !== Number(yyyy) ||
    date.getMonth() !== Number(mm) - 1 ||
    date.getDate() !== Number(dd)
  ) return null
  return `${yyyy}-${mm}-${dd}`
}

type StatusFilter = 'all' | 'pending' | 'paid'

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'pending', label: 'Pendente' },
  { key: 'paid', label: 'Pago' },
]

export default function ComissoesScreen() {
  const qc = useQueryClient()
  const toast = useToast()
  const role = useAuthStore((s) => s.role)
  const canManage = ['owner', 'admin', 'root'].includes(role ?? '')

  const [professionalId, setProfessionalId] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')

  // Filtro por período (SAL-10)
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [periodError, setPeriodError] = useState<string | undefined>(undefined)
  const [appliedFrom, setAppliedFrom] = useState<string | null>(null)
  const [appliedTo, setAppliedTo] = useState<string | null>(null)

  // Seleção por item (SAL-10)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Confirmações
  const [confirmPayAll, setConfirmPayAll] = useState(false)
  const [confirmRefund, setConfirmRefund] = useState<{ ids: string[] } | null>(null)

  const { data: professionals = [] } = useQuery({
    queryKey: ['professionals'],
    queryFn: tenantApi.professionals,
    enabled: canManage,
  })

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['commissions', professionalId, status, appliedFrom, appliedTo],
    queryFn: () =>
      commissionsApi.list({
        professional_id: professionalId ?? undefined,
        status: status === 'all' ? undefined : status,
        from: appliedFrom ?? undefined,
        to: appliedTo ?? undefined,
      }),
  })

  const totals = data?.totals
  const items = data?.data ?? []

  // Só itens visíveis contam para a seleção (limpa ids que saíram da lista).
  const visibleIds = useMemo(() => new Set(items.map((c) => c.id)), [items])
  const selectedVisible = useMemo(
    () => items.filter((c) => selected.has(c.id)),
    [items, selected]
  )
  const selectedPending = selectedVisible.filter((c) => c.status === 'pending')
  const selectedPaid = selectedVisible.filter((c) => c.status === 'paid')

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  const payMutation = useMutation({
    mutationFn: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
      commissionsApi.pay(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['commissions'] })
      clearSelection()
      setConfirmPayAll(false)
      const n = res.paid_count ?? 0
      toast.show(
        n > 0
          ? `${n} ${n === 1 ? 'comissão marcada como paga' : 'comissões marcadas como pagas'}.`
          : 'Nenhuma comissão pendente para pagar.',
        n > 0 ? 'success' : 'info'
      )
    },
    onError: (e: any) => {
      setConfirmPayAll(false)
      toast.show(e?.message ?? 'Não foi possível marcar como pago.', 'error')
    },
  })

  const refundMutation = useMutation({
    mutationFn: (body: { ids?: string[]; professional_id?: string; from?: string; to?: string }) =>
      commissionsApi.refund(body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['commissions'] })
      clearSelection()
      setConfirmRefund(null)
      const n = res.refunded_count ?? 0
      toast.show(
        n > 0
          ? `${n} ${n === 1 ? 'comissão revertida para pendente' : 'comissões revertidas para pendente'}.`
          : 'Nenhuma comissão para reverter.',
        n > 0 ? 'success' : 'info'
      )
    },
    onError: (e: any) => {
      setConfirmRefund(null)
      toast.show(e?.message ?? 'Não foi possível reverter a comissão.', 'error')
    },
  })

  const isMutating = payMutation.isPending || refundMutation.isPending

  function applyPeriod() {
    const f = fromText.trim() ? toISODate(fromText) : null
    const t = toText.trim() ? toISODate(toText) : null
    if (fromText.trim() && !f) { setPeriodError('Data inicial inválida (DD/MM/AAAA)'); return }
    if (toText.trim() && !t) { setPeriodError('Data final inválida (DD/MM/AAAA)'); return }
    if (f && t && f > t) { setPeriodError('A data inicial deve ser anterior à data final'); return }
    setPeriodError(undefined)
    setAppliedFrom(f)
    setAppliedTo(t)
    clearSelection()
  }

  function clearPeriod() {
    setFromText(''); setToText(''); setPeriodError(undefined)
    setAppliedFrom(null); setAppliedTo(null)
    clearSelection()
  }

  const hasPeriod = !!appliedFrom || !!appliedTo

  // Pagar todos os pendentes do filtro atual (profissional + período).
  function payAllForFilter() {
    payMutation.mutate({
      professional_id: professionalId ?? undefined,
      from: appliedFrom ?? undefined,
      to: appliedTo ?? undefined,
    })
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={s.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>Comissões</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
      >
        {/* Filtro por profissional — apenas owner/admin */}
        {canManage && (professionals as any[]).length > 0 && (
          <View>
            <Text style={s.filterLabel}>Profissional</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
              <TouchableOpacity
                onPress={() => { setProfessionalId(null); clearSelection() }}
                style={[s.chip, professionalId === null && s.chipActive]}
                accessibilityRole="button"
                accessibilityLabel="Todos os profissionais"
              >
                <Text style={[s.chipText, professionalId === null && s.chipTextActive]}>Todos</Text>
              </TouchableOpacity>
              {(professionals as any[]).map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { setProfessionalId(p.id); clearSelection() }}
                  style={[s.chip, professionalId === p.id && s.chipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Filtrar por ${p.name}`}
                >
                  <Text style={[s.chipText, professionalId === p.id && s.chipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Filtro por status */}
        <View>
          <Text style={s.filterLabel}>Status</Text>
          <View style={s.statusRow}>
            {STATUS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                onPress={() => { setStatus(opt.key); clearSelection() }}
                style={[s.statusBtn, status === opt.key && s.statusBtnActive]}
                accessibilityRole="button"
                accessibilityLabel={`Status ${opt.label}`}
              >
                <Text style={[s.statusText, status === opt.key && s.statusTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Filtro por período (SAL-10) */}
        <View style={s.periodCard}>
          <Text style={s.filterLabel}>Período</Text>
          <View style={s.periodRow}>
            <View style={{ flex: 1 }}>
              <Input
                label="De"
                value={fromText}
                onChangeText={(v) => { setFromText(maskDate(v)); setPeriodError(undefined) }}
                placeholder="DD/MM/AAAA"
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                label="Até"
                value={toText}
                onChangeText={(v) => { setToText(maskDate(v)); setPeriodError(undefined) }}
                placeholder="DD/MM/AAAA"
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
          </View>
          {periodError ? <Text style={s.periodError}>{periodError}</Text> : null}
          <View style={s.periodActions}>
            <TouchableOpacity
              onPress={applyPeriod}
              style={[s.periodBtn, s.periodBtnPrimary]}
              accessibilityRole="button"
              accessibilityLabel="Aplicar filtro de período"
            >
              <Text style={s.periodBtnPrimaryText}>Aplicar</Text>
            </TouchableOpacity>
            {hasPeriod && (
              <TouchableOpacity
                onPress={clearPeriod}
                style={s.periodBtn}
                accessibilityRole="button"
                accessibilityLabel="Limpar filtro de período"
              >
                <Text style={s.periodBtnText}>Limpar</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Totais */}
        <View style={s.kpiRow}>
          <View style={[s.kpi, { backgroundColor: '#FFF7ED' }]}>
            <Text style={s.kpiLabel}>A receber</Text>
            <Text style={[s.kpiValue, { color: colors.warning }]}>{fmtBRL(totals?.pending_amount ?? 0)}</Text>
          </View>
          <View style={[s.kpi, { backgroundColor: '#ECFDF5' }]}>
            <Text style={s.kpiLabel}>Pago</Text>
            <Text style={[s.kpiValue, { color: colors.success }]}>{fmtBRL(totals?.paid_amount ?? 0)}</Text>
          </View>
        </View>

        {/* Barra de ações da seleção (owner/admin) */}
        {canManage && selectedVisible.length > 0 && (
          <View style={s.selectionBar}>
            <View style={s.selectionInfo}>
              <Text style={s.selectionCount}>
                {selectedVisible.length} {selectedVisible.length === 1 ? 'selecionada' : 'selecionadas'}
              </Text>
              <TouchableOpacity onPress={clearSelection} accessibilityRole="button" accessibilityLabel="Limpar seleção">
                <Text style={s.selectionClear}>Limpar</Text>
              </TouchableOpacity>
            </View>
            <View style={s.selectionActions}>
              {selectedPending.length > 0 && (
                <TouchableOpacity
                  style={[s.selActionBtn, s.selActionPay, isMutating && { opacity: 0.6 }]}
                  disabled={isMutating}
                  onPress={() => payMutation.mutate({ ids: selectedPending.map((c) => c.id) })}
                  accessibilityRole="button"
                  accessibilityLabel="Marcar selecionadas como pagas"
                >
                  <Ionicons name="checkmark-done-outline" size={16} color="#fff" />
                  <Text style={s.selActionPayText}>Marcar pago ({selectedPending.length})</Text>
                </TouchableOpacity>
              )}
              {selectedPaid.length > 0 && (
                <TouchableOpacity
                  style={[s.selActionBtn, s.selActionRefund, isMutating && { opacity: 0.6 }]}
                  disabled={isMutating}
                  onPress={() => setConfirmRefund({ ids: selectedPaid.map((c) => c.id) })}
                  accessibilityRole="button"
                  accessibilityLabel="Reverter selecionadas para pendente"
                >
                  <Ionicons name="arrow-undo-outline" size={16} color={colors.danger} />
                  <Text style={s.selActionRefundText}>Reverter ({selectedPaid.length})</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* Marcar como pago (todos do filtro) — apenas owner/admin */}
        {canManage && selectedVisible.length === 0 && (totals?.pending_amount ?? 0) > 0 && (
          <TouchableOpacity
            style={[s.payBtn, isMutating && { opacity: 0.6 }]}
            disabled={isMutating}
            onPress={() => setConfirmPayAll(true)}
            accessibilityRole="button"
            accessibilityLabel="Marcar todas as comissões pendentes do filtro como pagas"
          >
            {payMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
            )}
            <Text style={s.payBtnText}>
              {professionalId || hasPeriod ? 'Marcar como pago (filtro atual)' : 'Marcar tudo como pago'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Lista */}
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : isError ? (
          <View style={s.errorBox}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textDisabled} />
            <Text style={s.errorText}>Não foi possível carregar as comissões.</Text>
            <TouchableOpacity onPress={() => refetch()} style={s.retryBtn} accessibilityRole="button">
              <Text style={s.retryText}>Tentar novamente</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <Text style={s.empty}>Nenhuma comissão ainda.</Text>
        ) : (
          <View style={s.list}>
            {items.map((c) => {
              const customer = [c.customer_name, c.customer_last_name].filter(Boolean).join(' ')
              const isSelected = selected.has(c.id)
              const Row: any = canManage ? TouchableOpacity : View
              return (
                <Row
                  key={c.id}
                  style={[s.card, isSelected && s.cardSelected]}
                  {...(canManage
                    ? {
                        activeOpacity: 0.7,
                        onPress: () => toggleItem(c.id),
                        accessibilityRole: 'checkbox',
                        accessibilityState: { checked: isSelected },
                        accessibilityLabel: `Comissão ${c.service_name}, ${fmtBRL(Number(c.amount))}, ${c.status === 'paid' ? 'paga' : 'pendente'}`,
                      }
                    : {})}
                >
                  <View style={s.cardRow}>
                    {canManage && (
                      <View style={[s.checkbox, isSelected && s.checkboxChecked]}>
                        {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={s.cardName}>{c.service_name}</Text>
                      {customer ? <Text style={s.cardSub}>{customer}</Text> : null}
                      <Text style={s.cardMeta}>
                        {canManage ? `${c.professional_name} · ` : ''}{fmtDate(c.starts_at)}
                      </Text>
                    </View>
                    <View style={s.cardRight}>
                      <Text style={s.cardValue}>{fmtBRL(Number(c.amount))}</Text>
                      <View style={[s.badge, c.status === 'paid' ? s.badgePaid : s.badgePending]}>
                        <Text style={[s.badgeText, c.status === 'paid' ? s.badgeTextPaid : s.badgeTextPending]}>
                          {c.status === 'paid' ? 'Pago' : 'Pendente'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Row>
              )
            })}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={confirmPayAll}
        title="Marcar como pago"
        message={
          (professionalId
            ? `Marcar as comissões pendentes de ${(professionals as any[]).find((p) => p.id === professionalId)?.name ?? 'profissional'}`
            : 'Marcar todas as comissões pendentes') +
          (hasPeriod ? ' do período selecionado' : '') +
          ' como pagas?'
        }
        confirmLabel="Marcar como pago"
        loading={payMutation.isPending}
        onConfirm={payAllForFilter}
        onCancel={() => setConfirmPayAll(false)}
      />

      <ConfirmDialog
        visible={!!confirmRefund}
        title="Reverter para pendente"
        message={`Reverter ${confirmRefund?.ids.length ?? 0} ${(confirmRefund?.ids.length ?? 0) === 1 ? 'comissão paga' : 'comissões pagas'} para pendente? Isso desfaz o pagamento registrado.`}
        confirmLabel="Reverter"
        variant="danger"
        loading={refundMutation.isPending}
        onConfirm={() => confirmRefund && refundMutation.mutate({ ids: confirmRefund.ids })}
        onCancel={() => setConfirmRefund(null)}
      />
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  content: { padding: spacing.lg, paddingTop: 0, gap: spacing.md },
  filterLabel: {
    fontSize: font.sm, fontWeight: '600', color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
  statusRow: {
    flexDirection: 'row', backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg, padding: 4, gap: 4,
  },
  statusBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center' },
  statusBtnActive: { backgroundColor: colors.surface },
  statusText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  statusTextActive: { color: colors.text },
  kpiRow: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  kpiLabel: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  kpiValue: { fontSize: font.lg, fontWeight: '800' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md,
  },
  payBtnText: { color: '#fff', fontWeight: '700', fontSize: font.md },
  // Período
  periodCard: { gap: spacing.sm },
  periodRow: { flexDirection: 'row', gap: spacing.sm },
  periodError: { fontSize: font.sm, color: colors.danger },
  periodActions: { flexDirection: 'row', gap: spacing.sm },
  periodBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface,
  },
  periodBtnText: { color: colors.textSecondary, fontWeight: '700', fontSize: font.sm },
  periodBtnPrimary: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  periodBtnPrimaryText: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
  // Seleção
  selectionBar: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1.5, borderColor: colors.primary },
  selectionInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionCount: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  selectionClear: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  selectionActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  selActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full },
  selActionPay: { backgroundColor: colors.primary },
  selActionPayText: { color: '#fff', fontWeight: '700', fontSize: font.sm },
  selActionRefund: { backgroundColor: colors.danger + '15', borderWidth: 1.5, borderColor: colors.danger + '55' },
  selActionRefundText: { color: colors.danger, fontWeight: '700', fontSize: font.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  cardSelected: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  cardMeta: { fontSize: font.sm, color: colors.textDisabled, marginTop: 2 },
  cardRight: { alignItems: 'flex-end', gap: spacing.xs },
  cardValue: { fontSize: font.md, fontWeight: '800', color: colors.text },
  badge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  badgePending: { backgroundColor: '#FFF7ED' },
  badgePaid: { backgroundColor: '#ECFDF5' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeTextPending: { color: colors.warning },
  badgeTextPaid: { color: colors.success },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xl, fontSize: font.md },
  errorBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  errorText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.primaryLight,
  },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
})
