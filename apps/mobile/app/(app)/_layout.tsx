import { Redirect, Tabs } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/store'
import { usePushNotifications } from '@/lib/push'
import { BottomTabBar } from '@/components/BottomTabBar'
import { tenantApi } from '@/lib/api'
import { onboardingSession } from '@/lib/onboarding-session'

export default function AppLayout() {
  const token = useAuthStore((s) => s.token)

  // Push: registra o token quando logado e trata o toque em notificações.
  usePushNotifications()

  const { data: onboarding, isLoading: onboardingLoading } = useQuery({
    queryKey: ['onboarding'],
    queryFn: tenantApi.onboarding,
    enabled: !!token,
  })

  if (!token) return <Redirect href="/(auth)/login" />
  if (onboardingLoading && !onboarding) return null
  if (onboarding && !onboarding.completed && !onboardingSession.skipped) {
    return <Redirect href="/onboarding" />
  }

  // Barra inferior customizada: Início, Agenda, Vendas, [+], Clientes, Finanças, Config.
  // O "+" central abre o menu de ação (Novo agendamento / Nova venda).
  return (
    <Tabs tabBar={(props) => <BottomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="vendas" />
      <Tabs.Screen name="customers" />
      <Tabs.Screen name="financeiro" />
      <Tabs.Screen name="settings" />
      {/* Rotas internas — não aparecem na barra (a barra customizada não as lista) */}
      <Tabs.Screen name="appointments" />
      <Tabs.Screen name="comissoes" />
      <Tabs.Screen name="notifications" />
    </Tabs>
  )
}
