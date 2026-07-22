import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/store'
import { tenantApi } from '@/lib/api'
import { onboardingSession } from '@/lib/onboarding-session'
import { colors } from '@/lib/theme'

export default function AppLayout() {
  const token = useAuthStore((s) => s.token)

  const { data: onboarding, isLoading: onboardingLoading } = useQuery({
    queryKey: ['onboarding'],
    queryFn: tenantApi.onboarding,
    enabled: !!token,
  })

  if (!token) return <Redirect href="/(auth)/login" />

  // Aguarda o estado do onboarding antes de decidir (evita flash da home)
  if (onboardingLoading && !onboarding) return null

  if (onboarding && !onboarding.completed && !onboardingSession.skipped) {
    return <Redirect href="/onboarding" />
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textDisabled,
        tabBarStyle: {
          borderTopColor: colors.border,
          paddingBottom: 6,
          height: 60,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Início',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendário',
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="financeiro"
        options={{
          title: 'Financeiro',
          tabBarIcon: ({ color, size }) => <Ionicons name="cash-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="customers"
        options={{
          title: 'Clientes',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Config',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" size={size} color={color} />,
        }}
      />

      {/* Rotas de navegação interna — não aparecem na tab bar */}
      <Tabs.Screen name="appointments" options={{ tabBarButton: () => null, headerShown: false }} />
      <Tabs.Screen name="comissoes" options={{ tabBarButton: () => null, headerShown: false }} />
    </Tabs>
  )
}
