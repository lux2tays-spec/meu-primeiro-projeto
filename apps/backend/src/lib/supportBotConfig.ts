import { db } from './db'
import { redis } from './redis'

// The platform's own WhatsApp "support/sales" bot: a single system-owned
// Evolution instance (NOT a tenant) that answers visitors on the landing page,
// clears doubts about the product and nudges them to register/subscribe.
// Behaviour + connection state live in platform_settings 'support_bot_config'.

export const SUPPORT_INSTANCE = 'system_support'

export type SupportBotConfig = {
  enabled: boolean
  // runtime connection state (managed by the connect/status endpoints)
  status: 'disconnected' | 'qr_pending' | 'connected'
  phone_number: string | null // digits-only; powers the landing wa.me button
  // behaviour (Root Admin)
  system_prompt: string
  product_info: string
  register_url: string
}

const DEFAULTS: SupportBotConfig = {
  enabled: false,
  status: 'disconnected',
  phone_number: null,
  system_prompt:
    'Você é o assistente virtual de vendas e suporte da AíConfirma, uma plataforma que oferece chatbots de WhatsApp com IA para pequenos negócios (salões, clínicas, pet shops, etc.) automatizarem agendamentos e atendimento. Fale como uma pessoa real e simpática da equipe. Tire dúvidas sobre o sistema, planos e funcionamento, e conduza a pessoa a criar a conta e assinar. Nunca invente preços, prazos ou recursos que não estejam descritos abaixo — se não souber, ofereça encaminhar para o time.',
  product_info: '',
  register_url: 'https://app.aiconfirma.com.br/register',
}

const KEY = 'support_bot_config'
const CACHE = 'support:config'

export async function getSupportBotConfig(): Promise<SupportBotConfig> {
  const cached = await redis.get(CACHE)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query("SELECT value FROM platform_settings WHERE key = $1", [KEY])
  const merged: SupportBotConfig = { ...DEFAULTS, ...(row?.value ?? {}) }
  await redis.setex(CACHE, 30, JSON.stringify(merged))
  return merged
}

export async function invalidateSupportBotConfig(): Promise<void> {
  await redis.del(CACHE)
}

// Merge a partial update into the stored config. Used both by the Root Admin
// behaviour form and by the connect/status flows (which touch runtime fields) —
// a merge avoids one path clobbering the other's fields.
export async function updateSupportBotConfig(patch: Partial<SupportBotConfig>): Promise<SupportBotConfig> {
  const cur = await getSupportBotConfig()
  const next: SupportBotConfig = { ...cur, ...patch }
  await db.query(
    `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [KEY, JSON.stringify(next)]
  )
  await invalidateSupportBotConfig()
  return next
}
