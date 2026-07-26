import { db } from './db'
import { redis } from './redis'
import { decrypt } from './crypto'

// Integration configs (Evolution/WhatsApp, SMTP, Google OAuth) — stored as rows
// in platform_settings, edited by the Root Admin, cached in Redis (60s) and
// invalidated on save (routes/root.ts settings PATCH).
//
// EVERY field falls back to its legacy env var when the DB value is empty, so a
// live deployment with an empty platform_settings behaves exactly as before.

const CACHE_TTL = 60

// ── Evolution (WhatsApp) ─────────────────────────────────────────────────────

export type EvolutionConfig = {
  url: string            // Evolution API base URL
  key: string            // Evolution API global key (secret)
  webhook_base: string   // public base URL of THIS backend for webhooks
  webhook_secret: string // shared secret embedded as ?token= (secret)
}

const EVOLUTION_DEFAULTS: EvolutionConfig = {
  url: '',
  key: '',
  webhook_base: '',
  webhook_secret: '',
}

const EVOLUTION_CACHE_KEY = 'integration:evolution:config'

export async function getEvolutionConfig(): Promise<EvolutionConfig> {
  const cached = await redis.get(EVOLUTION_CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query(
    'SELECT value FROM platform_settings WHERE key = $1', ['evolution_config']
  )
  const cfg: EvolutionConfig = { ...EVOLUTION_DEFAULTS, ...(row?.value ?? {}) }
  // Secrets are stored encrypted at rest (decrypt tolerates legacy plaintext).
  cfg.key = decrypt(cfg.key)
  cfg.webhook_secret = decrypt(cfg.webhook_secret)
  // env fallback so an already-running deployment keeps working before the panel is filled
  if (!cfg.url) cfg.url = process.env.EVOLUTION_API_URL ?? ''
  if (!cfg.key) cfg.key = process.env.EVOLUTION_API_KEY ?? ''
  if (!cfg.webhook_base) {
    cfg.webhook_base = process.env.WEBHOOK_BASE_URL ?? process.env.BACKEND_URL ?? 'http://localhost:3000'
  }
  if (!cfg.webhook_secret) cfg.webhook_secret = process.env.EVOLUTION_WEBHOOK_SECRET ?? ''
  await redis.setex(EVOLUTION_CACHE_KEY, CACHE_TTL, JSON.stringify(cfg))
  return cfg
}

export async function invalidateEvolutionConfig(): Promise<void> {
  await redis.del(EVOLUTION_CACHE_KEY)
}

// ── SMTP (e-mail) ────────────────────────────────────────────────────────────

export type SmtpConfig = {
  host: string
  port: number
  user: string
  pass: string    // secret
  secure: boolean
  from: string    // e.g. 'AiConfirma <noreply@aiconfirma.com.br>'
}

const SMTP_CACHE_KEY = 'integration:smtp:config'

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const cached = await redis.get(SMTP_CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query(
    'SELECT value FROM platform_settings WHERE key = $1', ['smtp_config']
  )
  const raw: Record<string, any> = row?.value ?? {}
  const cfg: SmtpConfig = {
    host: String(raw.host ?? '') || (process.env.SMTP_HOST ?? ''),
    // DB value → env → 587 (same default the mailer used before)
    port: Number(raw.port) > 0 ? Number(raw.port) : Number(process.env.SMTP_PORT ?? 587),
    user: String(raw.user ?? '') || (process.env.SMTP_USER ?? ''),
    // Secret stored encrypted at rest (decrypt tolerates legacy plaintext).
    pass: decrypt(String(raw.pass ?? '')) || (process.env.SMTP_PASS ?? ''),
    // Explicit boolean in DB wins; otherwise legacy env semantics (=== 'true')
    secure: typeof raw.secure === 'boolean' ? raw.secure : process.env.SMTP_SECURE === 'true',
    from: String(raw.from ?? '') || (process.env.EMAIL_FROM ?? ''),
  }
  await redis.setex(SMTP_CACHE_KEY, CACHE_TTL, JSON.stringify(cfg))
  return cfg
}

export async function invalidateSmtpConfig(): Promise<void> {
  await redis.del(SMTP_CACHE_KEY)
}

// ── E-mail (provedor + remetentes) ───────────────────────────────────────────
// Escolhe o provedor de envio (API do Resend ou SMTP legado) e define os
// remetentes por finalidade. Campos vazios caem no smtp_config.from / default.

export type EmailConfig = {
  provider: 'smtp' | 'resend'
  resend_api_key: string // secret
  from_contato: string   // validação, reset de senha, troca de e-mail, cobrança
  from_agenda: string    // convites de agendamento (.ics)
  from_suporte: string   // e-mails de suporte
}

const EMAIL_DEFAULTS: EmailConfig = {
  provider: 'smtp',
  resend_api_key: '',
  from_contato: '',
  from_agenda: '',
  from_suporte: '',
}

const EMAIL_CACHE_KEY = 'integration:email:config'

export async function getEmailConfig(): Promise<EmailConfig> {
  const cached = await redis.get(EMAIL_CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query(
    'SELECT value FROM platform_settings WHERE key = $1', ['email_config']
  )
  const raw: Record<string, any> = row?.value ?? {}
  const cfg: EmailConfig = {
    provider: raw.provider === 'resend' ? 'resend' : 'smtp',
    // Secret stored encrypted at rest (decrypt tolerates legacy plaintext).
    resend_api_key: decrypt(String(raw.resend_api_key ?? '')) || (process.env.RESEND_API_KEY ?? ''),
    from_contato: String(raw.from_contato ?? ''),
    from_agenda: String(raw.from_agenda ?? ''),
    from_suporte: String(raw.from_suporte ?? ''),
  }
  await redis.setex(EMAIL_CACHE_KEY, CACHE_TTL, JSON.stringify(cfg))
  return cfg
}

export async function invalidateEmailConfig(): Promise<void> {
  await redis.del(EMAIL_CACHE_KEY)
}

// ── Google OAuth ─────────────────────────────────────────────────────────────

export type GoogleConfig = {
  client_id: string
  client_ids: string     // comma-separated allowed audiences (Sign-In)
  client_secret: string  // secret
}

const GOOGLE_DEFAULTS: GoogleConfig = {
  client_id: '',
  client_ids: '',
  client_secret: '',
}

const GOOGLE_CACHE_KEY = 'integration:google:config'

export async function getGoogleConfig(): Promise<GoogleConfig> {
  const cached = await redis.get(GOOGLE_CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query(
    'SELECT value FROM platform_settings WHERE key = $1', ['google_config']
  )
  const cfg: GoogleConfig = { ...GOOGLE_DEFAULTS, ...(row?.value ?? {}) }
  // Secret stored encrypted at rest (decrypt tolerates legacy plaintext).
  cfg.client_secret = decrypt(cfg.client_secret)
  // env fallback so an already-running deployment keeps working before the panel is filled
  if (!cfg.client_id) cfg.client_id = process.env.GOOGLE_CLIENT_ID ?? ''
  if (!cfg.client_ids) cfg.client_ids = process.env.GOOGLE_CLIENT_IDS ?? ''
  if (!cfg.client_secret) cfg.client_secret = process.env.GOOGLE_CLIENT_SECRET ?? ''
  await redis.setex(GOOGLE_CACHE_KEY, CACHE_TTL, JSON.stringify(cfg))
  return cfg
}

export async function invalidateGoogleConfig(): Promise<void> {
  await redis.del(GOOGLE_CACHE_KEY)
}
