import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Card } from './ui/Card'
import { colors, font, spacing } from '@/lib/theme'

interface Props {
  label: string
  value: string | number
  icon: keyof typeof Ionicons.glyphMap
  color?: string
  subtitle?: string
}

export function StatCard({ label, value, icon, color = colors.primary, subtitle }: Props) {
  return (
    <Card style={styles.card}>
      <View style={[styles.iconBox, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
      {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: spacing.xs },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  value: { fontSize: font.xxl, fontWeight: '700', color: colors.text },
  label: { fontSize: font.sm, color: colors.textSecondary, fontWeight: '500' },
  subtitle: { fontSize: font.sm - 1, color: colors.textDisabled },
})
