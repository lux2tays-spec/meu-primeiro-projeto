import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { Stack } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as SplashScreen from 'expo-splash-screen'
import { useAuthStore } from '@/lib/store'
import { useBrandingStore } from '@/lib/branding'
import { StatusBar } from 'expo-status-bar'
import { Toast } from '@/components/ui/Toast'
import { ErrorBoundary } from '@/components/ErrorBoundary'

if (Platform.OS !== 'web') {
  SplashScreen.preventAutoHideAsync()
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

export default function RootLayout() {
  const loadAuth = useAuthStore((s) => s.loadAuth)
  const isLoaded = useAuthStore((s) => s.isLoaded)
  const loadBranding = useBrandingStore((s) => s.loadBranding)

  useEffect(() => {
    loadAuth()
    // Non-blocking: runtime branding (name/logo/colors) with bundled fallback.
    loadBranding()
  }, [])

  useEffect(() => {
    if (isLoaded && Platform.OS !== 'web') {
      SplashScreen.hideAsync()
    }
  }, [isLoaded])

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <View style={{ flex: 1 }}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
            <Stack.Screen name="onboarding" />
          </Stack>
          <Toast />
        </View>
      </ErrorBoundary>
    </QueryClientProvider>
  )
}
