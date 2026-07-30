import { useEffect } from 'react'
import { Platform, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { notificationsApi } from './api'
import { useAuthStore } from './store'

// Como o app se comporta ao receber um aviso em PRIMEIRO PLANO (app aberto):
// mostra banner + na lista + som, sem mexer no badge do ícone.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

let lastRegisteredToken: string | null = null

/** Lê o projectId do EAS (necessário para gerar o ExpoPushToken). */
function getProjectId(): string | null {
  const id =
    (Constants.expoConfig?.extra as any)?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId ??
    null
  if (!id || id === 'PREENCHER_COM_eas_init') return null
  return id
}

/**
 * Pede permissão, obtém o ExpoPushToken e registra no backend. Retorna o token
 * ou null (aparelho não físico, permissão negada, ou EAS não configurado).
 * Seguro chamar sempre: no Expo Go / sem projectId apenas retorna null.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null // push real não funciona em emulador/simulador

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Avisos',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#1C9DAA',
    })
  }

  const { status: existing } = await Notifications.getPermissionsAsync()
  let status = existing
  if (existing !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status
  }
  if (status !== 'granted') return null

  const projectId = getProjectId()
  if (!projectId) {
    console.warn('[push] EAS projectId ausente — rode `eas init` e preencha app.json. Push desativado por ora.')
    return null
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    if (token && token !== lastRegisteredToken) {
      await notificationsApi.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android')
      lastRegisteredToken = token
    }
    return token
  } catch (e) {
    console.warn('[push] falha ao obter/registrar token:', e)
    return null
  }
}

/** Remove o token deste aparelho no backend (chamar no logout). */
export async function unregisterPushToken(): Promise<void> {
  if (!lastRegisteredToken) return
  try {
    await notificationsApi.deletePushToken(lastRegisteredToken)
  } catch { /* ignore */ }
  lastRegisteredToken = null
}

/** Navega para o destino de um aviso (link interno do app ou URL externa). */
function openLink(data: any, router: ReturnType<typeof useRouter>) {
  const link: string | undefined = data?.link
  if (!link) return
  if (/^https?:\/\//i.test(link)) {
    Linking.openURL(link).catch(() => {})
  } else {
    const path = link.startsWith('/') ? link : `/${link}`
    router.push(('/(app)' + path) as any)
  }
}

/**
 * Hook do app: registra o push quando há sessão e trata o TOQUE em notificações
 * (tanto com o app aberto quanto ao abrir o app a partir de uma notificação).
 * Chamar uma vez, dentro da área autenticada.
 */
export function usePushNotifications() {
  const router = useRouter()
  const token = useAuthStore((s) => s.token)

  // Registra quando o usuário está logado.
  useEffect(() => {
    if (token) registerForPushNotifications().catch(() => {})
  }, [token])

  // Toque em notificação → abre o destino.
  useEffect(() => {
    // App aberto A PARTIR de uma notificação (cold start).
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) openLink(resp.notification.request.content.data, router)
    })
    // App já aberto: toque enquanto rodando/em background.
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      openLink(resp.notification.request.content.data, router)
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
