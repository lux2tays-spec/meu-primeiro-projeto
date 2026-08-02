import { db } from './db'
import { redis } from './redis'

// #10 — Catálogo mestre de recursos/limites por plano. Fonte da verdade única
// para o painel do Root Admin, para os bullets de marketing e para o gating.
//
// - group 'limit'  → valor numérico (0 costuma significar "ilimitado").
// - group 'feature'→ boolean (liga/desliga).
// - column         → quando o valor mora numa coluna própria de platform_plans
//                    (não em capabilities): max_agendas, max_users, media_enabled.

export type CapType = 'bool' | 'number'
export interface CapDef {
  key: string
  label: string
  type: CapType
  group: 'limit' | 'feature'
  default: boolean | number
  column?: string            // coluna de platform_plans que guarda este valor
  unlimitedAtZero?: boolean  // limite: 0 = ilimitado
  /** Texto de marketing quando ligado/definido (null = não vira bullet). */
  bullet?: (v: boolean | number) => string | null
}

export const PLAN_CAPABILITIES: CapDef[] = [
  // ── Limites ────────────────────────────────────────────────────────────────
  { key: 'max_agendas', label: 'Agendas', type: 'number', group: 'limit', default: 1, column: 'max_agendas',
    bullet: (v) => `${v} agenda${Number(v) > 1 ? 's' : ''}` },
  { key: 'max_users', label: 'Usuários / colaboradores', type: 'number', group: 'limit', default: 1, column: 'max_users',
    bullet: (v) => `${v} usuário${Number(v) > 1 ? 's' : ''}` },
  { key: 'max_messages_month', label: 'Mensagens do bot por mês (0 = ilimitado)', type: 'number', group: 'limit', default: 0, unlimitedAtZero: true,
    bullet: (v) => (Number(v) > 0 ? `${Number(v).toLocaleString('pt-BR')} mensagens/mês` : 'Mensagens ilimitadas') },

  // ── Recursos (on/off) ────────────────────────────────────────────────────────
  { key: 'vendas_module', label: 'Módulo de Vendas & Financeiro', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'Vendas e financeiro' : null) },
  { key: 'commissions', label: 'Comissões', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'Controle de comissões' : null) },
  { key: 'birthday_reminder', label: 'Lembrete de aniversário (bot)', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'Prospecção de aniversário' : null) },
  { key: 'appointment_reminders', label: 'Lembretes de agendamento', type: 'bool', group: 'feature', default: true,
    bullet: (v) => (v ? 'Lembretes de agendamento' : null) },
  { key: 'return_reminders', label: 'Lembrete de retorno (clientes sumidos)', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'Reativação de clientes' : null) },
  { key: 'ia_media', label: 'IA lê áudio e imagem', type: 'bool', group: 'feature', default: false, column: 'media_enabled',
    bullet: (v) => (v ? 'IA entende áudio e imagem' : null) },
  { key: 'advanced_ai', label: 'Configurações avançadas de IA', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'IA avançada' : null) },
  { key: 'google_calendar', label: 'Integração Google Agenda', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'Google Agenda' : null) },
  { key: 'payment_talk', label: 'Links / fala de pagamento', type: 'bool', group: 'feature', default: false,
    bullet: (v) => (v ? 'Pagamento pelo WhatsApp' : null) },
  { key: 'affiliate', label: 'Painel de afiliado', type: 'bool', group: 'feature', default: true,
    bullet: () => null },
]

export const CAPABILITY_KEYS = PLAN_CAPABILITIES.map((c) => c.key)
export type PlanCapabilities = Record<string, boolean | number>

// Resolve o valor efetivo de cada recurso para uma LINHA de platform_plans:
// coluna própria (se houver) → capabilities JSONB → default do catálogo.
export function resolveCapabilities(planRow: any): PlanCapabilities {
  const caps: PlanCapabilities = (planRow?.capabilities && typeof planRow.capabilities === 'object') ? planRow.capabilities : {}
  const out: PlanCapabilities = {}
  for (const def of PLAN_CAPABILITIES) {
    let v: any
    if (def.column && planRow?.[def.column] != null) v = planRow[def.column]
    else if (caps[def.key] != null) v = caps[def.key]
    else v = def.default
    out[def.key] = def.type === 'bool' ? !!v : Number(v) || 0
  }
  return out
}

// Bullets de marketing gerados automaticamente a partir dos recursos do plano.
export function bulletsFromCapabilities(planRow: any): string[] {
  const caps = resolveCapabilities(planRow)
  const bullets: string[] = []
  for (const def of PLAN_CAPABILITIES) {
    if (!def.bullet) continue
    const b = def.bullet(caps[def.key])
    if (b) bullets.push(b)
  }
  return bullets
}

// ── Gating: capabilities do plano ATUAL de um tenant (cache 5 min) ─────────────
const TENANT_CAP_TTL = 300
export async function getTenantCapabilities(tenantId: string): Promise<PlanCapabilities> {
  const cacheKey = `tenant:caps:${tenantId}`
  try {
    const cached = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)
  } catch { /* cache best-effort */ }

  const { rows: [row] } = await db.query(
    `SELECT p.* FROM tenants t JOIN platform_plans p ON p.slug = t.plan WHERE t.id = $1`,
    [tenantId]
  )
  const caps = row ? resolveCapabilities(row) : resolveCapabilities({})
  try { await redis.set(cacheKey, JSON.stringify(caps), 'EX', TENANT_CAP_TTL) } catch { /* ignore */ }
  return caps
}

// preHandler Fastify que bloqueia a rota (403) quando o plano do tenant não tem
// o recurso. Root passa sempre. O front trata 'plan_upgrade_required' com o
// cadeado + convite de upgrade.
export function capabilityGuard(key: string) {
  return async (request: any, reply: any) => {
    if (request.user?.role === 'root') return
    if (!request.user?.tenant_id) return
    const caps = await getTenantCapabilities(request.user.tenant_id)
    if (!caps[key]) {
      return reply.status(403).send({ error: 'plan_upgrade_required', capability: key })
    }
  }
}

export async function invalidateTenantCapabilities(tenantId?: string) {
  try {
    if (tenantId) { await redis.del(`tenant:caps:${tenantId}`); return }
    const stream = redis.scanStream({ match: 'tenant:caps:*', count: 100 })
    for await (const keys of stream as unknown as AsyncIterable<string[]>) {
      if (keys.length) await redis.del(...keys)
    }
  } catch { /* best-effort */ }
}
