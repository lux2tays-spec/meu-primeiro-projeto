import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import Svg, { Rect, Polyline, Line, Circle, Text as SvgText } from 'react-native-svg'
import { colors, font, spacing, radius } from '@/lib/theme'

// Gráfico de evolução mensal em SVG puro (react-native-svg já instalado; sem
// dependência nativa nova). Barras: receita/despesa. Linhas: lucro/meta. Séries
// selecionáveis por chips (o usuário escolhe o que ver).
type Ponto = { mes: string; receita: number; despesa: number; lucro: number; meta: number }

const SERIES = [
  { key: 'receita', label: 'Receita', color: '#22C55E' },
  { key: 'despesa', label: 'Despesa', color: '#EF4444' },
  { key: 'lucro', label: 'Lucro', color: '#3B82F6' },
  { key: 'meta', label: 'Meta', color: '#F59E0B' },
] as const

export function MonthlyChart({ data }: { data: Ponto[] }) {
  const [on, setOn] = useState<Record<string, boolean>>({ receita: true, despesa: true, lucro: true, meta: true })

  const W = 320, H = 180, padL = 8, padR = 8, padT = 10, padB = 22
  const innerW = W - padL - padR, innerH = H - padT - padB
  const n = Math.max(data.length, 1)

  const allVals: number[] = []
  data.forEach((d) => {
    if (on.receita) allVals.push(d.receita)
    if (on.despesa) allVals.push(d.despesa)
    if (on.lucro) allVals.push(d.lucro)
    if (on.meta) allVals.push(d.meta)
  })
  const max = Math.max(1, ...allVals)
  const min = Math.min(0, ...allVals)
  const range = max - min || 1
  const y = (v: number) => padT + innerH - ((v - min) / range) * innerH
  const slot = innerW / n
  const barW = Math.min(10, slot / 4)

  const linePoints = (key: 'lucro' | 'meta') =>
    data.map((d, i) => `${padL + slot * i + slot / 2},${y(d[key])}`).join(' ')

  return (
    <View>
      <View style={styles.chips}>
        {SERIES.map((s) => (
          <TouchableOpacity key={s.key} onPress={() => setOn((o) => ({ ...o, [s.key]: !o[s.key] }))}
            style={[styles.chip, { opacity: on[s.key] ? 1 : 0.35 }]}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={styles.chipLabel}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* linha do zero */}
        <Line x1={padL} y1={y(0)} x2={W - padR} y2={y(0)} stroke="#E5E7EB" strokeWidth={1} />
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2
          return (
            <React.Fragment key={i}>
              {on.receita && <Rect x={cx - barW - 1} y={Math.min(y(d.receita), y(0))} width={barW} height={Math.abs(y(d.receita) - y(0))} fill="#22C55E" rx={2} />}
              {on.despesa && <Rect x={cx + 1} y={Math.min(y(d.despesa), y(0))} width={barW} height={Math.abs(y(d.despesa) - y(0))} fill="#EF4444" rx={2} />}
              <SvgText x={cx} y={H - 6} fontSize={10} fill="#9CA3AF" textAnchor="middle">{d.mes}</SvgText>
            </React.Fragment>
          )
        })}
        {on.lucro && <Polyline points={linePoints('lucro')} fill="none" stroke="#3B82F6" strokeWidth={2} />}
        {on.meta && <Polyline points={linePoints('meta')} fill="none" stroke="#F59E0B" strokeWidth={2} strokeDasharray="5,4" />}
        {on.lucro && data.map((d, i) => <Circle key={`l${i}`} cx={padL + slot * i + slot / 2} cy={y(d.lucro)} r={2.5} fill="#3B82F6" />)}
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  chipLabel: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '600' },
})
