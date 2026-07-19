'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { BrandingProvider } from '@/components/BrandingProvider'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  }))
  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>{children}</BrandingProvider>
    </QueryClientProvider>
  )
}
