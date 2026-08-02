import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { router } from 'expo-router'
import { StackActions } from '@react-navigation/native'
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs'
import { useAuthStore } from '@/lib/store'
import { useCapabilities, promptUpgrade } from '@/lib/capabilities'
import { NovaVendaSheet } from '@/components/financeiro/NovaVendaSheet'
import { colors, font, spacing, radius } from '@/lib/theme'

// Barra inferior customizada com um botão "+" CENTRAL de ação rápida.
// Ordem pedida: Início, Calendário, Vendas, [+], Clientes, Finanças, Config.
// Vendas/Finanças só aparecem para gestores (o backend também bloqueia staff).

type TabDef = { name: string; label: string; icon: keyof typeof Ionicons.glyphMap; managerOnly?: boolean; cap?: string }

const LEFT: TabDef[] = [
  { name: 'index', label: 'Início', icon: 'home-outline' },
  { name: 'calendar', label: 'Agenda', icon: 'calendar-outline' },
  { name: 'vendas', label: 'Vendas', icon: 'cart-outline', managerOnly: true, cap: 'vendas_module' },
]
const RIGHT: TabDef[] = [
  { name: 'customers', label: 'Clientes', icon: 'people-outline' },
  { name: 'financeiro', label: 'Finanças', icon: 'cash-outline', managerOnly: true, cap: 'vendas_module' },
  { name: 'settings', label: 'Config', icon: 'settings-outline' },
]

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const role = useAuthStore((s) => s.role)
  const isManager = ['owner', 'admin', 'root'].includes(role ?? '')
  const { can } = useCapabilities()
  const [menuOpen, setMenuOpen] = useState(false)
  const [vendaOpen, setVendaOpen] = useState(false)

  const activeName = state.routes[state.index]?.name

  function go(name: string) {
    // Só navega se a rota existe no navigator (todas registradas no _layout).
    const target = state.routes.find((r) => r.name === name)
    if (!target) return
    // Re-tocar a aba já ativa volta a pilha aninhada para a raiz — ex.: sair de
    // Config › Painel de Afiliado de volta para Config (senão o navigate vira
    // no-op e o usuário fica "preso" sem botão de voltar).
    if (activeName === name) {
      const nestedKey = (target as any).state?.key
      if (nestedKey) navigation.dispatch({ ...StackActions.popToTop(), target: nestedKey })
      return
    }
    navigation.navigate(name as never)
  }

  const filt = (list: TabDef[]) => list.filter((t) => !t.managerOnly || isManager)

  const Tab = ({ t }: { t: TabDef }) => {
    const active = activeName === t.name
    const locked = !!t.cap && !can(t.cap)
    return (
      <TouchableOpacity
        style={s.tab}
        onPress={() => (locked ? promptUpgrade(t.label) : go(t.name))}
        accessibilityRole="button"
        accessibilityLabel={locked ? `${t.label} (bloqueado — requer upgrade)` : t.label}
      >
        <View>
          <Ionicons name={t.icon} size={22} color={active ? colors.primary : colors.textDisabled} />
          {locked && (
            <View style={s.lockBadge}><Ionicons name="lock-closed" size={9} color="#fff" /></View>
          )}
        </View>
        <Text style={[s.label, { color: active ? colors.primary : colors.textDisabled }]} numberOfLines={1}>{t.label}</Text>
      </TouchableOpacity>
    )
  }

  return (
    <>
      <View style={[s.bar, { height: 62 + insets.bottom, paddingBottom: insets.bottom }]}>
        {filt(LEFT).map((t) => <Tab key={t.name} t={t} />)}

        {/* Botão central "+" de ação rápida */}
        <TouchableOpacity style={s.centerWrap} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Ação rápida">
          <View style={s.centerBtn}><Ionicons name="add" size={30} color="#fff" /></View>
        </TouchableOpacity>

        {filt(RIGHT).map((t) => <Tab key={t.name} t={t} />)}
      </View>

      {/* Menu de ação rápida */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={[s.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>Ação rápida</Text>
            <TouchableOpacity style={s.action} onPress={() => { setMenuOpen(false); router.push('/(app)/appointments/new') }}>
              <View style={[s.actionIcon, { backgroundColor: colors.primary + '18' }]}><Ionicons name="calendar-outline" size={22} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.actionLabel}>Novo agendamento</Text>
                <Text style={s.actionHint}>Marcar um horário na agenda</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </TouchableOpacity>
            {isManager && (
              <TouchableOpacity style={s.action} onPress={() => { setMenuOpen(false); can('vendas_module') ? setVendaOpen(true) : promptUpgrade('Vendas') }}>
                <View style={[s.actionIcon, { backgroundColor: colors.success + '18' }]}><Ionicons name="cart-outline" size={22} color={colors.success} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.actionLabel}>Nova venda</Text>
                  <Text style={s.actionHint}>Registrar uma venda concluída</Text>
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

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
    paddingHorizontal: spacing.xs,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 6 },
  label: { fontSize: 10, fontWeight: '600' },
  lockBadge: { position: 'absolute', top: -4, right: -8, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.textDisabled, alignItems: 'center', justifyContent: 'center' },
  centerWrap: { width: 60, alignItems: 'center', justifyContent: 'center' },
  centerBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: -18,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
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
