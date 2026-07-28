'use client'
import { Loader2 } from 'lucide-react'

/**
 * UI-7: indicador de carregamento consistente (spinner + texto), no lugar dos
 * "Carregando..." em texto puro espalhados pelas telas. Mesmo visual usado na
 * Agenda. `card` envolve o spinner no cartão branco padrão das listas.
 */
export default function Loading({ label = 'Carregando...', card = false, className = '' }: {
  label?: string
  card?: boolean
  className?: string
}) {
  const inner = (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-2 py-8 text-gray-400 text-sm ${className}`}>
      <Loader2 size={18} className="animate-spin text-gray-300" aria-hidden="true" />
      {label}
    </div>
  )
  if (!card) return inner
  return <div className="bg-white rounded-2xl border border-gray-100">{inner}</div>
}
