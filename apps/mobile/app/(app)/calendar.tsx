import { useState } from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { AppointmentCard } from '@/components/AppointmentCard'
import { appointmentsApi } from '@/lib/api'
import { colors, font, spacing, radius } from '@/lib/theme'

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
]

function getWeekDates(baseDate: Date) {
  const start = new Date(baseDate)
  start.setDate(baseDate.getDate() - baseDate.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

function toISO(d: Date) {
  return d.toISOString().split('T')[0]
}

export default function CalendarScreen() {
  const [selected, setSelected] = useState(new Date())
  const [weekBase, setWeekBase] = useState(new Date())
  const weekDates = getWeekDates(weekBase)

  const dateStr = toISO(selected)
  const { data: appointments, isRefetching, refetch } = useQuery({
    queryKey: ['appointments', dateStr],
    queryFn: () => appointmentsApi.list(dateStr),
  })

  function prevWeek() {
    const d = new Date(weekBase)
    d.setDate(d.getDate() - 7)
    setWeekBase(d)
  }

  function nextWeek() {
    const d = new Date(weekBase)
    d.setDate(d.getDate() + 7)
    setWeekBase(d)
  }

  const monthLabel = `${MONTHS[selected.getMonth()]} ${selected.getFullYear()}`

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Month header */}
      <View style={styles.monthRow}>
        <TouchableOpacity onPress={prevWeek}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <TouchableOpacity onPress={nextWeek}>
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Week strip */}
      <View style={styles.weekStrip}>
        {weekDates.map((d) => {
          const iso = toISO(d)
          const isSelected = iso === toISO(selected)
          const isToday = iso === toISO(new Date())
          return (
            <TouchableOpacity
              key={iso}
              style={[styles.dayBtn, isSelected && styles.dayBtnSelected]}
              onPress={() => { setSelected(d); setWeekBase(d) }}
            >
              <Text style={[styles.dayName, isSelected && styles.dayTextSelected]}>
                {DAYS[d.getDay()]}
              </Text>
              <Text style={[styles.dayNum, isSelected && styles.dayTextSelected, isToday && !isSelected && styles.todayNum]}>
                {d.getDate()}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Appointments for selected day */}
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <Text style={styles.listTitle}>
          {selected.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
        {!appointments?.length ? (
          <Text style={styles.empty}>Nenhum agendamento neste dia</Text>
        ) : (
          appointments.map((a) => (
            <AppointmentCard
              key={a.id}
              appointment={a}
              onPress={() => router.push(`/(app)/appointments/${a.id}`)}
            />
          ))
        )}

        {/* FAB */}
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({ pathname: '/(app)/appointments/new', params: { prefillDate: toISO(selected) } })}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  monthLabel: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  weekStrip: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  dayBtn: {
    flex: 1,
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
  list: { padding: spacing.lg, gap: spacing.md },
  listTitle: { fontSize: font.md, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
  empty: { color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xl, fontSize: font.md },
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
})
