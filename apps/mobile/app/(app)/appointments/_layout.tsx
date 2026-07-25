import { Stack } from 'expo-router'

// Makes "appointments" a real nested route so the parent (hidden) Tabs.Screen
// name="appointments" binds to it in expo-router 6. Reached only via
// router.push('/appointments/new') or '/appointments/[id]'; each screen renders
// its own header.
export default function AppointmentsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="new" />
      <Stack.Screen name="[id]" />
    </Stack>
  )
}
