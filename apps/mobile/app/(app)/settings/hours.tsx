import { View, Text, StyleSheet, ScrollView, Switch, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { hoursApi } from '@/lib/api'
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

function isValidTime(v: string) { return /^\d{2}:\d{2}$/.test(v) }

export default function HoursScreen() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [schedule, setSchedule] = useState<Schedule>(buildDefault())

  const { data: rows, isLoading } = useQuery({ queryKey: ['hours'], queryFn: () => hoursApi.get() })

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
      return hoursApi.save(payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hours'] })
      toast.show('Horários de funcionamento atualizados!', 'success')
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
                      onChangeText={(v) => setTime(day.id, 'start', v)}
                      placeholder="09:00"
                      style={styles.timeInput}
                    />
                  </View>
                  <Text style={styles.timeSep}>até</Text>
                  <View style={styles.timeField}>
                    <Text style={styles.timeLabel}>Fechamento</Text>
                    <Input
                      value={cfg.end}
                      onChangeText={(v) => setTime(day.id, 'end', v)}
                      placeholder="18:00"
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
      </ScrollView>
    </SafeAreaView>
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
})
