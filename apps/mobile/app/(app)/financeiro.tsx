import { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeiroApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'
import { MonthlyChart } from '@/components/financeiro/MonthlyChart'
import { NovaVendaSheet } from '@/components/financeiro/NovaVendaSheet'
import { NovoLancamentoSheet } from '@/components/financeiro/NovoLancamentoSheet'

const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

const VENDAS_PAGE_SIZE = 20

function fmtBRL(v: number) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
    ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** Extrai o nome de um item de ranking do resumo, seja qual for o campo usado pelo backend. */
function rankName(item: any): string {
  // O backend devolve professional_nome / servico_nome (com sufixo _nome).
  return item?.name ?? item?.professional_name ?? item?.professional_nome
    ?? item?.service_name ?? item?.servico_nome ?? item?.nome ?? '—'
}

/** Extrai o valor monetário de um item de ranking. */
function rankAmount(item: any): number {
  const v = item?.total ?? item?.receita ?? item?.valor ?? item?.amount ?? 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Extrai a quantidade (vendas/atendimentos) de um item de ranking, se houver. */
function rankCount(item: any): number | null {
  const v = item?.count ?? item?.quantidade ?? item?.qtd ?? item?.vendas ?? item?.total_vendas ?? null
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

type Tab = 'despesas' | 'projecao' | 'vendas' | 'links'

export default function FinanceiroScreen() {
  const qc = useQueryClient()
  const toast = useToast()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear]   = useState(now.getFullYear())
  const [tab, setTab]     = useState<Tab>('despesas')
  const [showNovaVenda, setShowNovaVenda] = useState(false)
  const [showNovoLancamento, setShowNovoLancamento] = useState(false)

  function afterLancamento() {
    qc.invalidateQueries({ queryKey: ['fin-resumo'] })
    qc.invalidateQueries({ queryKey: ['fin-resumo-dashboard'] })
    qc.invalidateQueries({ queryKey: ['fin-despesas'] })
    qc.invalidateQueries({ queryKey: ['fin-historico'] })
    qc.invalidateQueries({ queryKey: ['fin-vendas'] })
    setShowNovaVenda(false)
    setShowNovoLancamento(false)
  }

  const { data: despesas = [] } = useQuery({
    queryKey: ['fin-despesas', month, year],
    queryFn: () => financeiroApi.despesas(month, year),
    enabled: tab === 'despesas',
  })
  const { data: historico = [] } = useQuery({
    queryKey: ['fin-historico'],
    queryFn: () => financeiroApi.historico(6),
    enabled: tab === 'projecao',
  })

  // Link form
  const [showModal, setShowModal] = useState(false)
  const [linkTitle, setLinkTitle]       = useState('')
  const [linkDesc, setLinkDesc]         = useState('')
  const [linkAmount, setLinkAmount]     = useState('')

  const { data: resumo, isError: resumoError, isRefetching: r1, refetch: ref1 } = useQuery({
    queryKey: ['fin-resumo', month, year],
    queryFn: () => financeiroApi.resumo(month, year),
  })

  // Vendas paginadas (infinite scroll). O backend responde { data, total, page, limit }.
  const {
    data: vendasData,
    isLoading: loadingVendas,
    isError: vendasError,
    isRefetching: r2,
    refetch: ref2,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['fin-vendas', month, year],
    queryFn: ({ pageParam }) => financeiroApi.vendasPaged(month, year, pageParam, VENDAS_PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      // Resposta legada (array puro) não pagina.
      if (Array.isArray(last)) return undefined
      const loaded = (last.page ?? 1) * (last.limit ?? VENDAS_PAGE_SIZE)
      return loaded < (last.total ?? 0) ? (last.page ?? 1) + 1 : undefined
    },
    enabled: tab === 'vendas',
  })

  const vendas: any[] =
    vendasData?.pages.flatMap((p: any) => (Array.isArray(p) ? p : p?.data ?? [])) ?? []
  const vendasTotal = (() => {
    const first: any = vendasData?.pages[0]
    if (!first) return 0
    return Array.isArray(first) ? first.length : Number(first.total ?? 0)
  })()

  const { data: links = [], isLoading: loadingLinks, isError: linksError, isRefetching: r3, refetch: ref3 } = useQuery({
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
      toast.show('Link de pagamento criado!', 'success')
    },
    onError: (e: any) => toast.show(e?.message ?? 'Não foi possível criar o link. Tente novamente.', 'error'),
  })

  const deleteLink = useMutation({
    mutationFn: financeiroApi.deletePaymentLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fin-links'] }),
    onError: (e: any) => toast.show(e?.message ?? 'Não foi possível excluir o link. Tente novamente.', 'error'),
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
        scrollEventThrottle={200}
        onScroll={({ nativeEvent }) => {
          // Infinite scroll: carrega a próxima página de vendas perto do fim.
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent
          const nearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 320
          if (tab === 'vendas' && nearBottom && hasNextPage && !isFetchingNextPage) {
            fetchNextPage()
          }
        }}
      >
        {/* Header */}
        <Text style={s.title}>Financeiro</Text>

        {/* Ações rápidas */}
        <View style={s.actionRow}>
          <TouchableOpacity style={s.actionOutline} onPress={() => setShowNovaVenda(true)}>
            <Ionicons name="cart-outline" size={16} color={colors.success} />
            <Text style={[s.actionText, { color: colors.success }]}>Nova venda</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionFilled} onPress={() => setShowNovoLancamento(true)}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={[s.actionText, { color: '#fff' }]}>Novo lançamento</Text>
          </TouchableOpacity>
        </View>

        {/* Month picker */}
        <View style={s.monthRow}>
          <TouchableOpacity
            onPress={prevMonth}
            style={s.monthBtn}
            accessibilityRole="button"
            accessibilityLabel="Mês anterior"
          >
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
          </TouchableOpacity>
          <Text style={s.monthLabel}>{MONTHS[month - 1]} {year}</Text>
          <TouchableOpacity
            onPress={nextMonth}
            style={s.monthBtn}
            accessibilityRole="button"
            accessibilityLabel="Próximo mês"
          >
            <Ionicons name="chevron-forward" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Erro ao carregar o resumo — não deixa parecer "mês zerado" */}
        {resumoError ? (
          <View style={s.errorBox}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textDisabled} />
            <Text style={s.errorText}>Não foi possível carregar o resumo do mês.</Text>
            <TouchableOpacity onPress={() => ref1()} style={s.retryBtn} accessibilityRole="button">
              <Text style={s.retryText}>Tentar novamente</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* KPIs — tocar leva ao detalhe (#6/#7) */}
            <View style={s.kpiRow}>
              <TouchableOpacity style={[s.kpi, { backgroundColor: '#ECFDF5' }]} activeOpacity={0.8} onPress={() => setTab('vendas')}>
                <Text style={s.kpiLabel} numberOfLines={1}>Receita</Text>
                <Text style={[s.kpiValue, { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmtBRL(resumo?.receita_total ?? 0)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.kpi, { backgroundColor: colors.primaryLight }]} activeOpacity={0.8} onPress={() => setTab('vendas')}>
                <Text style={s.kpiLabel} numberOfLines={1}>Vendas</Text>
                <Text style={[s.kpiValue, { color: colors.primary }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{resumo?.total_vendas ?? 0}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.kpi, { backgroundColor: '#FFF7ED' }]} activeOpacity={0.8} onPress={() => router.push('/(app)/calendar' as any)}>
                <Text style={s.kpiLabel} numberOfLines={1}>Em aberto</Text>
                <Text style={[s.kpiValue, { color: colors.warning }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{resumo?.agendamentos_abertos ?? 0}</Text>
              </TouchableOpacity>
            </View>

            {/* KPIs novos: ticket médio + taxa de cancelamento */}
            <View style={s.kpiRow}>
              <TouchableOpacity style={[s.kpi, { backgroundColor: '#EEF2FF' }]} activeOpacity={0.8} onPress={() => setTab('vendas')}>
                <Text style={s.kpiLabel} numberOfLines={1}>Ticket médio</Text>
                <Text style={[s.kpiValue, { color: colors.info }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmtBRL(resumo?.ticket_medio ?? 0)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.kpi, { backgroundColor: '#FEF2F2' }]} activeOpacity={0.8} onPress={() => router.push('/(app)/calendar' as any)}>
                <Text style={s.kpiLabel} numberOfLines={1}>Cancelamentos</Text>
                <Text style={[s.kpiValue, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {Number(resumo?.taxa_cancelamento ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </Text>
                <Text style={s.kpiSub}>
                  {resumo?.agendamentos_cancelados ?? 0} de {resumo?.total_agendamentos ?? 0}
                </Text>
              </TouchableOpacity>
            </View>

            {/* KPIs financeiros: despesas + lucro */}
            <View style={s.kpiRow}>
              <TouchableOpacity style={[s.kpi, { backgroundColor: '#FEF2F2' }]} activeOpacity={0.8} onPress={() => setTab('despesas')}>
                <Text style={s.kpiLabel} numberOfLines={1}>Despesas</Text>
                <Text style={[s.kpiValue, { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fmtBRL(resumo?.despesas_total ?? 0)}</Text>
                <Text style={s.kpiSub} numberOfLines={1}>Fixas {fmtBRL(resumo?.despesas_fixas ?? 0)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.kpi, { backgroundColor: '#ECFDF5' }]} activeOpacity={0.8} onPress={() => setTab('despesas')}>
                <Text style={s.kpiLabel} numberOfLines={1}>Lucro</Text>
                <Text style={[s.kpiValue, { color: (resumo?.lucro ?? 0) >= (resumo?.meta_lucro ?? 0) && (resumo?.meta_lucro ?? 0) > 0 ? colors.success : colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  {fmtBRL(resumo?.lucro ?? 0)}
                </Text>
                <Text style={s.kpiSub}>Meta {fmtBRL(resumo?.meta_lucro ?? 0)}{(resumo?.meta_lucro ?? 0) > 0 ? ` · ${resumo?.progresso_meta ?? 0}%` : ''}</Text>
              </TouchableOpacity>
            </View>

            {/* Card de Meta de Lucro */}
            {(resumo?.meta_lucro ?? 0) > 0 ? (
              <View style={s.metaCard}>
                <View style={s.rowBetween}>
                  <Text style={s.metaTitle}>🎯 Meta de lucro do mês</Text>
                  <TouchableOpacity onPress={() => setShowNovoLancamento(true)}><Text style={s.link}>Editar</Text></TouchableOpacity>
                </View>
                <View style={s.progressTrack}>
                  <View style={[s.progressFill, { width: `${Math.max(2, Math.min(100, resumo?.progresso_meta ?? 0))}%` }]} />
                </View>
                {resumo?.meta_inatingivel ? (
                  <Text style={s.metaWarn}>Taxa + comissão somam {resumo?.pct_sobre_venda ?? 0}% — meta inatingível. Ajuste os percentuais ou a meta.</Text>
                ) : (
                  <>
                    <View style={s.metaGrid}>
                      <View style={s.metaBox}>
                        <Text style={s.metaBoxLabel}>Precisa faturar</Text>
                        <Text style={s.metaBoxValue}>{fmtBRL(resumo?.meta_vendas ?? 0)}</Text>
                      </View>
                      <View style={s.metaBox}>
                        <Text style={s.metaBoxLabel}>Ou seja</Text>
                        <Text style={s.metaBoxValue}>{resumo?.vendas_necessarias ?? 0} vendas</Text>
                        <Text style={s.metaBoxSub}>ticket {fmtBRL(resumo?.ticket_base ?? 0)}</Text>
                      </View>
                    </View>
                    <Text style={[s.metaStatus, { color: (resumo?.vendas_faltantes ?? 0) === 0 ? colors.success : colors.warning }]}>
                      {(resumo?.vendas_faltantes ?? 0) === 0 ? '✓ Meta batida!' : `Faltam ${resumo?.vendas_faltantes} venda(s) — ${resumo?.total_vendas ?? 0} de ${resumo?.vendas_necessarias ?? 0}.`}
                    </Text>
                  </>
                )}
              </View>
            ) : (
              <TouchableOpacity style={s.metaCard} onPress={() => setShowNovoLancamento(true)}>
                <Text style={s.metaTitle}>🎯 Defina sua meta de lucro</Text>
                <Text style={s.metaBoxSub}>Descubra quanto precisa faturar e quantas vendas fazer no mês.</Text>
              </TouchableOpacity>
            )}

            {/* Receita por profissional */}
            {Array.isArray(resumo?.receita_por_profissional) && resumo.receita_por_profissional.length > 0 && (
              <View style={s.rankCard}>
                <Text style={s.rankTitle}>Receita por profissional</Text>
                {resumo.receita_por_profissional.map((item: any, i: number) => (
                  <View key={`${rankName(item)}-${i}`} style={s.rankRow}>
                    <Text style={s.rankName} numberOfLines={1}>{rankName(item)}</Text>
                    <Text style={s.rankValue}>{fmtBRL(rankAmount(item))}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Serviços mais vendidos */}
            {Array.isArray(resumo?.servicos_mais_vendidos) && resumo.servicos_mais_vendidos.length > 0 && (
              <View style={s.rankCard}>
                <Text style={s.rankTitle}>Serviços mais vendidos</Text>
                {resumo.servicos_mais_vendidos.map((item: any, i: number) => {
                  const count = rankCount(item)
                  return (
                    <View key={`${rankName(item)}-${i}`} style={s.rankRow}>
                      <Text style={s.rankName} numberOfLines={1}>{rankName(item)}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        {count != null && <Text style={s.rankCount}>{count} {count === 1 ? 'venda' : 'vendas'}</Text>}
                        {rankAmount(item) > 0 && <Text style={s.rankValue}>{fmtBRL(rankAmount(item))}</Text>}
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </>
        )}

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabRow}>
          {(['despesas', 'projecao', 'vendas', 'links'] as Tab[]).map((t) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)}
              style={[s.tabBtn, tab === t && s.tabBtnActive]}>
              <Text style={[s.tabLabel, tab === t && s.tabLabelActive]}>
                {t === 'despesas' ? 'Despesas' : t === 'projecao' ? 'Projeção' : t === 'vendas' ? 'Vendas' : 'Links'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Despesas & Categorias ─────────────── */}
        {tab === 'despesas' && (
          <View style={s.rankCard}>
            {(despesas as any[]).length === 0 ? (
              <Text style={s.emptyText}>Nenhuma despesa neste mês. Use “Novo lançamento”.</Text>
            ) : (
              (despesas as any[]).map((d) => (
                <View key={d.id} style={s.despRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.despDesc} numberOfLines={1}>{d.descricao}</Text>
                    <Text style={s.despSub}>
                      {new Date(`${String(d.data).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')} · {d.subtipo}
                      {d.is_percent ? ` (${d.pct}%)` : ''}{d.recorrente ? ' · recorrente' : ''}
                    </Text>
                  </View>
                  <Text style={s.despValor}>{fmtBRL(d.valor_reais)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* ── Projeção histórica ────────────────── */}
        {tab === 'projecao' && (
          <View style={s.rankCard}>
            <Text style={s.rankTitle}>Evolução mensal</Text>
            {(historico as any[]).length === 0
              ? <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.lg }} />
              : <MonthlyChart data={historico as any[]} />}
          </View>
        )}

        {/* ── Vendas ─────────────────────────────── */}
        {tab === 'vendas' && (
          loadingVendas ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
          ) : vendasError ? (
            // Erro de rede NÃO pode parecer "mês sem vendas"
            <View style={s.errorBox}>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.textDisabled} />
              <Text style={s.errorText}>Não foi possível carregar as vendas. Verifique sua conexão.</Text>
              <TouchableOpacity onPress={() => ref2()} style={s.retryBtn} accessibilityRole="button">
                <Text style={s.retryText}>Tentar novamente</Text>
              </TouchableOpacity>
            </View>
          ) : vendas.length === 0 ? (
            <Text style={s.empty}>Nenhuma venda concluída neste período</Text>
          ) : (
            <View style={s.list}>
              {vendasTotal > 0 && (
                <Text style={s.listCount}>
                  Mostrando {vendas.length} de {vendasTotal} {vendasTotal === 1 ? 'venda' : 'vendas'}
                </Text>
              )}
              {vendas.map((v) => (
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
              {isFetchingNextPage ? (
                <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.md }} />
              ) : hasNextPage ? (
                <TouchableOpacity
                  onPress={() => fetchNextPage()}
                  style={s.loadMoreBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Carregar mais vendas"
                >
                  <Text style={s.loadMoreText}>Carregar mais</Text>
                </TouchableOpacity>
              ) : null}
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
              <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
            ) : linksError ? (
              <View style={s.errorBox}>
                <Ionicons name="cloud-offline-outline" size={32} color={colors.textDisabled} />
                <Text style={s.errorText}>Não foi possível carregar os links de pagamento.</Text>
                <TouchableOpacity onPress={() => ref3()} style={s.retryBtn} accessibilityRole="button">
                  <Text style={s.retryText}>Tentar novamente</Text>
                </TouchableOpacity>
              </View>
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
            <TouchableOpacity
              onPress={() => setShowModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Fechar"
            >
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

      <NovaVendaSheet visible={showNovaVenda} onClose={() => setShowNovaVenda(false)} onSaved={afterLancamento} />
      <NovoLancamentoSheet visible={showNovoLancamento} onClose={() => setShowNovoLancamento(false)} onSaved={afterLancamento} currentMeta={resumo?.meta_lucro ?? 0} />
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
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionOutline: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.success, backgroundColor: colors.surface },
  actionFilled: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.success },
  actionText: { fontSize: font.sm, fontWeight: '700' },
  metaCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderLeftWidth: 4, borderLeftColor: colors.success },
  metaTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: colors.success },
  metaWarn: { fontSize: font.sm, color: colors.danger },
  metaGrid: { flexDirection: 'row', gap: spacing.sm },
  metaBox: { flex: 1, backgroundColor: '#ECFDF5', borderRadius: radius.md, padding: spacing.md },
  metaBoxLabel: { fontSize: 11, color: colors.textSecondary },
  metaBoxValue: { fontSize: font.lg, fontWeight: '800', color: colors.success, marginTop: 2 },
  metaBoxSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  metaStatus: { fontSize: font.sm, fontWeight: '700' },
  despRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  despDesc: { fontSize: font.md, fontWeight: '600', color: colors.text },
  despSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
  despValor: { fontSize: font.md, fontWeight: '700', color: colors.danger },
  emptyText: { fontSize: font.sm, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  kpiRow: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, borderRadius: radius.lg, padding: spacing.md, gap: 4 },
  kpiLabel: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  kpiValue: { fontSize: font.lg, fontWeight: '800' },
  kpiSub: { fontSize: 11, color: colors.textSecondary },
  rankCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  rankTitle: { fontSize: font.md, fontWeight: '700', color: colors.text },
  rankRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, paddingVertical: 4,
  },
  rankName: { flex: 1, fontSize: font.sm, color: colors.text, fontWeight: '500' },
  rankValue: { fontSize: font.sm, fontWeight: '700', color: colors.success },
  rankCount: { fontSize: font.sm, color: colors.textSecondary },
  listCount: { fontSize: font.sm, color: colors.textDisabled, textAlign: 'center' },
  loadMoreBtn: {
    alignSelf: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.primaryLight, marginTop: spacing.xs,
  },
  loadMoreText: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
  errorBox: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  errorText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.full, backgroundColor: colors.primaryLight,
  },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: font.sm },
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
