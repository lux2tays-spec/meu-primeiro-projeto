import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { Stack } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as SplashScreen from 'expo-splash-screen'
import { useAuthStore } from '@/lib/store'
import { StatusBar } from 'expo-status-bar'
import { Toast } from '@/components/ui/Toast'

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync()
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

export default function RootLayout() {
  const loadAuth = useAuthStore((s) => s.loadAuth)
  const isLoaded = useAuthStore((s) => s.isLoaded)

  useEffect(() => {
    loadAuth()
  }, [])

  useEffect(() => {
    if (isLoaded && Platform.OS !== 'web') {
      SplashScreen.hideAsync()
    }
  }, [isLoaded])

  return (
    <QueryClientProvider client={queryClient}>
      <View style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
        <Toast />
      </View>
    </QueryClientProvider>
  )
}
