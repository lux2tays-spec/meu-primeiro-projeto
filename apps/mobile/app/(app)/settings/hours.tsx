import { View, Text, StyleSheet, ScrollView, Switch, ActivityIndicator, TouchableOpacity, Alert } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState, useEffect } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { hoursApi, tenantApi } from '@/lib/api'
import { useToast } from '@/lib/toast'
import { colors, font, spacing } from '@/lib/theme'

const DAYS = [
  { id: 0, label: 'Domingo' },
  { id: 1, label: 'Segunda-feira' },
  { id: 2, label: 'Terça-feira' },
  { id: 3, label: 'Quarta-feira' },
  { id: 4, label: 'Quinta-feira' },
  { id: 5, label: 'Sexta-feira' },
  { id: 6, label: 'Sábado' },
]

type DayConfig = { enabled: boolean; start: string; end: string }
type Schedule = Record<number, DayConfig>

const DEFAULT: DayConfig = { enabled: true, start: '09:00', end: '18:00' }
const buildDefault = (): Schedule => ({
  0: { ...DEFAULT, enabled: false },
  1: { ...DEFAULT },
  2: { ...DEFAULT },
  3: { ...DEFAULT },
  4: { ...DEFAULT },
  5: { ...DEFAULT },
  6: { ...DEFAULT, enabled: false },
})

function rowsToSchedule(rows: any[]): Schedule {
  const s = buildDefault()
  DAYS.forEach((d) => { s[d.id] = { ...s[d.id], enabled: false } })
  for (const r of rows) {
    s[r.day_of_week] = { enabled: true, start: r.start_time.slice(0, 5), end: r.end_time.slice(0, 5) }
  }
  return s
}

function isValidTime(v: string) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) }

