import { View, Text, StyleSheet } from 'react-native'
import { colors, radius, font } from '@/lib/theme'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'default'

const variantColors: Record<Variant, { bg: string; text: string }> = {
  success: { bg: '#DCFCE7', text: colors.success },
  warning: { bg: '#FEF3C7', text: colors.warning },
  danger: { bg: '#FEE2E2', text: colors.danger },
  info: { bg: '#DBEAFE', text: colors.info },
  default: { bg: colors.surfaceAlt, text: colors.textSecondary },
}

interface Props {
  label: string
  variant?: Variant
}

export function Badge({ label, variant = 'default' }: Props) {
  const { bg, text } = variantColors[variant]
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: text }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  text: { fontSize: font.sm, fontWeight: '600' },
})
