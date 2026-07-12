import { db } from './db'
import { redis } from './redis'

// AI model configuration, stored as the `ai_config` row in platform_settings and
// edited by the Root Admin. Cached in Redis (60s) and invalidated on save.

export type AiConfig = {
  provider: string
  model: string          // used in single mode; the "closing" model in hybrid mode
  model_simple: string   // cheap model for simple turns in hybrid mode
  mode: 'single' | 'hybrid'
  usd_brl_rate: number
  caps: Record<string, number> // monthly USD cap per plan slug (0 = unlimited)
}

const DEFAULTS: AiConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  model_simple: 'claude-haiku-4-5',
  mode: 'single',
  usd_brl_rate: 6,
  caps: {},
}

const CACHE_KEY = 'ai:config'

export async function getAiConfig(): Promise<AiConfig> {
  const cached = await redis.get(CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query("SELECT value FROM platform_settings WHERE key = 'ai_config'")
  const merged: AiConfig = { ...DEFAULTS, ...(row?.value ?? {}) }
  // Back-compat: an old config may have `model: claude-haiku-4-5` and no mode
  if (!merged.mode) merged.mode = 'single'
  await redis.setex(CACHE_KEY, 60, JSON.stringify(merged))
  return merged
}

export async function invalidateAiConfig(): Promise<void> {
  await redis.del(CACHE_KEY)
}

// Sales/booking intent signals — when present, hybrid mode uses the stronger model.
const SALES_SIGNAL = /agend|marc|hor[aá]ri|pre[cç]o|valor|quero|fech|confirm|dispon|cancel|remarc|reserv|quanto|orç/i

/** Resolve which model to use for a given incoming message under the current config. */
export function resolveModel(cfg: AiConfig, message: string): string {
  if (cfg.mode === 'hybrid') {
    return SALES_SIGNAL.test(message || '') ? cfg.model : cfg.model_simple
  }
  return cfg.model
}
