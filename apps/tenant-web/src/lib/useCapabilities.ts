'use client'
import { useQuery } from '@tanstack/react-query'
import { subscriptionApi } from './api'

// #10 — Recursos do plano atual do tenant (gating na web). Enquanto carrega,
// assume liberado para não "piscar" o cadeado em quem tem o recurso.
export function useCapabilities() {
  const { data } = useQuery({
    queryKey: ['tenant-capabilities'],
    queryFn: subscriptionApi.capabilities,
    staleTime: 5 * 60_000,
  })
  return {
    caps: data ?? {},
    loaded: !!data,
    can: (key: string) => (data == null ? true : !!data[key]),
    limit: (key: string) => Number(data?.[key] ?? 0),
  }
}
