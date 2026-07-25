import { Stack } from 'expo-router'

// Makes "customers" a real nested route so the parent Tabs.Screen name="customers"
// binds to it (expo-router 6 no longer collapses a folder-with-only-index to the
// folder name without a _layout). The screen renders its own header.
export default function CustomersLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  )
}
