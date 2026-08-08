import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Alert, TouchableOpacity, Linking, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { tenantApi, subscriptionApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

// Compra/renovação de assinatura acontece SEMPRE na web (Mercado Pago próprio do
// dono). O app não vende plano por dentro — isso mantém a conformidade com as
// políticas de pagamento da Google Play e da Apple (assinatura de serviço digital
// dentro do app exigiria a cobrança da loja). Ver a estratégia registrada.
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://aiconfirma.com.br'
const MANAGE_URL = `${WEB_URL}/settings/subscription`

// PAY-7: os planos vêm SEMPRE do backend (/subscription/plans). Este fallback
// só é usado se a query falhar (offline etc.), para a tela não ficar vazia.
const FALLBACK_PLANS: PlanItem[] = [
  { id: 'basico',       label: 'Básico',       price: 'R$ 89,00/mês',  priceCents: 8900,  annualCents: 106800, discountPct: 0, agendas: 1,  users: 1 },
  { id: 'premium',      label: 'Premium',      price: 'R$ 169,00/mês', priceCents: 16900, annualCents: 202800, discountPct: 0, agendas: 3,  users: 3 },
  { id: 'profissional', label: 'Profissional', price: 'R$ 299,00/mês', priceCents: 29900, annualCents: 358800, discountPct: 0, agendas: 10, users: 10 },
]

type PlanItem = { id: string; label: string; price: string; priceCents: number; annualCents: number; discountPct: number; agendas: number; users: number }

type Period = 'monthly' | 'annual'
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

function formatPrice(priceCents: number) {
  return `${(priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/mês`
}

export default function SubscriptionScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data: tenant } = useQuery({ queryKey: ['tenant'], queryFn: tenantApi.me })
  const {
    data: apiPlans,
    isLoading: plansLoading,
    isError: plansError,
  } = useQuery({ queryKey: ['subscription-plans'], queryFn: subscriptionApi.plans })

  const [period, setPeriod] = useState<Period>('monthly')

  // Assinatura atual (renovação/período) e histórico de cobranças.
  const { data: sub } = useQuery({ queryKey: ['subscription-me'], queryFn: subscriptionApi.me })
  const { data: payments = [] } = useQuery({ queryKey: ['subscription-payments'], queryFn: subscriptionApi.payments })
  const [cancelling, setCancelling] = useState(false)

  // PAY-7: usa os planos do backend; o hardcode só entra se a query FALHOU
  // (ou voltou vazia). Enquanto carrega, mostra um loading em vez do fallback.
  const plans: PlanItem[] = apiPlans && apiPlans.length > 0
    ? apiPlans
        .filter((p) => p.price_cents > 0)
        .map((p) => ({
          id: p.slug,
          label: p.name,
          price: formatPrice(p.price_cents),
          priceCents: p.price_cents,
          annualCents: p.annual_price_cents ?? Math.round(p.price_cents * 12),
          discountPct: p.annual_discount_pct ?? 0,
          agendas: p.max_agendas,
          users: p.max_users,
        }))
    : plansLoading
      ? []
      : FALLBACK_PLANS

  const currentPlan = plans.find((p) => p.id === tenant?.plan)
  // Preço do ciclo selecionado (mensal x anual) e rótulo.
  const cycleCents = (p: PlanItem) => (period === 'annual' ? p.annualCents : p.priceCents)
  const cycleLabel = (p: PlanItem) => `${brl(cycleCents(p))}${period === 'annual' ? '/ano' : '/mês'}`
  const anyAnnualDiscount = plans.some((p) => p.discountPct > 0)

  // PAY-4: trial já expirado (data no passado) muda o aviso.
  const trialEndsAt = tenant?.trial_ends_at ? new Date(tenant.trial_ends_at) : null
  const isTrial = tenant?.status === 'trial'
  const trialExpired = isTrial && !!trialEndsAt && trialEndsAt.getTime() < Date.now()

  // PAY-6: rótulo conforme a mudança de plano (upgrade x downgrade).
  function planAction(plan: PlanItem): { label: string; icon: any } {
    if (!currentPlan || tenant?.plan === 'free' || isTrial) return { label: 'Assinar', icon: 'card-outline' }
    if (plan.priceCents > currentPlan.priceCents) return { label: 'Fazer upgrade', icon: 'arrow-up-circle-outline' }
    if (plan.priceCents < currentPlan.priceCents) return { label: 'Fazer downgrade', icon: 'arrow-down-circle-outline' }
    return { label: 'Assinar', icon: 'card-outline' }
  }

  async function openManage() {
    try {
      const ok = await Linking.canOpenURL(MANAGE_URL)
      if (ok) await Linking.openURL(MANAGE_URL)
      else Alert.alert('Abra no navegador', `Acesse ${MANAGE_URL} para gerenciar sua assinatura.`)
    } catch {
      Alert.alert('Abra no navegador', `Acesse ${MANAGE_URL} para gerenciar sua assinatura.`)
    }
  }

  async function handleCancelSubscription() {
    setCancelling(true)
    try {
      await subscriptionApi.cancel()
      queryClient.invalidateQueries({ queryKey: ['tenant'] })
      queryClient.invalidateQueries({ queryKey: ['subscription-me'] })
      queryClient.invalidateQueries({ queryKey: ['tenant-capabilities'] })
      toast.show('Assinatura cancelada', 'success')
    } catch (e: any) {
      // e.message já é a mensagem amigável do backend — nunca o erro cru do MP.
      Alert.alert(
        'Não foi possível cancelar',
        e?.message || 'Não foi possível cancelar agora. Tente novamente ou fale com o suporte.'
      )
    } finally {
      setCancelling(false)
    }
  }

  function confirmCancelSubscription() {
    // PAY-5: deixa claro que o cancelamento vale NA HORA (não no fim do ciclo).
    Alert.alert(
      'Cancelar assinatura',
      'O cancelamento é imediato: sua conta volta para o plano gratuito agora e os recursos do plano pago deixam de funcionar na hora. Deseja continuar?',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Cancelar agora', style: 'destructive', onPress: handleCancelSubscription },
      ]
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>

        {/* Current plan */}
        <Card style={styles.currentCard}>
          <View style={styles.currentHeader}>
            <Text style={styles.currentLabel}>Plano atual</Text>
            <Badge
              label={isTrial ? (trialExpired ? 'Trial expirado' : 'Trial') : 'Ativo'}
              variant={isTrial ? (trialExpired ? 'danger' : 'warning') : 'success'}
            />
          </View>
          <Text style={styles.planName}>{currentPlan?.label ?? (tenant?.plan === 'free' ? 'Gratuito (Trial)' : tenant?.plan)}</Text>
          {currentPlan && (
            <Text style={styles.planPrice}>
              {sub?.billing_period === 'annual' ? `${brl(currentPlan.annualCents)}/ano` : currentPlan.price}
            </Text>
          )}
          {/* Renovação */}
          {tenant?.status === 'active' && sub?.next_billing_date && (
            <View style={styles.trialInfo}>
              <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.trialText, { color: colors.textSecondary }]}>
                {sub.status === 'cancelled' ? 'Acesso até' : 'Renova em'}{' '}
                {new Date(sub.next_billing_date).toLocaleDateString('pt-BR')}
                {sub?.billing_period === 'annual' ? ' · cobrança anual' : ' · cobrança mensal'}
              </Text>
            </View>
          )}
          {/* PAY-4: data no passado = trial EXPIRADO, não "expira em..." */}
          {isTrial && (
            <View style={styles.trialInfo}>
              <Ionicons
                name={trialExpired ? 'alert-circle-outline' : 'time-outline'}
                size={16}
                color={trialExpired ? colors.danger : colors.warning}
              />
              <Text style={[styles.trialText, trialExpired && styles.trialTextExpired]}>
                {trialExpired
                  ? `Seu período de teste terminou em ${trialEndsAt!.toLocaleDateString('pt-BR')}. Assine um plano para continuar usando.`
                  : `Trial expira em ${trialEndsAt ? trialEndsAt.toLocaleDateString('pt-BR') : '—'}`}
              </Text>
            </View>
          )}
        </Card>

        {/* Gerenciar assinatura na web — a compra/renovação acontece no site,
            com pagamento seguro. Aqui no app fica o acompanhamento. */}
        <Button
          label={tenant?.plan && tenant.plan !== 'free' && !isTrial ? 'Gerenciar assinatura' : 'Assinar um plano'}
          onPress={openManage}
        />
        <View style={styles.webNote}>
          <Ionicons name="globe-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.webNoteText}>
            A contratação e a renovação são feitas com segurança no site, no seu navegador. Você mantém o acompanhamento do plano aqui.
          </Text>
        </View>

        {/* Plans comparison (informativo) */}
        <Text style={styles.sectionTitle}>Planos disponíveis</Text>

        {/* Toggle mensal / anual */}
        <View style={styles.periodToggle}>
          <TouchableOpacity
            style={[styles.periodBtn, period === 'monthly' && styles.periodBtnActive]}
            onPress={() => setPeriod('monthly')}
          >
            <Text style={[styles.periodBtnText, period === 'monthly' && styles.periodBtnTextActive]}>Mensal</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.periodBtn, period === 'annual' && styles.periodBtnActive]}
            onPress={() => setPeriod('annual')}
          >
            <Text style={[styles.periodBtnText, period === 'annual' && styles.periodBtnTextActive]}>
              Anual{anyAnnualDiscount ? ' • economize' : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {plansLoading && plans.length === 0 && (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
        )}
        {plansError && plans.length > 0 && (
          <Text style={styles.plansOfflineHint}>
            Não foi possível atualizar os planos agora — exibindo os valores de referência.
          </Text>
        )}
        {plans.map((plan) => {
          const isCurrent = plan.id === tenant?.plan
          const action = planAction(plan)
          return (
            <TouchableOpacity
              key={plan.id}
              activeOpacity={0.8}
              disabled={isCurrent}
              onPress={openManage}
            >
              <Card style={[styles.planCard, isCurrent && styles.planCardActive]}>
                <View style={styles.planRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planCardName, isCurrent && styles.planCardNameActive]}>{plan.label}</Text>
                    <Text style={styles.planCardPrice}>{cycleLabel(plan)}</Text>
                    {period === 'annual' && plan.discountPct > 0 && (
                      <Text style={styles.discountText}>
                        de {brl(plan.priceCents * 12)} — economize {plan.discountPct}%
                      </Text>
                    )}
                  </View>
                  {isCurrent && <Badge label="Atual" variant="success" />}
                </View>
                <View style={styles.planFeatures}>
                  <View style={styles.feature}>
                    <Ionicons name="calendar-outline" size={14} color={isCurrent ? colors.primaryDark : colors.textSecondary} />
                    <Text style={[styles.featureText, isCurrent && styles.featureTextActive]}>{plan.agendas} agenda{plan.agendas > 1 ? 's' : ''}</Text>
                  </View>
                  <View style={styles.feature}>
                    <Ionicons name="people-outline" size={14} color={isCurrent ? colors.primaryDark : colors.textSecondary} />
                    <Text style={[styles.featureText, isCurrent && styles.featureTextActive]}>{plan.users} usuário{plan.users > 1 ? 's' : ''}</Text>
                  </View>
                </View>
                {/* PAY-6: deixa claro se é upgrade ou downgrade — leva à web */}
                {!isCurrent && (
                  <View style={styles.subscribeRow}>
                    <Ionicons name={action.icon} size={16} color={colors.primary} />
                    <Text style={styles.subscribeText}>{action.label} na web</Text>
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          )
        })}

        {/* Cancelar — só aparece com assinatura paga ativa. Cancelamento não é
            compra, então segue no app (backend cancela no Mercado Pago). */}
        {tenant?.status === 'active' && tenant?.plan !== 'free' && (
          <View style={styles.cancelSection}>
            <Button
              label="Cancelar assinatura"
              variant="ghost"
              loading={cancelling}
              onPress={confirmCancelSubscription}
            />
            {/* PAY-5: aviso explícito de que o cancelamento vale na hora */}
            <Text style={styles.cancelHint}>
              O cancelamento é imediato: sua conta volta ao plano gratuito na hora.
            </Text>
          </View>
        )}

        {/* Histórico de cobranças */}
        {payments.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.sectionTitle}>Histórico de cobranças</Text>
            <Card style={{ gap: spacing.sm }}>
              {payments.map((pmt) => (
                <View key={pmt.mp_payment_id} style={styles.payRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payAmount}>{brl(pmt.amount_cents)}</Text>
                    <Text style={styles.payDate}>
                      {pmt.paid_at ? new Date(pmt.paid_at).toLocaleDateString('pt-BR') : '—'}
                    </Text>
                  </View>
                  <Badge
                    label={pmt.status === 'approved' ? 'Pago' : pmt.status === 'rejected' ? 'Recusado' : pmt.status === 'refunded' ? 'Estornado' : (pmt.status ?? '—')}
                    variant={pmt.status === 'approved' ? 'success' : pmt.status === 'rejected' ? 'danger' : 'warning'}
                  />
                </View>
              ))}
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  currentCard: { gap: spacing.sm },
  currentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  currentLabel: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  planName: { fontSize: font.xxl, fontWeight: '800', color: colors.text },
  planPrice: { fontSize: font.lg, color: colors.primary, fontWeight: '600' },
  trialInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  trialText: { flex: 1, fontSize: font.sm, color: colors.warning, fontWeight: '500' },
  trialTextExpired: { color: colors.danger, fontWeight: '600' },
  webNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, paddingHorizontal: 2, marginTop: -spacing.sm },
  webNoteText: { flex: 1, fontSize: font.sm, color: colors.textSecondary, lineHeight: 18 },
  plansOfflineHint: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center' },
  periodToggle: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.full, padding: 4, gap: 4 },
  periodBtn: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.full },
  periodBtnActive: { backgroundColor: colors.primary },
  periodBtnText: { fontSize: font.sm, fontWeight: '700', color: colors.textSecondary },
  periodBtnTextActive: { color: '#fff' },
  discountText: { fontSize: font.sm, color: colors.success, fontWeight: '600', marginTop: 2 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  payAmount: { fontSize: font.md, fontWeight: '700', color: colors.text },
  payDate: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  cancelSection: { gap: spacing.xs },
  cancelHint: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center' },
  sectionTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  planCard: { gap: spacing.sm },
  planCardActive: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primaryLight },
  planRow: { flexDirection: 'row', alignItems: 'flex-start' },
  planCardName: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  planCardNameActive: { color: colors.primaryDark },
  planCardPrice: { fontSize: font.md, color: colors.textSecondary, marginTop: 2 },
  planFeatures: { flexDirection: 'row', gap: spacing.lg },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  featureText: { fontSize: font.sm, color: colors.textSecondary },
  featureTextActive: { color: colors.primaryDark },
  subscribeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.xs,
  },
  subscribeText: { fontSize: font.md, fontWeight: '600', color: colors.primary },
})
