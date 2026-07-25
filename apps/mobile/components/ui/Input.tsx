import { ReactNode } from 'react'
import { View, Text, TextInput, TextInputProps, StyleSheet } from 'react-native'
import { colors, radius, font, spacing } from '@/lib/theme'

interface Props extends TextInputProps {
  label?: string
  error?: string
  /** Optional element rendered inside the field, aligned to the right (e.g. show/hide password toggle). */
  rightElement?: ReactNode
}

export function Input({ label, error, rightElement, style, ...props }: Props) {
  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={styles.field}>
        <TextInput
          style={[styles.input, error ? styles.inputError : null, rightElement ? styles.inputWithRight : null, style]}
          placeholderTextColor={colors.textDisabled}
          {...props}
        />
        {rightElement && <View style={styles.right}>{rightElement}</View>}
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  label: { fontSize: font.sm, fontWeight: '500', color: colors.text },
  field: { position: 'relative', justifyContent: 'center' },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputWithRight: { paddingRight: 48 },
  inputError: { borderColor: colors.danger },
  right: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { fontSize: font.sm, color: colors.danger },
})