/** Máscara HH:MM enquanto digita (aceita só dígitos e insere o ":"). */
function maskTime(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** Auto-mask DD/MM/AAAA while typing */
function maskDate(v: string) {
  const digits = v.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** DD/MM/AAAA → YYYY-MM-DD (null if invalid) */
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

function formatBRDate(iso: string) {
  const [yyyy, mm, dd] = iso.split('-')
  return `${dd}/${mm}/${yyyy}`
}

/** Hoje em YYYY-MM-DD no fuso local (não UTC). */
function todayISO() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export default function HoursScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [schedule, setSchedule] = useState<Schedule>(buildDefault())
  // null = horário geral do estabelecimento; id = horário específico do profissional
  const [selectedProfId, setSelectedProfId] = useState<string | null>(null)

  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  const { data: rows, isLoading } = useQuery({
    queryKey: ['hours', selectedProfId],
    queryFn: () => hoursApi.get(selectedProfId ?? undefined),
  })

  useEffect(() => { if (rows) setSchedule(rowsToSchedule(rows)) }, [rows])

  const saveMutation = useMutation({
    mutationFn: () => {
      const enabledDays = DAYS.filter((d) => schedule[d.id].enabled)
      for (const d of enabledDays) {
        const cfg = schedule[d.id]
        if (!isValidTime(cfg.start) || !isValidTime(cfg.end)) {
          throw new Error(`Horário inválido em ${d.label}. Use o formato HH:MM`)
        }
        if (cfg.start >= cfg.end) {
          throw new Error(`Em ${d.label}, o horário de abertura deve ser antes do fechamento`)
        }
      }
      const payload = DAYS.map((d) => ({
        day_of_week: d.id,
        start_time: schedule[d.id].start,
        end_time: schedule[d.id].end,
        enabled: schedule[d.id].enabled,
      }))
      return hoursApi.save(payload, selectedProfId ?? undefined)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hours'] })
      toast.show(
        selectedProfId
          ? 'Horários do profissional atualizados!'
          : 'Horários de funcionamento atualizados!',
        'success'
      )
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível salvar os horários.', 'error'),
  })

  function toggle(dayId: number, value: boolean) {
    setSchedule((s) => ({ ...s, [dayId]: { ...s[dayId], enabled: value } }))
  }

  function setTime(dayId: number, field: 'start' | 'end', value: string) {
    setSchedule((s) => ({ ...s, [dayId]: { ...s[dayId], [field]: value } }))
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={[]}>
        <ActivityIndicator style={{ marginTop: 80 }} color={colors.primary} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Configure os dias e horários em que o bot pode realizar agendamentos.
        </Text>

        {/* Seletor de profissional (horário geral ou específico) */}
        {(professionals as any[]).length > 0 && (
          <View style={styles.profSelector}>
            <Text style={styles.profSelectorLabel}>Horários de:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profChipRow}>
              <TouchableOpacity
                onPress={() => setSelectedProfId(null)}
                style={[styles.profChip, selectedProfId === null && styles.profChipActive]}
                accessibilityRole="button"
                accessibilityLabel="Horários gerais do estabelecimento"
              >
                <Text style={[styles.profChipText, selectedProfId === null && styles.profChipTextActive]}>
                  Estabelecimento
                </Text>
              </TouchableOpacity>
              {(professionals as any[]).map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelectedProfId(p.id)}
                  style={[styles.profChip, selectedProfId === p.id && styles.profChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Horários de ${p.name}`}
                >
                  <Text style={[styles.profChipText, selectedProfId === p.id && styles.profChipTextActive]}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {selectedProfId !== null && (
              <Text style={styles.profHint}>
                Estes horários valem apenas para este profissional e substituem o horário geral.
              </Text>
            )}
          </View>
        )}
        {DAYS.map((day) => {
          const cfg = schedule[day.id]
          return (
            <Card key={day.id} style={styles.dayCard}>
              <View style={styles.dayHeader}>
                <Text style={[styles.dayLabel, !cfg.enabled && styles.dayLabelDisabled]}>
                  {day.label}
                </Text>
                <Switch
                  value={cfg.enabled}
                  onValueChange={(v) => toggle(day.id, v)}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
              {cfg.enabled && (
                <View style={styles.timeRow}>
                  <View style={styles.timeField}>
                    <Text style={styles.timeLabel}>Abertura</Text>
                    <Input
                      value={cfg.start}
                      onChangeText={(v) => setTime(day.id, 'start', maskTime(v))}
                      placeholder="09:00"
                      keyboardType="number-pad"
                      maxLength={5}
                      accessibilityLabel={`Horário de abertura de ${day.label}`}
                      style={styles.timeInput}
                    />
                  </View>
                  <Text style={styles.timeSep}>até</Text>
                  <View style={styles.timeField}>
                    <Text style={styles.timeLabel}>Fechamento</Text>
                    <Input
                      value={cfg.end}
                      onChangeText={(v) => setTime(day.id, 'end', maskTime(v))}
                      placeholder="18:00"
                      keyboardType="number-pad"
                      maxLength={5}
                      accessibilityLabel={`Horário de fechamento de ${day.label}`}
                      style={styles.timeInput}
                    />
                  </View>
                </View>
              )}
            </Card>
          )
        })}
        <Button
          label="Salvar horários"
          onPress={() => saveMutation.mutate()}
          loading={saveMutation.isPending}
        />

        <DaysOffSection />
      </ScrollView>
    </SafeAreaView>
  )
}

function DaysOffSection() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [dateError, setDateError] = useState<string | undefined>(undefined)
  // null = folga para todos os profissionais; id = folga individual
  const [dayOffProfId, setDayOffProfId] = useState<string | null>(null)

  const { data: daysOff = [], isLoading } = useQuery({ queryKey: ['days-off'], queryFn: tenantApi.daysOff })
  const { data: professionals = [] } = useQuery({ queryKey: ['professionals'], queryFn: tenantApi.professionals })

  const addMutation = useMutation({
    mutationFn: (isoDate: string) =>
      tenantApi.addDayOff({ date: isoDate, professional_id: dayOffProfId, reason: reason.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['days-off'] })
      setDate('')
      setReason('')
      setDayOffProfId(null)
      setDateError(undefined)
      toast.show('Folga adicionada!', 'success')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível adicionar a folga.', 'error'),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => tenantApi.removeDayOff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['days-off'] })
      toast.show('Folga removida.', 'info')
    },
    onError: (err: any) => toast.show(err.message ?? 'Não foi possível remover.', 'error'),
  })

  function handleAdd() {
    const iso = toISODate(date)
    if (!iso) {
      setDateError('Data inválida. Use o formato DD/MM/AAAA')
      return
    }
    // Data passada: o backend filtra folgas antigas e o item "sumiria" da lista
    // sem explicação — melhor avisar antes de salvar.
    if (iso < todayISO()) {
      setDateError('A data já passou. Escolha hoje ou uma data futura.')
      return
    }
    // Evita duplicar: mesma data para o mesmo profissional (ou já coberta por
    // uma folga geral de "Todos").
    const duplicated = (daysOff as any[]).some(
      (d) =>
        d.date === iso &&
        ((d.professional_id ?? null) === dayOffProfId || d.professional_id == null)
    )
    if (duplicated) {
      setDateError('Já existe uma folga cadastrada para esta data.')
      return
    }
    addMutation.mutate(iso)
  }

  function confirmRemove(d: any) {
    Alert.alert(
      'Remover folga',
      `Remover a folga de ${formatBRDate(d.date)}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Remover', style: 'destructive', onPress: () => removeMutation.mutate(d.id) },
      ]
    )
  }

  return (
    <View style={styles.daysOffSection}>
      <Text style={styles.daysOffTitle}>Folgas e bloqueios</Text>
      <Text style={styles.hint}>
        Datas em que não haverá atendimento (feriados, folgas...). O bot e a agenda não oferecem
        horários nessas datas.
      </Text>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.md }} />
      ) : (daysOff as any[]).length === 0 ? (
        <Card>
          <Text style={styles.daysOffEmpty}>Nenhuma folga ou bloqueio cadastrado.</Text>
        </Card>
      ) : (
        (daysOff as any[]).map((d) => (
          <Card key={d.id} style={styles.dayOffRow}>
            <Ionicons name="calendar-clear-outline" size={18} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dayOffDate}>{formatBRDate(d.date)}</Text>
              <Text style={styles.dayOffMeta}>
                {d.professional_name ?? 'Todos os profissionais'}
                {d.reason ? ` · ${d.reason}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => confirmRemove(d)} disabled={removeMutation.isPending} style={{ padding: 4 }}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </TouchableOpacity>
          </Card>
        ))
      )}

      <Card style={styles.dayOffForm}>
        <Input
          label="Data *"
          value={date}
          onChangeText={(v) => { setDate(maskDate(v)); setDateError(undefined) }}
          placeholder="DD/MM/AAAA"
          keyboardType="number-pad"
          maxLength={10}
          error={dateError}
        />
        {/* Folga geral ou de um profissional específico */}
        {(professionals as any[]).length > 0 && (
          <View style={{ gap: spacing.xs }}>
            <Text style={styles.profSelectorLabel}>Folga para</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profChipRow}>
              <TouchableOpacity
                onPress={() => setDayOffProfId(null)}
                style={[styles.profChip, dayOffProfId === null && styles.profChipActive]}
                accessibilityRole="button"
                accessibilityLabel="Folga para todos os profissionais"
              >
                <Text style={[styles.profChipText, dayOffProfId === null && styles.profChipTextActive]}>
                  Todos
                </Text>
              </TouchableOpacity>
              {(professionals as any[]).map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setDayOffProfId(p.id)}
                  style={[styles.profChip, dayOffProfId === p.id && styles.profChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Folga apenas para ${p.name}`}
                >
                  <Text style={[styles.profChipText, dayOffProfId === p.id && styles.profChipTextActive]}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        <Input
          label="Motivo (opcional)"
          value={reason}
          onChangeText={setReason}
          placeholder="Feriado, manutenção..."
        />
        <Button
          label="Adicionar folga"
          onPress={handleAdd}
          loading={addMutation.isPending}
          disabled={!date}
          variant="outline"
        />
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  hint: { fontSize: font.sm, color: colors.textSecondary, lineHeight: 20 },
  dayCard: { gap: spacing.sm },
  dayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dayLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  dayLabelDisabled: { color: colors.textDisabled },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  timeField: { flex: 1, gap: 4 },
  timeLabel: { fontSize: font.sm, color: colors.textSecondary },
  timeInput: { height: 44 },
  timeSep: { fontSize: font.sm, color: colors.textSecondary, paddingBottom: 12 },
  // Folgas e bloqueios
  daysOffSection: { gap: spacing.md, marginTop: spacing.lg },
  daysOffTitle: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  daysOffEmpty: { fontSize: font.sm, color: colors.textSecondary },
  dayOffRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayOffDate: { fontSize: font.md, fontWeight: '600', color: colors.text },
  dayOffMeta: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
  dayOffForm: { gap: spacing.md },
  // Seletor de profissional
  profSelector: { gap: spacing.xs },
  profSelectorLabel: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  profChipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  profChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 9999, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface,
  },
  profChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  profChipText: { fontSize: font.sm, fontWeight: '600', color: colors.textSecondary },
  profChipTextActive: { color: '#fff' },
  profHint: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xs },
})
