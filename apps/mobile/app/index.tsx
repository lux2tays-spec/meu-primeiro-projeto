import { Redirect } from 'expo-router'
import { View, ActivityIndicator } from 'react-native'
import { useAuthStore } from '@/lib/store'
import { colors } from '@/lib/theme'

export default function Index() {
  const { token, isLoaded } = useAuthStore()

  if (!isLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    )
  }

  return <Redirect href={token ? '/(app)' : '/(auth)/login'} />
}
