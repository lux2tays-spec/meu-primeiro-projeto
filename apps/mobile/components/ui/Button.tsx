import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native'
import { colors, radius, font } from '@/lib/theme'
import { useTheme } from '@/lib/theme-context'

interface Props {
  label: string
  onPress: () => void
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
}

export function Button({ label, onPress, variant = 'primary', loading, disabled, style }: Props) {
  const theme = useTheme()
  const isDisabled = disabled || loading

  // Cor de marca do tenant aplicada em runtime (fallback: verde padrão).
  const dynamicStyle: ViewStyle | null =
    variant === 'primary'
      ? { backgroundColor: theme.primary }
      : variant === 'outline'
        ? { borderColor: theme.primary }
        : null
  const dynamicLabel: TextStyle | null =
    variant === 'outline' || variant === 'ghost' ? { color: theme.primary } : null

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={[styles.base, styles[variant], dynamicStyle, isDisabled && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : theme.primary} />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`], dynamicLabel]}>{label}</Text>
      )}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  primary: { backgroundColor: colors.primary },
  outline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: colors.danger },
  disabled: { opacity: 0.5 },
  label: { fontSize: font.md, fontWeight: '600' },
  primaryLabel: { color: '#fff' },
  outlineLabel: { color: colors.primary },
  ghostLabel: { color: colors.primary },
  dangerLabel: { color: '#fff' },
})
