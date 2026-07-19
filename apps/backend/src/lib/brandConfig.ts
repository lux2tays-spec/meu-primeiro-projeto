import { db } from './db'
import { redis } from './redis'

// Brand / legal / contact text — Tier 1 config (no secrets), edited by the Root
// Admin under Configurações › Marca and consumed by e-mails, legal pages and the
// public /branding endpoint. Cached in Redis (60s), invalidated on save.

export type BrandConfig = {
  app_name: string        // 'AiConfirma'
  tagline: string         // 'Agendamento Inteligente'
  support_email: string   // shown to users for help
  support_whatsapp: string
  company_name: string    // razão social (rodapé legal)
  cnpj: string
  dpo_email: string       // encarregado de dados (LGPD)
  privacy_url: string
  terms_url: string
  email_from_name: string // display name used in outgoing e-mails
}

export const BRAND_DEFAULTS: BrandConfig = {
  app_name: 'AiConfirma',
  tagline: 'Agendamento Inteligente',
  support_email: '',
  support_whatsapp: '',
  company_name: '',
  cnpj: '',
  dpo_email: '',
  privacy_url: '',
  terms_url: '',
  email_from_name: 'AiConfirma',
}

const CACHE_KEY = 'brand:config'
const CACHE_TTL = 60

export async function getBrandConfig(): Promise<BrandConfig> {
  const cached = await redis.get(CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query(
    'SELECT value FROM platform_settings WHERE key = $1', ['brand_config']
  )
  const cfg: BrandConfig = { ...BRAND_DEFAULTS, ...(row?.value ?? {}) }
  // empty stored fields fall back to defaults so nothing renders blank
  for (const k of Object.keys(BRAND_DEFAULTS) as (keyof BrandConfig)[]) {
    if (!cfg[k]) cfg[k] = BRAND_DEFAULTS[k]
  }
  await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(cfg))
  return cfg
}

export async function invalidateBrandConfig(): Promise<void> {
  await redis.del(CACHE_KEY)
}
