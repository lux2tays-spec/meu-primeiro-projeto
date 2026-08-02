import { TouchableOpacity, View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, spacing, font } from '@/lib/theme'

interface Props {
  icon: keyof typeof Ionicons.glyphMap
  iconColor?: string
  label: string
  subtitle?: string
  onPress: () => void
  showChevron?: boolean
  rightElement?: React.ReactNode
  locked?: boolean
}

export function SettingsRow({
  icon,
  iconColor = colors.text,
  label,
  subtitle,
  onPress,
  showChevron = true,
  rightElement,
  locked = false,
}: Props) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.iconBox, { backgroundColor: iconColor + '18' }, locked && { opacity: 0.5 }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.label, locked && { color: colors.textSecondary }]}>{label}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {locked
        ? <Ionicons name="lock-closed" size={16} color={colors.textDisabled} />
        : (rightElement ?? (showChevron && (
            <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
          )))}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  label: { fontSize: font.md, color: colors.text, fontWeight: '500' },
  subtitle: { fontSize: font.sm, color: colors.textSecondary, marginTop: 1 },
})
