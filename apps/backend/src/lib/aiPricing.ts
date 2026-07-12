// Model pricing (USD per 1M tokens) and cost computation.
// Cache reads cost ~0.1x input; cache writes (5-min TTL) ~1.25x input.
// Update these when Anthropic pricing changes.

export type Pricing = { input: number; output: number; label: string }

export const PRICING: Record<string, Pricing> = {
  'claude-haiku-4-5':  { input: 1, output: 5,  label: 'Haiku 4.5' },
  'claude-sonnet-5':   { input: 3, output: 15, label: 'Sonnet 5' },
  'claude-sonnet-4-6': { input: 3, output: 15, label: 'Sonnet 4.6' },
  'claude-opus-4-8':   { input: 5, output: 25, label: 'Opus 4.8' },
}

// Options exposed in the Root Admin model selector.
export const MODEL_OPTIONS = [
  { id: 'claude-sonnet-5',   label: 'Sonnet 5 (recomendado — vende melhor)' },
  { id: 'hybrid',            label: 'Híbrido (Haiku no simples, Sonnet 5 no fechamento)' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5 (mais barato)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8 (mais caro)' },
]

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** USD cost of a single API call given its usage block. */
export function costUsd(model: string, u: Usage | null | undefined): number {
  const p = PRICING[model] ?? PRICING['claude-haiku-4-5']
  const input = u?.input_tokens ?? 0
  const output = u?.output_tokens ?? 0
  const cacheRead = u?.cache_read_input_tokens ?? 0
  const cacheWrite = u?.cache_creation_input_tokens ?? 0
  return (
    input * p.input +
    cacheRead * p.input * 0.1 +
    cacheWrite * p.input * 1.25 +
    output * p.output
  ) / 1_000_000
}
