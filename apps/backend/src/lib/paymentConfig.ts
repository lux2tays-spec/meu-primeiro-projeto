import { db } from './db'
import { redis } from './redis'

// Platform payment provider config (the tenant pays the PLATFORM here — separate
// from each tenant's own Mercado Pago used to receive money from their customers).
// Stored as the `payment_config` row in platform_settings, edited by Root Admin.

export type PaymentConfig = {
  provider: 'mercadopago' | 'none'
  mp_access_token: string
  mp_public_key: string
  mp_webhook_secret: string
  back_url: string // where the provider redirects the payer after checkout
}

const DEFAULTS: PaymentConfig = {
  provider: 'none',
  mp_access_token: '',
  mp_public_key: '',
  mp_webhook_secret: '',
  back_url: '',
}

const CACHE_KEY = 'payment:config'

export async function getPaymentConfig(): Promise<PaymentConfig> {
  const cached = await redis.get(CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query("SELECT value FROM platform_settings WHERE key = 'payment_config'")
  const cfg: PaymentConfig = { ...DEFAULTS, ...(row?.value ?? {}) }
  // env fallback so an already-running deployment keeps working before the panel is filled
  if (!cfg.mp_access_token && process.env.MERCADOPAGO_ACCESS_TOKEN) cfg.mp_access_token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!cfg.mp_webhook_secret && process.env.MP_WEBHOOK_SECRET) cfg.mp_webhook_secret = process.env.MP_WEBHOOK_SECRET
  if (cfg.mp_access_token && cfg.provider === 'none') cfg.provider = 'mercadopago'
  await redis.setex(CACHE_KEY, 60, JSON.stringify(cfg))
  return cfg
}

export async function invalidatePaymentConfig(): Promise<void> {
  await redis.del(CACHE_KEY)
}
