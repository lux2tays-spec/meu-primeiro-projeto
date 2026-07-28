'use client'

/**
 * AUTH-9 — máscara e normalização de telefone BR, compartilhadas entre as telas
 * de cadastro (register) e Google Sign-In, para exibição e envio consistentes.
 */

/** Apenas dígitos, sem DDI: "(11) 99999-9999" → "11999999999". */
export function normalizeBRPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  // Remove DDI 55 se o usuário digitou com código do país
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2)
  }
  return digits.slice(0, 11)
}

/** Máscara progressiva: "11999999999" → "(11) 99999-9999" (fixo: "(11) 3333-4444"). */
export function formatBRPhone(value: string): string {
  const d = normalizeBRPhone(value)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Telefone válido para cadastro: DDD + 8 ou 9 dígitos. */
export function isValidBRPhone(value: string): boolean {
  const d = normalizeBRPhone(value)
  return d.length === 10 || d.length === 11
}
