import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router, useSegments } from 'expo-router'
import { useAuthStore } from '@/lib/store'
import { NovaVendaSheet } from '@/components/financeiro/NovaVendaSheet'
import { colors, font, spacing, radius } from '@/lib/theme'

// Ação rápida global no rodapé (acima da tab bar): abre um menu com
// "Nova venda" e "Novo agendamento". Nova venda só aparece para gestores.
export function QuickActionFab() {
  const insets = useSafeAreaInsets()
  const segments = useSegments()
  const role = useAuthStore((s) => s.role)
  const isManager = ['owner', 'admin', 'root'].includes(role ?? '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [vendaOpen, setVendaOpen] = useState(false)

  // Na Agenda já existe um FAB contextual (com a data selecionada) — não duplica.
  if (segments[segments.length - 1] === 'calendar') return null

  const bottom = 60 + insets.bottom + spacing.md

  return (
    <>
      <TouchableOpacity
        style={[styles.fab, { bottom }]}
        onPress={() => setMenuOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Ações rápidas"
      >
        <Ionicons name="add" size={30} color="#fff" />
      </TouchableOpacity>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Ação rápida</Text>
            <TouchableOpacity style={styles.action} onPress={() => { setMenuOpen(false); router.push('/(app)/appointments/new') }}>
              <View style={[styles.actionIcon, { backgroundColor: colors.primary + '18' }]}>
                <Ionicons name="calendar-outline" size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel}>Novo agendamento</Text>
                <Text style={styles.actionHint}>Marcar um horário na agenda</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </TouchableOpacity>

            {isManager && (
              <TouchableOpacity style={styles.action} onPress={() => { setMenuOpen(false); setVendaOpen(true) }}>
                <View style={[styles.actionIcon, { backgroundColor: colors.success + '18' }]}>
                  <Ionicons name="cart-outline" size={22} color={colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionLabel}>Nova venda</Text>
                  <Text style={styles.actionHint}>Registrar uma venda concluída</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <NovaVendaSheet visible={vendaOpen} onClose={() => setVendaOpen(false)} onSaved={() => setVendaOpen(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
    zIndex: 20,
  },
  overlay: { flex: 1, backgroundColor: 'rgba(15,30,48,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  sheetTitle: { fontSize: font.md, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  actionIcon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: font.md, fontWeight: '700', color: colors.text },
  actionHint: { fontSize: font.sm, color: colors.textSecondary },
})
