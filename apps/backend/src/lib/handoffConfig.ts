import { z } from 'zod'
import { db } from './db'
import { redis } from './redis'

// Human-handoff settings — per tenant, read on every inbound message. Editable by
// the business owner (mobile + tenant-web) and by the Root Admin (tenant edit).
// Empty text fields fall back to the defaults below (single source of truth).

export type HandoffConfig = {
  enabled: boolean
  pause_on_owner_reply: boolean
  timeout_min: number
  offer_message: string
  button_label: string
  ack_message: string
  resume_message: string        // '' = bot resumes silently
  owner_resume_keyword: string  // '' = disabled
}

export const HANDOFF_DEFAULTS: HandoffConfig = {
  enabled: true,
  pause_on_owner_reply: true,
  timeout_min: 30,
  offer_message: 'Quer que eu encaminhe para um especialista?',
  button_label: 'Quero ajuda de um especialista',
  ack_message: 'Perfeito! Já avisei a equipe 🙌 Em breve um especialista continua seu atendimento por aqui.',
  resume_message: '',
  owner_resume_keyword: '',
}

const trim = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

// Read on EVERY inbound WhatsApp message → cache in Redis (60s) like the other
// hot-path configs (botConfig/integrationConfig). Invalidated on save.
const cacheKey = (tenantId: string) => `tenant:handoff:${tenantId}`
const CACHE_TTL = 60

export async function invalidateHandoffConfig(tenantId: string): Promise<void> {
  try { await redis.del(cacheKey(tenantId)) } catch { /* non-fatal */ }
}

/** Effective handoff config for a tenant (row values → code defaults). Cached 60s. */
export async function getHandoffConfig(tenantId: string): Promise<HandoffConfig> {
  const cached = await redis.get(cacheKey(tenantId)).catch(() => null)
  if (cached) { try { return JSON.parse(cached) } catch { /* fall through */ } }

  const { rows: [r] } = await db.query(
    `SELECT handoff_enabled, handoff_pause_on_owner_reply, handoff_timeout_min,
            handoff_offer_message, handoff_button_label, handoff_ack_message,
            handoff_resume_message, handoff_owner_resume_keyword
     FROM agent_config WHERE tenant_id = $1`,
    [tenantId]
  )
  const cfg: HandoffConfig = !r ? { ...HANDOFF_DEFAULTS } : {
    enabled: r.handoff_enabled !== false,
    pause_on_owner_reply: r.handoff_pause_on_owner_reply !== false,
    timeout_min: Number(r.handoff_timeout_min) > 0 ? Number(r.handoff_timeout_min) : HANDOFF_DEFAULTS.timeout_min,
    offer_message: trim(r.handoff_offer_message) || HANDOFF_DEFAULTS.offer_message,
    button_label: trim(r.handoff_button_label) || HANDOFF_DEFAULTS.button_label,
    ack_message: trim(r.handoff_ack_message) || HANDOFF_DEFAULTS.ack_message,
    resume_message: trim(r.handoff_resume_message),
    owner_resume_keyword: trim(r.handoff_owner_resume_keyword),
  }
  redis.setex(cacheKey(tenantId), CACHE_TTL, JSON.stringify(cfg)).catch(() => {})
  return cfg
}

// Shared validation for the handoff fields — used by BOTH the tenant self-service
// endpoint and the Root Admin per-tenant editor so the two stay in sync.
export const handoffUpdateSchema = z.object({
  handoff_enabled:              z.boolean().optional(),
  handoff_pause_on_owner_reply: z.boolean().optional(),
  handoff_timeout_min:          z.number().int().min(1).max(1440).optional(),
  handoff_offer_message:        z.string().max(500).optional(),
  handoff_button_label:         z.string().max(80).optional(),
  handoff_ack_message:          z.string().max(500).optional(),
  handoff_resume_message:       z.string().max(500).optional(),
  handoff_owner_resume_keyword: z.string().max(60).optional(),
})
