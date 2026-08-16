import Anthropic from '@anthropic-ai/sdk'
import { getAiConfig } from '../lib/botConfig'
import { getSupportBotConfig } from '../lib/supportBotConfig'
import { recordUsage } from '../lib/aiUsage'
import { redis } from '../lib/redis'

// The support bot has no DB tables of its own; it keeps a short rolling memory
// per visitor phone in Redis (1h TTL, last ~20 turns).
type Turn = { role: 'user' | 'assistant'; content: string }

async function getHistory(phone: string): Promise<Turn[]> {
  const raw = await redis.get(`support:hist:${phone}`)
  return raw ? (JSON.parse(raw) as Turn[]) : []
}

async function pushHistory(phone: string, turns: Turn[]): Promise<void> {
  const next = [...(await getHistory(phone)), ...turns].slice(-20)
  await redis.setex(`support:hist:${phone}`, 60 * 60, JSON.stringify(next))
}

/**
 * Answer one inbound WhatsApp message to the system support/sales number.
 * Reuses the platform's AI credentials (getAiConfig) with the cheaper model, and
 * the support persona/product info from support_bot_config.
 */
export async function runSupportBot(phone: string, message: string): Promise<string> {
  const [ai, cfg] = await Promise.all([getAiConfig(), getSupportBotConfig()])
  const anthropic = new Anthropic({
    apiKey: ai.api_key || process.env.ANTHROPIC_API_KEY,
    ...(ai.base_url ? { baseURL: ai.base_url } : {}),
  })
  // Support chat is low-stakes → use the cheap model regardless of the tenant mode.
  const model = ai.model_simple || 'claude-haiku-4-5'

  const system = [
    cfg.system_prompt,
    cfg.product_info?.trim() ? `\n## SOBRE O PRODUTO (use apenas isto para preços/recursos)\n${cfg.product_info.trim()}` : '',
    `\n## AÇÃO\nQuando fizer sentido, convide a pessoa a criar a conta e assinar: ${cfg.register_url}`,
    `\n## ESTILO\nMensagens curtas de WhatsApp (no máximo 4 linhas), tom humano e simpático. Emojis com moderação. Nunca invente preços/recursos fora do que está descrito acima.`,
  ].filter(Boolean).join('\n')

  const history = await getHistory(phone)
  const createParams: any = {
    model,
    max_tokens: 700,
    // system estável → cacheado (prefixo idêntico entre visitantes/turnos).
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [...history, { role: 'user', content: message }],
  }
  if (!model.startsWith('claude-haiku')) createParams.thinking = { type: 'disabled' }

  const resp: any = await anthropic.messages.create(createParams)
  // Registra o uso (custo antes invisível — não caía em ai_usage). tenant null =
  // uso da plataforma (número de suporte), não de um tenant.
  recordUsage(null, model, resp.usage).catch(() => {})
  const text: string =
    resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim() ||
    'Desculpe, pode repetir? 😊'

  await pushHistory(phone, [{ role: 'user', content: message }, { role: 'assistant', content: text }])
  return text
}
