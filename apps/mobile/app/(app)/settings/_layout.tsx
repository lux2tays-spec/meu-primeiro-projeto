import { Stack } from 'expo-router'
import { colors } from '@/lib/theme'

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: 'Voltar',
        headerTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Configurações' }} />
      <Stack.Screen name="agent" options={{ title: 'Agente IA' }} />
      <Stack.Screen name="business" options={{ title: 'Dados do negócio' }} />
      <Stack.Screen name="perfil" options={{ title: 'Meu Perfil' }} />
      <Stack.Screen name="notifications" options={{ title: 'Notificações' }} />
      <Stack.Screen name="services" options={{ title: 'Serviços' }} />
      <Stack.Screen name="staff" options={{ title: 'Equipe' }} />
      <Stack.Screen name="hours" options={{ title: 'Horários de Funcionamento' }} />
      <Stack.Screen name="whatsapp" options={{ title: 'WhatsApp' }} />
      <Stack.Screen name="subscription" options={{ title: 'Assinatura' }} />
      <Stack.Screen name="affiliate" options={{ title: 'Painel de Afiliado' }} />
      <Stack.Screen name="google-calendar" options={{ title: 'Google Agenda' }} />
      <Stack.Screen name="support" options={{ title: 'Suporte' }} />
      <Stack.Screen name="support-chat" options={{ title: 'Assistente de suporte' }} />
      <Stack.Screen name="tickets" options={{ title: 'Meus chamados' }} />
      <Stack.Screen name="ticket-new" options={{ title: 'Abrir chamado' }} />
      <Stack.Screen name="ticket/[id]" options={{ title: 'Chamado' }} />
    </Stack>
  )
}
