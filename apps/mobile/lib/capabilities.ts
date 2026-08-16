import { useQuery } from '@tanstack/react-query'
import { Alert } from 'react-native'
import { router } from 'expo-router'
import { subscriptionApi } from './api'

// #10 — Recursos do plano atual do tenant (gating no app). Enquanto carrega,
// assumimos liberado (evita "piscar" cadeado em quem tem o recurso).
export function useCapabilities() {
  const { data } = useQuery({
    queryKey: ['tenant-capabilities'],
    queryFn: subscriptionApi.capabilities,
    staleTime: 5 * 60_000,
  })
  const caps = data ?? {}
  return {
    caps,
    loaded: !!data,
    can: (key: string) => data == null ? true : !!data[key],
    limit: (key: string) => Number(data?.[key] ?? 0),
  }
}

// Alerta padrão de "recurso do plano". Em build de loja, a linguagem é neutra
// (anti-steering): não fala de preço/compra, apenas leva à área da conta/plano.
const STORE_BUILD = process.env.EXPO_PUBLIC_STORE_BUILD === '1'
export function promptUpgrade(featureLabel: string) {
  Alert.alert(
    `${featureLabel} não está no seu plano`,
    STORE_BUILD
      ? 'Este recurso faz parte de outro plano. Veja os detalhes na área da sua conta.'
      : 'Faça upgrade do seu plano para desbloquear este recurso.',
    [
      { text: 'Agora não', style: 'cancel' },
      { text: STORE_BUILD ? 'Ver meu plano' : 'Ver planos', onPress: () => router.push('/(app)/settings/subscription') },
    ]
  )
}
