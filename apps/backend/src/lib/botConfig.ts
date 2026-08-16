import { db } from './db'
import { redis } from './redis'
import { decrypt } from './crypto'

// AI model configuration, stored as the `ai_config` row in platform_settings and
// edited by the Root Admin. Cached in Redis (60s) and invalidated on save.

export type AiConfig = {
  provider: string
  api_key: string        // Anthropic API key (Root Admin) — falls back to env
  base_url: string       // optional custom endpoint (proxy / compatible API)
  model: string          // used in single mode; the "closing" model in hybrid mode
  model_simple: string   // cheap model for simple turns in hybrid mode
  mode: 'single' | 'hybrid'
  usd_brl_rate: number
  caps: Record<string, number> // monthly USD cap per plan slug (0 = unlimited)
  transcription_provider: string // 'openai' | 'groq' | '' — for audio transcription
  transcription_api_key: string  // key for the transcription provider
}

// Teto de gasto MENSAL de IA por plano (USD). Floor de segurança: mesmo sem
// nenhuma configuração no Root Admin, nenhum tenant fica com gasto ilimitado
// (evita fatura aberta por abuso). O Root Admin pode sobrescrever por plano.
// 0 = ilimitado (só se explicitamente definido assim no painel).
const DEFAULT_CAPS: Record<string, number> = {
  free: 1,
  basico: 3,
  premium: 8,
  profissional: 20,
}

const DEFAULTS: AiConfig = {
  provider: 'anthropic',
  api_key: '',
  base_url: '',
  model: 'claude-sonnet-5',
  model_simple: 'claude-haiku-4-5',
  // Híbrido por padrão: turnos simples no modelo barato, promovendo ao forte no
  // 1º sinal de venda/ferramenta e mantendo (sticky) — ver resolução no bot.ts.
  mode: 'hybrid',
  usd_brl_rate: 6,
  caps: DEFAULT_CAPS,
  transcription_provider: '',
  transcription_api_key: '',
}

const CACHE_KEY = 'ai:config'

// ── Bot runtime + behaviour config (Root Admin, global) ──────────────────────
// Everything here used to be hardcoded in bot.ts / botDispatcher.ts / reminder
// jobs. Now it lives in platform_settings 'bot_config' so the platform owner can
// tune it without a deploy. Per-tenant overrides (allow_price_list, etc.) live in
// agent_config and fall back to the *_default values below.

export type BotConfig = {
  // operational limits
  max_tokens: number
  max_tool_turns: number
  sender_rate_limit: number      // max bot runs per customer phone per tenant per hour
  dedup_ttl_seconds: number      // inbound message-id dedup window
  debounce_ms: number            // wait window to group rapid-fire messages
  hybrid_sales_signal: string    // regex: which messages route to the stronger model
  // base behaviour rules (global)
  never_reveal_ai: boolean
  allow_payment_talk: boolean    // may the bot discuss payment/pix/discounts?
  use_emojis: boolean            // when false (or formal tone) → no emojis at all
  max_reply_lines: number        // "mensagens de no máximo N linhas"
  base_extra_instructions: string
  // global defaults for per-tenant toggles (agent_config overrides these)
  allow_price_list_default: boolean
  collect_last_name_default: boolean
  // global reminder templates (agent_config may override per tenant)
  reminder_return_template: string
  reminder_appointment_template: string
}

// Defaults preserve the previous hardcoded behaviour exactly.
export const BOT_DEFAULTS: BotConfig = {
  max_tokens: 1024,
  max_tool_turns: 6,
  sender_rate_limit: 40,
  dedup_ttl_seconds: 60 * 60,
  debounce_ms: 7000,
  hybrid_sales_signal: 'agend|marc|hor[aá]ri|pre[cç]o|valor|quero|fech|confirm|dispon|cancel|remarc|reserv|quanto|orç',
  never_reveal_ai: true,
  allow_payment_talk: false,
  use_emojis: true,
  max_reply_lines: 4,
  base_extra_instructions: '',
  allow_price_list_default: false,
  collect_last_name_default: true,
  reminder_return_template:
    'Olá, {cliente}! 😊\n\nTudo bem? Notamos que já faz {dias} desde o seu último *{servico}* aqui na *{negocio}*.\n\nQue tal agendar um novo atendimento? Estamos à disposição! 📅\n\nResponda esta mensagem para marcar seu horário. 😊',
  reminder_appointment_template:
    'Oi {cliente}! 😊 Passando pra confirmar seu *{servico}* {quando} às *{hora}* na {negocio}. Está confirmado? Responde *SIM* pra confirmar 👍 ou me chama se precisar remarcar.',
}

const BOT_CACHE_KEY = 'bot:config'

export async function getBotConfig(): Promise<BotConfig> {
  const cached = await redis.get(BOT_CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query("SELECT value FROM platform_settings WHERE key = 'bot_config'")
  const merged: BotConfig = { ...BOT_DEFAULTS, ...(row?.value ?? {}) }
  await redis.setex(BOT_CACHE_KEY, 60, JSON.stringify(merged))
  return merged
}

export async function invalidateBotConfig(): Promise<void> {
  await redis.del(BOT_CACHE_KEY)
}

export async function getAiConfig(): Promise<AiConfig> {
  const cached = await redis.get(CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query("SELECT value FROM platform_settings WHERE key = 'ai_config'")
  const merged: AiConfig = { ...DEFAULTS, ...(row?.value ?? {}) }
  // Secrets are stored encrypted at rest (decrypt tolerates legacy plaintext).
  merged.api_key = decrypt(merged.api_key)
  merged.transcription_api_key = decrypt(merged.transcription_api_key)
  // Back-compat: an old config may have `model: claude-haiku-4-5` and no mode
  if (!merged.mode) merged.mode = 'hybrid'
  // Floor de caps: planos sem cap explícito herdam o default (nunca ilimitado por
  // omissão). Um cap 0 explícito no painel continua valendo como "ilimitado".
  merged.caps = { ...DEFAULT_CAPS, ...(merged.caps ?? {}) }
  await redis.setex(CACHE_KEY, 60, JSON.stringify(merged))
  return merged
}

export async function invalidateAiConfig(): Promise<void> {
  await redis.del(CACHE_KEY)
}

// Sales/booking intent signals — when present, hybrid mode uses the stronger
// model. The pattern is configurable via bot_config.hybrid_sales_signal; this is
// the fallback if a bad/empty regex is provided.
const SALES_SIGNAL_FALLBACK = /agend|marc|hor[aá]ri|pre[cç]o|valor|quero|fech|confirm|dispon|cancel|remarc|reserv|quanto|orç/i

function salesSignalRegex(pattern?: string): RegExp {
  if (!pattern) return SALES_SIGNAL_FALLBACK
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return SALES_SIGNAL_FALLBACK
  }
}

// Exposto para a resolução "sticky" de modelo no bot.ts.
export function matchesSalesSignal(message: string, pattern?: string): boolean {
  return salesSignalRegex(pattern).test(message || '')
}

/**
 * Resolve which model to use for a given incoming message under the current
 * config. `salesSignal` comes from bot_config.hybrid_sales_signal (optional).
 */
export function resolveModel(cfg: AiConfig, message: string, salesSignal?: string): string {
  if (cfg.mode === 'hybrid') {
    return salesSignalRegex(salesSignal).test(message || '') ? cfg.model : cfg.model_simple
  }
  return cfg.model
}
