import { useEffect, useRef } from 'react'
import { Animated, Text, StyleSheet, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useToast, ToastVariant } from '@/lib/toast'
import { colors, font, spacing, radius } from '@/lib/theme'

const ICONS: Record<ToastVariant, string> = {
  success: 'checkmark-circle',
  error: 'close-circle',
  warning: 'warning',
  info: 'information-circle',
}

const PALETTE: Record<ToastVariant, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: '#DCFCE7', border: '#22C55E', text: '#166534', icon: '#22C55E' },
  error:   { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B', icon: '#EF4444' },
  warning: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', icon: '#D97706' },
  info:    { bg: '#DBEAFE', border: '#3B82F6', text: '#1E3A5F', icon: '#3B82F6' },
}

const TITLES: Record<ToastVariant, string> = {
  success: 'Sucesso',
  error: 'Erro',
  warning: 'Atenção',
  info: 'Informação',
}

export function Toast() {
  const { visible, message, variant, hide } = useToast()
  const translateY = useRef(new Animated.Value(-120)).current
  const opacity = useRef(new Animated.Value(0)).current
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)

    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start()
      timer.current = setTimeout(hide, 4500)
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 280, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start()
    }

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [visible])

  const c = PALETTE[variant]

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.container, { backgroundColor: c.bg, borderColor: c.border, opacity, transform: [{ translateY }] }]}
    >
      <Ionicons name={ICONS[variant] as any} size={22} color={c.icon} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.title, { color: c.text }]}>{TITLES[variant]}</Text>
        <Text style={[styles.message, { color: c.text }]}>{message}</Text>
      </View>
      <TouchableOpacity onPress={hide} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <Ionicons name="close" size={18} color={c.text} />
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 56,
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 10,
  },
  title: { fontSize: font.sm, fontWeight: '700', lineHeight: 18 },
  message: { fontSize: font.sm, lineHeight: 18 },
})
