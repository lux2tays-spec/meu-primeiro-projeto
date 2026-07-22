import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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

  const { data: professionals = [] } = useQuery({
    queryKey: ['professionals'],
    queryFn: tenantApi.professionals,
    enabled: canManage,
  })

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['commissions', professionalId, status],
    queryFn: () =>
      commissionsApi.list({
        professional_id: professionalId ?? undefined,
        status: status === 'all' ? undefined : status,
      }),
  })

  const payMutation = useMutation({
    mutationFn: () => commissionsApi.pay(professionalId ? { professional_id: professionalId } : {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['commissions'] })
      toast.show(
        res.paid_count > 0
          ? `${res.paid_count} ${res.paid_count === 1 ? 'comissão marcada como paga' : 'comissões marcadas como pagas'}.`
          : 'Nenhuma comissão pendente para pagar.',
        'success'
      )
    },
    onError: (e: any) => toast.show(e?.message ?? 'Não foi possível marcar como pago.', 'error'),
  })

  const totals = data?.totals
  const items = data?.data ?? []

  function confirmPay() {
    const proName = professionalId
      ? (professionals as any[]).find((p) => p.id === professionalId)?.name
      : null
    Alert.alert(
      'Marcar como pago',
      proName
        ? `Marcar todas as comissões pendentes de ${proName} como pagas?`
        : 'Marcar todas as comissões pendentes como pagas?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Marcar como pago', onPress: () => payMutation.mutate() },
      ]
    )
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
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
                onPress={() => setProfessionalId(null)}
                style={[s.chip, professionalId === null && s.chipActive]}
              >
                <Text style={[s.chipText, professionalId === null && s.chipTextActive]}>Todos</Text>
              </TouchableOpacity>
              {(professionals as any[]).map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setProfessionalId(p.id)}
                  style={[s.chip, professionalId === p.id && s.chipActive]}
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
                onPress={() => setStatus(opt.key)}
                style={[s.statusBtn, status === opt.key && s.statusBtnActive]}
              >
                <Text style={[s.statusText, status === opt.key && s.statusTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
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

        {/* Marcar como pago — apenas owner/admin */}
        {canManage && (totals?.pending_amount ?? 0) > 0 && (
          <TouchableOpacity
            style={[s.payBtn, payMutation.isPending && { opacity: 0.6 }]}
            disabled={payMutation.isPending}
            onPress={confirmPay}
          >
            {payMutation.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
            )}
            <Text style={s.payBtnText}>
              {professionalId ? 'Marcar como pago (profissional)' : 'Marcar como pago'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Lista */}
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : isError ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>Não foi possível carregar as comissões.</Text>
            <TouchableOpacity onPress={() => refetch()} style={s.retryBtn}>
              <Text style={s.retryText}>Tentar novamente</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <Text style={s.empty}>Nenhuma comissão ainda.</Text>
        ) : (
          <View style={s.list}>
            {items.map((c) => {
              const customer = [c.customer_name, c.customer_last_name].filter(Boolean).join(' ')
              return (
                <View key={c.id} style={s.card}>
                  <View style={s.cardRow}>
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
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
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
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
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
