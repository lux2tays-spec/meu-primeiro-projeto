import { useEffect, useMemo, useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Modal, TextInput, ActivityIndicator, Linking, KeyboardAvoidingView, Platform, PanResponder,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { appointmentsApi, appointmentsApiExt, tenantApi, slotsApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'
import { useTheme } from '@/lib/theme-context'

// ─────────────────────────────────────────────────────────────────────────────
// Types + helpers
// ─────────────────────────────────────────────────────────────────────────────

interface Appt {
  id: string
  starts_at: string
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled'
  customer_name: string
  customer_last_name?: string | null
  customer_phone: string
  professional_name: string
  service_name: string
  duration_minutes: number
  price: number | string
  professional_id: string
  service_id: string
  customer_id: string
  notes?: string | null
  created_by?: string | null
}

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
]

const STATUS_META: Record<Appt['status'], { label: string; bg: string; fg: string }> = {
  pending:   { label: 'Pendente',   bg: '#FEF3C7', fg: colors.warning },
  confirmed: { label: 'Confirmado', bg: '#DCFCE7', fg: colors.success },
  completed: { label: 'Realizado',  bg: '#DBEAFE', fg: colors.info },
  cancelled: { label: 'Cancelado',  bg: '#FEE2E2', fg: colors.danger },
}

const STATUS_OPTIONS: { value: Appt['status']; label: string }[] = [
  { value: 'pending',   label: 'Pendente' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'completed', label: 'Realizado' },
  { value: 'cancelled', label: 'Cancelado' },
]

function toISO(d: Date) {
  // Local date components — not toISOString() (UTC), which shifts the day when
  // `d` carries an evening time in a negative-offset TZ (e.g. after 21h in Brazil).
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Converte um valor digitado (aceita "135", "135,50", "1.234,56", "135.50") para
// número. Usa o ÚLTIMO separador como decimal e trata o resto como milhar.
function parseBRLPrice(raw: string): number {
  const cleaned = raw.replace(/[^0-9.,]/g, '')
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'))
  if (lastSep === -1) return parseFloat(cleaned) || 0
  const intPart = cleaned.slice(0, lastSep).replace(/[.,]/g, '')
  const decPart = cleaned.slice(lastSep + 1).replace(/[.,]/g, '')
  return parseFloat(`${intPart}.${decPart}`) || 0
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function formatBRL(v: number | string) {
  const n = Number(v)
  return `R$ ${(Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')}`
}

function onlyDigits(s: string) {
  return (s ?? '').replace(/\D/g, '')
}

function timeHM(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** HH:MM no fuso de São Paulo — mesmo fuso usado ao salvar o agendamento. */
function timeHMSaoPaulo(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}

/** YYYY-MM-DD no fuso de São Paulo. */
function dateSaoPaulo(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function fullName(a: Appt) {
  return [a.customer_name, a.customer_last_name].filter(Boolean).join(' ')
}

function dateLabelPt(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const toast = useToast()
  const theme = useTheme()
  const queryClient = useQueryClient()
  const { role, userId } = useAuthStore()
  const canManage = role === 'owner' || role === 'admin' || role === 'root'

  // Day strip: stripBase-7 .. stripBase+7 (scrollable), chevrons shift the window
  const [selected, setSelected] = useState(new Date())
  const [stripBase, setStripBase] = useState(new Date())
  // Seletor de mês/dia: permite pular direto para qualquer data (inclusive
  // trocando de mês), em vez de avançar semana a semana.
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const stripDates = useMemo(
    () => Array.from({ length: 15 }, (_, i) => addDays(stripBase, i - 7)),
    [stripBase]
  )

  // Deslizar o dedo para os lados sobre a lista troca de semana (−7 / +7 dias).
  // Só captura o gesto quando é claramente horizontal, para não atrapalhar o
  // scroll vertical dos agendamentos.
  const shiftWeek = (dir: 1 | -1) => setSelected((prev) => { const n = addDays(prev, dir * 7); setStripBase(n); return n })
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -40) shiftWeek(1) // arrastou p/ esquerda → próxima semana
          else if (g.dx >= 40) shiftWeek(-1) // arrastou p/ direita → semana anterior
        },
      }),
    []
  )

  // Search + filters
  const [searchText, setSearchText] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [professionalFilter, setProfessionalFilter] = useState<any | null>(null)
  const [serviceFilter, setServiceFilter] = useState<any | null>(null)
  const [pickerFor, setPickerFor] = useState<'professional' | 'service' | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText.trim()), 400)
    return () => clearTimeout(t)
  }, [searchText])

  const dateStr = toISO(selected)
  const todayStr = toISO(new Date())

  const { data: appointments, isLoading, isError, isRefetching, refetch } = useQuery({
    queryKey: ['appointments', dateStr, debouncedSearch, professionalFilter?.id ?? null, serviceFilter?.id ?? null],
    queryFn: () => appointmentsApi.search({
      date: dateStr,
      search: debouncedSearch || undefined,
      professional_id: professionalFilter?.id,
      service_id: serviceFilter?.id,
    }) as Promise<Appt[]>,
  })

  const { data: professionals } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })
  const { data: services } = useQuery({ queryKey: ['services'], queryFn: () => tenantApi.services() })

  // Ocupação por dia na faixa de dias (SAL-9): busca os agendamentos do período
  // visível e conta por dia (cancelados fora).
  const stripFrom = toISO(stripDates[0])
  const stripTo = toISO(stripDates[stripDates.length - 1])
  const { data: rangeAppointments } = useQuery({
    queryKey: ['appointments-range', stripFrom, stripTo],
    queryFn: () => appointmentsApi.search({
      from: new Date(`${stripFrom}T00:00:00-03:00`).toISOString(),
      to: new Date(`${stripTo}T23:59:59-03:00`).toISOString(),
    }) as Promise<Appt[]>,
  })
  const dayCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const a of rangeAppointments ?? []) {
      if (a.status === 'cancelled') continue
      const key = dateSaoPaulo(a.starts_at)
      m[key] = (m[key] ?? 0) + 1
    }
    return m
  }, [rangeAppointments])

  const sorted = useMemo(
    () => (appointments ?? []).slice().sort(
      (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
    ),
    [appointments]
  )

  // ── Edit modal state ──────────────────────────────────────────────────────
  const [editing, setEditing] = useState<Appt | null>(null)
  const [editServiceId, setEditServiceId] = useState<string>('')
  const [editProfessionalId, setEditProfessionalId] = useState<string>('')
  const [editDate, setEditDate] = useState<string>('')
  const [editTime, setEditTime] = useState<string>('')
  const [editStatus, setEditStatus] = useState<Appt['status']>('pending')
  const [editCustomerName, setEditCustomerName] = useState<string>('')
  const [editCustomerLastName, setEditCustomerLastName] = useState<string>('')
  const [editNotes, setEditNotes] = useState<string>('')
  // Valor editável do agendamento (grava em price_snapshot). String para o input.
  const [editPrice, setEditPrice] = useState<string>('')
  // Data/horário originais do agendamento — o horário atual continua selecionável
  // mesmo que o backend não o liste como "livre" (está ocupado por ele próprio).
  const [editOriginalDate, setEditOriginalDate] = useState<string>('')
  const [editOriginalTime, setEditOriginalTime] = useState<string>('')

  // Disponibilidade (slots) para a remarcação — em vez de digitar horário livre.
  const { data: editSlots, isLoading: loadingEditSlots } = useQuery({
    queryKey: ['slots', editProfessionalId, editServiceId, editDate],
    queryFn: () => slotsApi.getSlots(editProfessionalId, editServiceId, editDate),
    enabled: !!editing && !!editProfessionalId && !!editServiceId && !!editDate,
  })
  const editSlotTimes = useMemo(
    () => (editSlots ?? []).map((iso) => timeHMSaoPaulo(iso)),
    [editSlots]
  )
  const showOriginalSlot =
    !!editing && editDate === editOriginalDate && !editSlotTimes.includes(editOriginalTime)

  // Quem pode editar: owner/admin/root editam tudo; staff edita os agendamentos
  // que criou OU em que é o profissional designado (mesma regra do backend em
  // canEditAppointment). O mapa professional_id → user_id vem de /tenant/professionals.
  const profUserById = useMemo(() => {
    const m: Record<string, string | null> = {}
    for (const p of (professionals ?? []) as any[]) m[p.id] = p.user_id ?? null
    return m
  }, [professionals])

  function canEditAppt(a: Appt) {
    if (canManage) return true
    if (!userId) return false
    return a.created_by === userId || profUserById[a.professional_id] === userId
  }

  function openEdit(a: Appt) {
    setEditing(a)
    setEditServiceId(a.service_id)
    setEditProfessionalId(a.professional_id)
    // Data/hora sempre exibidas no fuso de São Paulo — o mesmo usado ao salvar,
    // para que abrir e salvar sem mexer não desloque o horário.
    const date = dateSaoPaulo(a.starts_at)
    const time = timeHMSaoPaulo(a.starts_at)
    setEditDate(date)
    setEditTime(time)
    setEditOriginalDate(date)
    setEditOriginalTime(time)
    setEditStatus(a.status)
    setEditCustomerName(a.customer_name ?? '')
    setEditCustomerLastName(a.customer_last_name ?? '')
    setEditNotes(a.notes ?? '')
    // Valor efetivo — a lista já retorna COALESCE(price_snapshot, s.price) em `price`.
    setEditPrice(String(Number(a.price ?? 0)))
  }

  const editMutation = useMutation({
    mutationFn: async () => {
      // Nome do cliente mudou? Atualiza primeiro o cadastro do cliente.
      const name = editCustomerName.trim()
      const lastName = editCustomerLastName.trim()
      const nameChanged =
        name !== (editing!.customer_name ?? '').trim() ||
        lastName !== (editing!.customer_last_name ?? '').trim()
      if (nameChanged) {
        await tenantApi.updateCustomer(editing!.customer_id, { name, last_name: lastName })
      }
      // Horário digitado é horário de São Paulo (UTC−03) → converter para UTC "Z",
      // igual à correção dos slots no backend, para gravar o instante certo
      // independente do fuso do aparelho.
      const startsAt = new Date(`${editDate}T${editTime}:00-03:00`)
      return appointmentsApiExt.put(editing!.id, {
        professional_id: editProfessionalId,
        service_id: editServiceId,
        starts_at: startsAt.toISOString(),
        status: editStatus,
        notes: editNotes.trim() ? editNotes.trim() : null,
        // Valor editado grava em price_snapshot (vazio limpa o override).
        price_snapshot: editPrice.trim() === '' ? null : parseBRLPrice(editPrice),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-range'] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
      if (editing) {
        queryClient.invalidateQueries({ queryKey: ['appointment', editing.id] })
        queryClient.invalidateQueries({ queryKey: ['customer', editing.customer_id] })
      }
      setEditing(null)
      toast.show('Agendamento atualizado!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar as alterações.', 'error'),
  })

  function saveEdit() {
    if (!editCustomerName.trim()) {
      toast.show('Informe o nome do cliente.', 'warning')
      return
    }
    if (!TIME_RE.test(editTime)) {
      toast.show('Escolha um horário disponível.', 'warning')
      return
    }
    // Só aceita horário que esteja entre os disponíveis (ou o horário atual do
    // próprio agendamento, quando data não mudou).
    const isOriginal = editDate === editOriginalDate && editTime === editOriginalTime
    if (editSlots !== undefined && !editSlotTimes.includes(editTime) && !isOriginal) {
      toast.show('Esse horário não está mais disponível. Escolha um dos horários livres.', 'warning')
      return
    }
    editMutation.mutate()
  }

  function openWhatsApp(phone: string) {
    const digits = onlyDigits(phone)
    if (!digits) {
      toast.show('Cliente sem telefone cadastrado.', 'warning')
      return
    }
    Linking.openURL('https://wa.me/' + digits).catch(() =>
      toast.show('Não foi possível abrir o WhatsApp.', 'error')
    )
  }

  // ── Bulk reschedule (owner/admin only) ────────────────────────────────────
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFrom, setBulkFrom] = useState(todayStr)
  const [bulkTo, setBulkTo] = useState(todayStr)
  const [bulkFromTime, setBulkFromTime] = useState('00:00')
  const [bulkToTime, setBulkToTime] = useState('23:59')
  const [bulkProfessionalId, setBulkProfessionalId] = useState<string | null>(null)
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkConfirm, setBulkConfirm] = useState(false)
  // SAL-16: quantos agendamentos serão cancelados (prévia via dry-run) antes de confirmar.
  const [bulkPreviewCount, setBulkPreviewCount] = useState<number | null>(null)

  function openBulk() {
    const t = toISO(new Date())
    setBulkFrom(t)
    setBulkTo(t)
    setBulkFromTime('00:00')
    setBulkToTime('23:59')
    setBulkProfessionalId(null)
    setBulkMessage('')
    setBulkOpen(true)
  }

  // Payload compartilhado pela prévia (dry-run) e pela execução real.
  // Horários digitados são horário de São Paulo (UTC−03) → converter para UTC "Z".
  function bulkPayload(dryRun: boolean) {
    return {
      from: new Date(`${bulkFrom}T${bulkFromTime}:00-03:00`).toISOString(),
      to: new Date(`${bulkTo}T${bulkToTime}:59-03:00`).toISOString(), // inclusivo até o fim do minuto final
      professional_id: bulkProfessionalId ?? undefined,
      message: bulkMessage.trim() || undefined,
      ...(dryRun ? { dry_run: true } : {}),
    }
  }

  // SAL-16: prévia — pergunta ao backend quantos serão cancelados, sem cancelar
  // nem notificar ninguém, e só então abre a confirmação com o número real.
  const previewMutation = useMutation({
    mutationFn: () => appointmentsApi.bulkReschedule(bulkPayload(true)),
    onSuccess: (res) => {
      setBulkPreviewCount(res.affected)
      setBulkConfirm(true)
    },
    onError: (err: any) => {
      toast.show(err.message ?? 'Não foi possível calcular a prévia. Tente novamente.', 'error')
    },
  })

  const bulkMutation = useMutation({
    mutationFn: () => appointmentsApi.bulkReschedule(bulkPayload(false)),
    onSuccess: (res) => {
      setBulkConfirm(false)
      setBulkOpen(false)
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-range'] })
      toast.show(`${res.notified} clientes avisados`, 'success')
    },
    onError: (err: any) => {
      setBulkConfirm(false)
      toast.show(err.message ?? 'Não foi possível remarcar os agendamentos.', 'error')
    },
  })

  function confirmBulk() {
    if (!TIME_RE.test(bulkFromTime) || !TIME_RE.test(bulkToTime)) {
      toast.show('Horário inválido. Use o formato HH:MM (ex.: 14:30).', 'warning')
      return
    }
    if (`${bulkTo}T${bulkToTime}` <= `${bulkFrom}T${bulkFromTime}`) {
      toast.show('O horário final deve ser depois do horário inicial.', 'warning')
      return
    }
    // Busca a prévia antes de confirmar (SAL-16).
    setBulkPreviewCount(null)
    previewMutation.mutate()
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const monthLabel = `${MONTHS[selected.getMonth()]} ${selected.getFullYear()}`
  const hasFilters = !!professionalFilter || !!serviceFilter || !!debouncedSearch

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Month header */}
      <View style={styles.monthRow}>
        <TouchableOpacity onPress={() => setStripBase(addDays(stripBase, -7))} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.monthLabelBtn}
          onPress={() => setDatePickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Escolher uma data"
        >
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
        </TouchableOpacity>
        <View style={styles.monthActions}>
          <TouchableOpacity
            style={styles.todayBtn}
            onPress={() => { const now = new Date(); setSelected(now); setStripBase(now) }}
          >
            <Text style={styles.todayBtnText}>Hoje</Text>
          </TouchableOpacity>
          {canManage && (
            <TouchableOpacity onPress={openBulk} hitSlop={8} style={styles.bulkBtn}>
              <Ionicons name="megaphone-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setStripBase(addDays(stripBase, 7))} hitSlop={8}>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Day strip (horizontal) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.weekStrip}
        contentOffset={{ x: 7 * 56 - spacing.lg, y: 0 }}
      >
        {stripDates.map((d) => {
          const iso = toISO(d)
          const isSelected = iso === dateStr
          const isToday = iso === todayStr
          const count = dayCounts[iso] ?? 0
          return (
            <TouchableOpacity
              key={iso}
              style={[styles.dayBtn, isSelected && { backgroundColor: theme.primary }]}
              onPress={() => setSelected(d)}
              accessibilityRole="button"
              accessibilityLabel={`${d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}, ${count} ${count === 1 ? 'agendamento' : 'agendamentos'}`}
            >
              <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>
                {DAYS[d.getDay()]}
              </Text>
              <Text style={[styles.dayNum, isSelected && styles.dayTextSelected, isToday && !isSelected && { color: theme.primary }]}>
                {d.getDate()}
              </Text>
              {/* Indicador de ocupação do dia */}
              {count > 0 ? (
                <View style={[styles.dayCountBadge, isSelected && styles.dayCountBadgeSelected]}>
                  <Text style={[styles.dayCountText, { color: theme.primary }, isSelected && styles.dayCountTextSelected]}>
                    {count > 9 ? '9+' : count}
                  </Text>
                </View>
              ) : (
                <View style={styles.dayCountPlaceholder} />
              )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {/* Search + filters */}
      <View style={styles.filtersBlock}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar cliente por nome ou telefone..."
            placeholderTextColor={colors.textDisabled}
            value={searchText}
            onChangeText={setSearchText}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.textDisabled} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, professionalFilter && styles.filterChipActive]}
            onPress={() => setPickerFor('professional')}
          >
            <Ionicons name="person-outline" size={14} color={professionalFilter ? colors.primary : colors.textSecondary} />
            <Text style={[styles.filterChipText, professionalFilter && styles.filterChipTextActive]} numberOfLines={1}>
              {professionalFilter?.name ?? 'Profissional'}
            </Text>
            <Ionicons name="chevron-down" size={13} color={professionalFilter ? colors.primary : colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, serviceFilter && styles.filterChipActive]}
            onPress={() => setPickerFor('service')}
          >
            <Ionicons name="cut-outline" size={14} color={serviceFilter ? colors.primary : colors.textSecondary} />
            <Text style={[styles.filterChipText, serviceFilter && styles.filterChipTextActive]} numberOfLines={1}>
              {serviceFilter?.name ?? 'Serviço'}
            </Text>
            <Ionicons name="chevron-down" size={13} color={serviceFilter ? colors.primary : colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Appointments for selected day */}
      <ScrollView
        {...swipe.panHandlers}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <Text style={styles.listTitle}>
          {selected.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : isError ? (
          <View style={styles.errorBox}>
            <Ionicons name="cloud-offline-outline" size={36} color={colors.textDisabled} />
            <Text style={styles.errorText}>Não foi possível carregar a agenda.</Text>
            <Button label="Tentar novamente" variant="outline" onPress={() => refetch()} />
          </View>
        ) : !sorted.length ? (
          <Text style={styles.empty}>
            {hasFilters ? 'Nenhum agendamento encontrado com esses filtros.' : 'Nenhum agendamento nesse dia.'}
          </Text>
        ) : (
          sorted.map((a) => (
            <AgendaRow
              key={a.id}
              appointment={a}
              // Quem pode editar abre o modal; quem não pode vê os detalhes (leitura).
              onPress={() =>
                canEditAppt(a) ? openEdit(a) : router.push(`/(app)/appointments/${a.id}`)
              }
            />
          ))
        )}

        {/* FAB */}
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({ pathname: '/(app)/appointments/new', params: { prefillDate: dateStr } })}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Novo agendamento"
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </ScrollView>

      {/* ── Filter picker modal ── */}
      <Modal visible={!!pickerFor} transparent animationType="fade" onRequestClose={() => setPickerFor(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setPickerFor(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              {pickerFor === 'professional' ? 'Filtrar por profissional' : 'Filtrar por serviço'}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              <PickerOption
                label="Todos"
                selected={pickerFor === 'professional' ? !professionalFilter : !serviceFilter}
                onPress={() => {
                  if (pickerFor === 'professional') setProfessionalFilter(null)
                  else setServiceFilter(null)
                  setPickerFor(null)
                }}
              />
              {(pickerFor === 'professional' ? professionals : services)?.map((opt: any) => (
                <PickerOption
                  key={opt.id}
                  label={opt.name}
                  sub={pickerFor === 'service' ? formatBRL(opt.price) : undefined}
                  selected={pickerFor === 'professional' ? professionalFilter?.id === opt.id : serviceFilter?.id === opt.id}
                  onPress={() => {
                    if (pickerFor === 'professional') setProfessionalFilter(opt)
                    else setServiceFilter(opt)
                    setPickerFor(null)
                  }}
                />
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Edit modal ── */}
      <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.editSheet}>
            {editing && (
              <>
                <View style={styles.editHeader}>
                  <Text style={styles.sheetTitle}>Editar agendamento</Text>
                  <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
                    <Ionicons name="close" size={22} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <ScrollView contentContainerStyle={styles.editContent} keyboardShouldPersistTaps="handled">
                  {/* Cliente (nome editável) + WhatsApp */}
                  <View style={styles.clientRow}>
                    <Text style={[styles.fieldLabel, { flex: 1 }]}>Cliente</Text>
                    <TouchableOpacity style={styles.waBtn} onPress={() => openWhatsApp(editing.customer_phone)}>
                      <Ionicons name="logo-whatsapp" size={16} color="#fff" />
                      <Text style={styles.waBtnText}>{editing.customer_phone}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.nameRow}>
                    <TextInput
                      style={[styles.nameInput, { flex: 1 }]}
                      value={editCustomerName}
                      onChangeText={setEditCustomerName}
                      placeholder="Nome do cliente"
                      placeholderTextColor={colors.textDisabled}
                      autoCapitalize="words"
                    />
                    <TextInput
                      style={[styles.nameInput, { flex: 1 }]}
                      value={editCustomerLastName}
                      onChangeText={setEditCustomerLastName}
                      placeholder="Sobrenome (opcional)"
                      placeholderTextColor={colors.textDisabled}
                      autoCapitalize="words"
                    />
                  </View>

                  {/* Serviço */}
                  <Text style={styles.fieldLabel}>Serviço</Text>
                  <View style={styles.chipWrap}>
                    {services?.map((s: any) => (
                      <SelectChip
                        key={s.id}
                        label={s.name}
                        selected={editServiceId === s.id}
                        onPress={() => {
                          setEditServiceId(s.id)
                          // Trocar de serviço traz o preço do novo serviço (ainda editável).
                          setEditPrice(String(Number(s.price ?? 0)))
                        }}
                      />
                    ))}
                  </View>

                  {/* Profissional */}
                  <Text style={styles.fieldLabel}>Profissional</Text>
                  <View style={styles.chipWrap}>
                    {professionals?.map((p: any) => (
                      <SelectChip
                        key={p.id}
                        label={p.name}
                        selected={editProfessionalId === p.id}
                        onPress={() => setEditProfessionalId(p.id)}
                      />
                    ))}
                  </View>

                  {/* Data */}
                  <Text style={styles.fieldLabel}>Data</Text>
                  <View style={styles.dateTimeRow}>
                    <DateStepper
                      value={editDate}
                      onChange={(v) => {
                        setEditDate(v)
                        // Mudou de dia → o horário anterior deixa de valer; volta ao
                        // horário atual do agendamento se retornar à data original.
                        setEditTime(v === editOriginalDate ? editOriginalTime : '')
                      }}
                    />
                  </View>

                  {/* Horários disponíveis (slots) — em vez de digitar horário livre */}
                  <Text style={styles.fieldLabel}>Horário</Text>
                  {loadingEditSlots ? (
                    <ActivityIndicator color={theme.primary} style={{ paddingVertical: spacing.sm }} />
                  ) : editSlotTimes.length === 0 && !showOriginalSlot ? (
                    <Text style={styles.noSlotsText}>
                      Sem horários disponíveis neste dia para este profissional e serviço.
                    </Text>
                  ) : (
                    <View style={styles.chipWrap}>
                      {showOriginalSlot && (
                        <SelectChip
                          label={`${editOriginalTime} (atual)`}
                          selected={editTime === editOriginalTime}
                          onPress={() => setEditTime(editOriginalTime)}
                        />
                      )}
                      {editSlotTimes.map((time) => (
                        <SelectChip
                          key={time}
                          label={time}
                          selected={editTime === time}
                          onPress={() => setEditTime(time)}
                        />
                      ))}
                    </View>
                  )}

                  {/* Status */}
                  <Text style={styles.fieldLabel}>Status</Text>
                  <View style={styles.chipWrap}>
                    {STATUS_OPTIONS.map((opt) => {
                      const meta = STATUS_META[opt.value]
                      const active = editStatus === opt.value
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.statusChipSelect, active && { backgroundColor: meta.bg, borderColor: meta.fg }]}
                          onPress={() => setEditStatus(opt.value)}
                        >
                          <Text style={[styles.statusChipSelectText, active && { color: meta.fg }]}>
                            {opt.value === 'completed' && !active ? 'Marcar como realizado' : opt.label}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>

                  {/* Observações */}
                  <Text style={styles.fieldLabel}>Observações</Text>
                  <TextInput
                    style={styles.messageInput}
                    value={editNotes}
                    onChangeText={setEditNotes}
                    placeholder="Observações internas (opcional)"
                    placeholderTextColor={colors.textDisabled}
                    multiline
                  />

                  {/* Valor (editável — grava em price_snapshot) */}
                  <Text style={styles.fieldLabel}>Valor (R$)</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={editPrice}
                    onChangeText={(v) => setEditPrice(v.replace(/[^0-9,\.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholder="0,00"
                    placeholderTextColor={colors.textDisabled}
                  />
                  <Text style={styles.priceHint}>
                    Valor cobrado neste atendimento. Altere para dar desconto ou cobrar um valor
                    diferente do padrão do serviço.
                  </Text>

                  <Button
                    label="Salvar alterações"
                    onPress={saveEdit}
                    loading={editMutation.isPending}
                  />
                  <Button
                    label="Ver detalhes completos"
                    variant="ghost"
                    onPress={() => { const id = editing.id; setEditing(null); router.push(`/(app)/appointments/${id}`) }}
                  />
                </ScrollView>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Month/date picker (pular direto para qualquer dia) ── */}
      <MonthPickerModal
        visible={datePickerOpen}
        value={selected}
        onClose={() => setDatePickerOpen(false)}
        onPick={(d) => { setSelected(d); setStripBase(d); setDatePickerOpen(false) }}
      />

      {/* ── Bulk reschedule modal (owner/admin) ── */}
      <Modal visible={bulkOpen} transparent animationType="slide" onRequestClose={() => setBulkOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.editSheet}>
            <View style={styles.editHeader}>
              <Text style={styles.sheetTitle}>Remarcação em massa</Text>
              <TouchableOpacity onPress={() => setBulkOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Fechar">
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.editContent} keyboardShouldPersistTaps="handled">
              <View style={styles.warningBox}>
                <Ionicons name="warning-outline" size={18} color={colors.danger} />
                <Text style={styles.warningText}>
                  Isso CANCELA os horários do período e envia WhatsApp pedindo remarcação. Use em urgências.
                </Text>
              </View>

              <Text style={styles.fieldLabel}>De</Text>
              <View style={styles.dateTimeRow}>
                <DateStepper value={bulkFrom} onChange={(v) => { setBulkFrom(v); if (v > bulkTo) setBulkTo(v) }} />
                <TextInput
                  style={styles.timeInput}
                  value={bulkFromTime}
                  onChangeText={setBulkFromTime}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>

              <Text style={styles.fieldLabel}>Até</Text>
              <View style={styles.dateTimeRow}>
                <DateStepper value={bulkTo} onChange={(v) => { setBulkTo(v); if (v < bulkFrom) setBulkFrom(v) }} />
                <TextInput
                  style={styles.timeInput}
                  value={bulkToTime}
                  onChangeText={setBulkToTime}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                />
              </View>

              <Text style={styles.fieldLabel}>Profissional (opcional)</Text>
              <View style={styles.chipWrap}>
                <SelectChip label="Todos" selected={!bulkProfessionalId} onPress={() => setBulkProfessionalId(null)} />
                {professionals?.map((p: any) => (
                  <SelectChip
                    key={p.id}
                    label={p.name}
                    selected={bulkProfessionalId === p.id}
                    onPress={() => setBulkProfessionalId(p.id)}
                  />
                ))}
              </View>

              <Text style={styles.fieldLabel}>Mensagem (opcional)</Text>
              <TextInput
                style={styles.messageInput}
                value={bulkMessage}
                onChangeText={setBulkMessage}
                placeholder="Ex.: Olá! Precisamos remarcar seu horário de {quando}. Pode escolher um novo horário?"
                placeholderTextColor={colors.textDisabled}
                multiline
              />
              <Text style={styles.hintText}>
                Dica: use {'{quando}'} para inserir a data e hora original do cliente na mensagem.
              </Text>

              <Button
                label="Cancelar horários e avisar clientes"
                variant="danger"
                onPress={confirmBulk}
                loading={previewMutation.isPending || bulkMutation.isPending}
              />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ConfirmDialog
        visible={bulkConfirm}
        title="Remarcação em massa"
        message={
          // SAL-16: mostra o número real de agendamentos que serão cancelados.
          bulkPreviewCount === 0
            ? `Nenhum agendamento encontrado de ${dateLabelPt(bulkFrom)} às ${bulkFromTime} até ${dateLabelPt(bulkTo)} às ${bulkToTime}${bulkProfessionalId ? ' para o profissional selecionado' : ''}. Nada será cancelado.`
            : `${bulkPreviewCount} ${bulkPreviewCount === 1 ? 'agendamento será cancelado' : 'agendamentos serão cancelados'} de ${dateLabelPt(bulkFrom)} às ${bulkFromTime} até ${dateLabelPt(bulkTo)} às ${bulkToTime}${bulkProfessionalId ? ' do profissional selecionado' : ''}. Os clientes serão avisados por WhatsApp. Deseja continuar?`
        }
        confirmLabel={bulkPreviewCount === 0 ? 'Entendi' : 'Cancelar e avisar'}
        cancelLabel="Voltar"
        variant="danger"
        loading={bulkMutation.isPending}
        onConfirm={() => {
          if (bulkPreviewCount === 0) { setBulkConfirm(false); return }
          bulkMutation.mutate()
        }}
        onCancel={() => setBulkConfirm(false)}
      />
    </SafeAreaView>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Small components
// ─────────────────────────────────────────────────────────────────────────────

function AgendaRow({ appointment: a, onPress }: { appointment: Appt; onPress: () => void }) {
  const meta = STATUS_META[a.status] ?? STATUS_META.pending
  const isCancelled = a.status === 'cancelled'
  const endTime = new Date(new Date(a.starts_at).getTime() + (a.duration_minutes ?? 0) * 60000)
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View style={rowStyles.card}>
        <View style={rowStyles.timeCol}>
          <Text style={[rowStyles.time, isCancelled && rowStyles.struck]}>{timeHM(a.starts_at)}</Text>
          <Text style={rowStyles.timeEnd}>
            {endTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        <View style={rowStyles.body}>
          <View style={rowStyles.topLine}>
            <Text style={[rowStyles.customer, isCancelled && rowStyles.struck]} numberOfLines={1}>
              {fullName(a)}
            </Text>
            <View style={[rowStyles.statusChip, { backgroundColor: meta.bg }]}>
              <Text style={[rowStyles.statusChipText, { color: meta.fg }]}>{meta.label}</Text>
            </View>
          </View>
          <Text style={[rowStyles.service, isCancelled && rowStyles.struck]} numberOfLines={1}>
            {a.service_name}
          </Text>
          <View style={rowStyles.bottomLine}>
            <View style={rowStyles.proWrap}>
              <Ionicons name="person-outline" size={12} color={colors.textSecondary} />
              <Text style={rowStyles.pro} numberOfLines={1}>{a.professional_name}</Text>
            </View>
            <Text style={[rowStyles.price, isCancelled && rowStyles.struck]}>{formatBRL(a.price)}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  )
}

function SelectChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[chipStyles.chip, selected && chipStyles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[chipStyles.chipText, selected && chipStyles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function PickerOption({ label, sub, selected, onPress }: { label: string; sub?: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={pickerStyles.option} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={[pickerStyles.optionText, selected && pickerStyles.optionTextSelected]}>{label}</Text>
        {sub && <Text style={pickerStyles.optionSub}>{sub}</Text>}
      </View>
      {selected && <Ionicons name="checkmark" size={18} color={colors.primary} />}
    </TouchableOpacity>
  )
}

function DateStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const d = new Date(value + 'T12:00:00')
  function shift(n: number) {
    onChange(toISO(addDays(d, n)))
  }
  return (
    <View style={stepperStyles.row}>
      <TouchableOpacity onPress={() => shift(-1)} hitSlop={8} style={stepperStyles.arrow}>
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
      </TouchableOpacity>
      <Text style={stepperStyles.label}>
        {d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}
      </Text>
      <TouchableOpacity onPress={() => shift(1)} hitSlop={8} style={stepperStyles.arrow}>
        <Ionicons name="chevron-forward" size={18} color={colors.primary} />
      </TouchableOpacity>
    </View>
  )
}

// Seletor de mês em JS puro (sem dependência nativa) para pular para qualquer data.
function MonthPickerModal({ visible, value, onClose, onPick }: {
  visible: boolean
  value: Date
  onClose: () => void
  onPick: (d: Date) => void
}) {
  const [cursor, setCursor] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1))
  useEffect(() => {
    if (visible) setCursor(new Date(value.getFullYear(), value.getMonth(), 1))
  }, [visible, value])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay() // 0=Dom
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

  const selectedISO = toISO(value)
  const todayISO = toISO(new Date())
  const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={monthPickerStyles.card}>
          <View style={monthPickerStyles.header}>
            <TouchableOpacity onPress={() => setCursor(new Date(year, month - 1, 1))} hitSlop={8} style={monthPickerStyles.navBtn}>
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
            </TouchableOpacity>
            <Text style={monthPickerStyles.title}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity onPress={() => setCursor(new Date(year, month + 1, 1))} hitSlop={8} style={monthPickerStyles.navBtn}>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={monthPickerStyles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={monthPickerStyles.weekday}>{w}</Text>
            ))}
          </View>

          <View style={monthPickerStyles.grid}>
            {cells.map((d, i) => {
              if (!d) return <View key={`e${i}`} style={monthPickerStyles.cell} />
              const iso = toISO(d)
              const isSelected = iso === selectedISO
              const isToday = iso === todayISO
              return (
                <TouchableOpacity
                  key={iso}
                  style={[monthPickerStyles.cell, monthPickerStyles.dayCell, isSelected && monthPickerStyles.daySelected]}
                  onPress={() => onPick(d)}
                >
                  <Text style={[
                    monthPickerStyles.dayText,
                    isToday && !isSelected && monthPickerStyles.dayToday,
                    isSelected && monthPickerStyles.dayTextSelected,
                  ]}>
                    {d.getDate()}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <TouchableOpacity style={monthPickerStyles.todayBtn} onPress={() => onPick(new Date())}>
            <Text style={monthPickerStyles.todayBtnText}>Ir para hoje</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const rowStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  timeCol: { alignItems: 'center', justifyContent: 'center', minWidth: 48 },
  time: { fontSize: font.md, fontWeight: '700', color: colors.text },
  timeEnd: { fontSize: 11, color: colors.textDisabled, marginTop: 2 },
  body: { flex: 1, gap: 3 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  customer: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  statusChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.full },
  statusChipText: { fontSize: 11, fontWeight: '700' },
  service: { fontSize: font.sm, color: colors.textSecondary },
  bottomLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  proWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  pro: { fontSize: font.sm, color: colors.textSecondary, flexShrink: 1 },
  price: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  struck: { textDecorationLine: 'line-through', color: colors.textDisabled },
})

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  chipSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  chipTextSelected: { color: colors.primary },
})

const pickerStyles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  optionText: { fontSize: font.md, color: colors.text },
  optionTextSelected: { fontWeight: '700', color: colors.primary },
  optionSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: 2 },
})

const stepperStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xs,
    height: 44,
    flex: 1,
  },
  arrow: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.sm, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
})

const monthPickerStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '86%',
    maxWidth: 360,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCell: { borderRadius: radius.full },
  daySelected: { backgroundColor: colors.primary },
  dayText: { fontSize: font.sm, fontWeight: '600', color: colors.text },
  dayToday: { color: colors.primary, fontWeight: '800' },
  dayTextSelected: { color: '#fff', fontWeight: '800' },
  todayBtn: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  todayBtnText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
})

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  monthLabelBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  monthLabel: { fontSize: font.lg, fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  monthActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  todayBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  todayBtnText: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  bulkBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekStrip: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  dayBtn: {
    width: 48,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    gap: 4,
  },
  dayBtnSelected: { backgroundColor: colors.primary },
  dayName: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  dayNum: { fontSize: font.md, fontWeight: '700', color: colors.text },
  dayTextSelected: { color: '#fff' },
  todayNum: { color: colors.primary },
  // Indicador de ocupação do dia (SAL-9)
  dayCountBadge: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCountBadgeSelected: { backgroundColor: 'rgba(255,255,255,0.9)' },
  dayCountText: { fontSize: 10, fontWeight: '800' },
  dayCountTextSelected: { color: colors.primary },
  dayCountPlaceholder: { height: 16 },
  noSlotsText: { fontSize: font.sm, color: colors.textSecondary, paddingVertical: spacing.sm },
  filtersBlock: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    height: 42,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text },
  filterRow: { flexDirection: 'row', gap: spacing.sm },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, flexShrink: 1 },
  filterChipTextActive: { color: colors.primary },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  listTitle: { fontSize: font.md, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xl, fontSize: font.md },
  errorBox: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  errorText: { color: colors.textSecondary, fontSize: font.md, textAlign: 'center' },
  fab: {
    alignSelf: 'flex-end',
    marginTop: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  // Modals
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
  },
  editHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  editContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  clientRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.xs },
  nameRow: { flexDirection: 'row', gap: spacing.sm },
  nameInput: {
    height: 44,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: font.md,
    color: colors.text,
  },
  waBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.whatsapp,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  waBtnText: { color: '#fff', fontSize: font.sm, fontWeight: '700' },
  fieldLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dateTimeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  timeInput: {
    width: 84,
    height: 44,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    textAlign: 'center',
    fontSize: font.md,
    fontWeight: '600',
    color: colors.text,
  },
  statusChipSelect: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusChipSelectText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  priceValue: { fontSize: font.lg, fontWeight: '700', color: colors.primary, marginTop: spacing.sm },
  warningBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: '#FEE2E2',
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  warningText: { flex: 1, fontSize: font.sm, color: colors.danger, fontWeight: '600', lineHeight: 19 },
  messageInput: {
    minHeight: 88,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    fontSize: font.md,
    color: colors.text,
    textAlignVertical: 'top',
  },
  hintText: { fontSize: font.sm, color: colors.textSecondary, marginBottom: spacing.sm },
  priceInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: font.md,
    fontWeight: '700',
    color: colors.text,
  },
  priceHint: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs, marginBottom: spacing.sm },
})
