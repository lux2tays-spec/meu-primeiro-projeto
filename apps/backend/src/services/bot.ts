import Anthropic from '@anthropic-ai/sdk'
import { db } from '../lib/db'
import { redis, TENANT_CONFIG_TTL } from '../lib/redis'
import type { BotMessage } from '@agendabot/shared'
import {
  resolveService, resolveProfessional, findAvailableSlots,
  bookAppointment, cancelUpcomingAppointment,
} from './scheduling'
import { getAiConfig, resolveModel } from '../lib/botConfig'
import { recordUsage, monthlySpend } from '../lib/aiUsage'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const TZ = 'America/Sao_Paulo'
const MAX_TOOL_TURNS = 6

// ── Context loaders ─────────────────────────────────────────────────────────

async function getTenantContext(tenantId: string) {
  const cacheKey = `tenant:config:${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const { rows } = await db.query(
    `SELECT
       ac.system_prompt, ac.tone, ac.language, ac.business_info,
       ac.business_type, ac.address, ac.neighborhood, ac.city, ac.state,
       ac.instagram_url, ac.google_maps_url, ac.website_url, ac.whatsapp_number,
       ac.custom_instructions, ac.return_reminder_days,
       t.name AS business_name, t.plan,
       btt.system_prompt AS template_system_prompt,
       btt.custom_instructions AS template_custom_instructions,
       btt.tone AS template_tone
     FROM agent_config ac
     JOIN tenants t ON t.id = ac.tenant_id
     LEFT JOIN business_type_templates btt ON btt.business_type = ac.business_type
     WHERE ac.tenant_id = $1`,
    [tenantId]
  )
  if (!rows[0]) return null
  await redis.setex(cacheKey, TENANT_CONFIG_TTL, JSON.stringify(rows[0]))
  return rows[0]
}

async function getLiveBusinessContext(tenantId: string) {
  const [servicesRes, hoursRes] = await Promise.all([
    db.query(
      `SELECT name, description, duration_minutes, price
       FROM services WHERE tenant_id = $1 AND active = TRUE ORDER BY name`,
      [tenantId]
    ),
    db.query(
      `SELECT COALESCE(p.name, 'Geral') AS professional_name, wh.day_of_week, wh.start_time, wh.end_time
       FROM working_hours wh
       LEFT JOIN professionals p ON p.id = wh.professional_id
       WHERE wh.tenant_id = $1
       ORDER BY p.name NULLS FIRST, wh.day_of_week`,
      [tenantId]
    ),
  ])
  return { services: servicesRes.rows, workingHours: hoursRes.rows }
}

async function getCustomerProfile(tenantId: string, customerId: string) {
  const histRes = await db.query(
    `SELECT to_char(a.starts_at AT TIME ZONE $3, 'DD/MM/YYYY') AS date,
            a.status, s.name AS service, p.name AS professional
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN professionals p ON p.id = a.professional_id
     WHERE a.tenant_id = $1 AND a.customer_id = $2
     ORDER BY a.starts_at DESC LIMIT 10`,
    [tenantId, customerId, TZ]
  )
  // interested_services/last_interest_at come from migration 013 — tolerate its absence
  let interest: any = {}
  try {
    const { rows } = await db.query(
      "SELECT interested_services, to_char(last_interest_at AT TIME ZONE $3, 'DD/MM/YYYY') AS last_interest FROM customers WHERE id = $1 AND tenant_id = $2",
      [customerId, tenantId, TZ]
    )
    interest = rows[0] ?? {}
  } catch { /* column not present until migration 013 is applied */ }
  return { history: histRes.rows, interest }
}

async function getConversationHistory(conversationId: string): Promise<BotMessage[]> {
  const { rows } = await db.query(
    `SELECT role, content, created_at AS timestamp
     FROM messages
     WHERE conversation_id = $1 AND archived_at IS NULL
     ORDER BY created_at DESC LIMIT 20`,
    [conversationId]
  )
  return rows.reverse() as BotMessage[]
}

// ── Formatting helpers ──────────────────────────────────────────────────────

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

function formatWorkingHours(rows: any[]): string {
  const byProfessional: Record<string, string[]> = {}
  for (const r of rows) {
    if (!byProfessional[r.professional_name]) byProfessional[r.professional_name] = []
    byProfessional[r.professional_name].push(`${DAY_NAMES[r.day_of_week]}: ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`)
  }
  return Object.entries(byProfessional).map(([name, days]) => `• ${name}: ${days.join(', ')}`).join('\n')
}

function formatServices(rows: any[]): string {
  return rows.map((s) => {
    const desc = s.description ? ` — ${s.description}` : ''
    return `• ${s.name}${desc} | R$ ${Number(s.price).toFixed(2)} | ${s.duration_minutes} min`
  }).join('\n')
}

function formatPastAppointments(rows: any[]): string {
  if (!rows.length) return 'Este cliente ainda não tem histórico de atendimentos.'
  return rows.map((a) => `• ${a.date} — ${a.service} com ${a.professional} (${a.status})`).join('\n')
}

/** Next 7 days as a date reference so the model maps "terça"/"amanhã" reliably. */
function dateReference(): string {
  const lines: string[] = []
  const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
  const dayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' })
  const base = Date.now()
  for (let i = 0; i < 7; i++) {
    const d = new Date(base + i * 86400000)
    const label = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : dayFmt.format(d)
    lines.push(`${isoFmt.format(d)} = ${label}`)
  }
  return lines.join('\n')
}

// ── System prompt (sales-oriented, human-like) ──────────────────────────────

function buildSystemPrompt(ctx: any, live: any, profile: any, customerName: string, customerPhone: string, hasHistory: boolean): { stable: string; volatile: string } {
  const loc = [ctx.address, ctx.neighborhood, ctx.city, ctx.state].filter(Boolean).join(', ')
  const links: string[] = []
  if (ctx.instagram_url) links.push(`Instagram: ${ctx.instagram_url}`)
  if (ctx.google_maps_url) links.push(`Google Maps: ${ctx.google_maps_url}`)
  if (ctx.website_url) links.push(`Site: ${ctx.website_url}`)

  const nameIsKnown = customerName && customerName !== customerPhone
  const effectiveTone = ctx.tone || ctx.template_tone || 'amigável, caloroso e profissional'
  const templatePrompt = ctx.template_system_prompt || ''
  const tenantPrompt = ctx.system_prompt || ''
  const templateInstructions = ctx.template_custom_instructions || ''
  const tenantInstructions = ctx.custom_instructions || ''

  const interestLine = profile.interest?.interested_services
    ? `\n🎯 INTERESSE ANTERIOR (não fechou): ${profile.interest.interested_services}${profile.interest.last_interest ? ` (em ${profile.interest.last_interest})` : ''} — retome esse gancho com naturalidade.`
    : ''

  // STABLE part — same for every customer of this tenant (cacheable prefix).
  const stable = `Você é um(a) atendente HUMANO(A) de WhatsApp do(a) "${ctx.business_name}"${ctx.business_type ? ` (${ctx.business_type})` : ''}. NUNCA revele que é uma IA ou robô. Fale como uma pessoa real da equipe.
Tom: ${effectiveTone}. Idioma: ${ctx.language || 'Português do Brasil'}.

${templatePrompt ? templatePrompt + '\n' : ''}${tenantPrompt ? tenantPrompt + '\n' : ''}
## SEU OBJETIVO (VENDA)
Você é consultivo e conduz a conversa para o FECHAMENTO. Não seja passivo. Sempre que fizer sentido:
- Entenda a necessidade do cliente e RECOMENDE o serviço ideal (e um complementar/upsell quando couber).
- Dê 1 dica rápida e útil que gere valor e confiança.
- Conduza para o agendamento com um convite claro ("Posso já garantir um horário pra você?").
- Ofereça horários concretos (use a ferramenta de disponibilidade) e crie urgência REAL quando os horários estiverem escassos ("hoje só tenho 14h e 16h").
- Contorne objeções com empatia (preço → valor/benefício; "vou pensar" → ofereça segurar um horário sem compromisso).
- Feche de forma proativa: confirme serviço, dia e hora e AGENDE de fato.

## IDENTIDADE DO NEGÓCIO
${ctx.business_info ? ctx.business_info + '\n' : ''}${loc ? `Endereço: ${loc}\n` : ''}${links.length ? links.join('\n') + '\n' : ''}

## SERVIÇOS E PREÇOS
${formatServices(live.services) || 'Sem serviços cadastrados.'}

## HORÁRIOS DE FUNCIONAMENTO
${formatWorkingHours(live.workingHours) || 'Horários não configurados.'}

## CALENDÁRIO (use estas datas ao agendar)
${dateReference()}

## FERRAMENTAS (obrigatório usá-las — nunca invente dados)
- check_availability: SEMPRE consulte antes de oferecer horários. Nunca invente horários livres.
- book_appointment: use para AGENDAR DE VERDADE. Só confirme "agendado" ao cliente DEPOIS que a ferramenta retornar sucesso.
- cancel_appointment: para cancelar o próximo agendamento do cliente.
- save_customer_info: assim que souber o NOME, o E-MAIL, ou um SERVIÇO DE INTERESSE do cliente, salve na hora (mesmo que ele não feche).

## REGRAS GERAIS
- Estilo WhatsApp: mensagens CURTAS e humanas, no máximo 2-4 linhas. Emojis com moderação. Nunca mande textão.
- Nunca repita perguntas já respondidas. Lembre de tudo que foi dito.
- Confirme serviço + dia + hora antes de agendar, e agende de fato com a ferramenta.
${templateInstructions ? '\n## INSTRUÇÕES DO TIPO DE NEGÓCIO\n' + templateInstructions : ''}${tenantInstructions ? '\n## INSTRUÇÕES DO ESTABELECIMENTO\n' + tenantInstructions : ''}`.trim()

  // VOLATILE part — customer-specific, changes per conversation (not cached).
  const volatile = `## CLIENTE ATUAL
Telefone: ${customerPhone}
${nameIsKnown ? `Nome: ${customerName}` : 'Nome: ainda não informado — pergunte de forma natural em algum momento.'}${interestLine}
Histórico:
${formatPastAppointments(profile.history)}

## SITUAÇÃO DA CONVERSA
${hasHistory
  ? '- CONVERSA EM ANDAMENTO: você JÁ se apresentou. NÃO cumprimente de novo ("Olá", "Bem-vindo") nem se apresente. Continue direto.'
  : '- PRIMEIRA MENSAGEM: cumprimente de forma calorosa e breve, uma única vez.'}
${nameIsKnown ? `- O cliente se chama "${customerName}". NUNCA pergunte o nome de novo.` : ''}`.trim()

  return { stable, volatile }
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'save_customer_info',
    description: 'Salva nome, e-mail e/ou serviço de interesse do cliente. Use assim que descobrir qualquer um desses dados, mesmo que o cliente não vá fechar agora.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do cliente' },
        email: { type: 'string', description: 'E-mail do cliente' },
        interested_service: { type: 'string', description: 'Serviço que o cliente demonstrou interesse mas não agendou' },
      },
    },
  },
  {
    name: 'check_availability',
    description: 'Retorna os horários REALMENTE livres para um serviço numa data. Use SEMPRE antes de oferecer horários.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Nome do serviço' },
        date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        professional: { type: 'string', description: 'Nome do profissional (opcional)' },
      },
      required: ['service', 'date'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Agenda DE VERDADE um horário para o cliente. Só use após confirmar serviço, data e hora com o cliente.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Nome do serviço' },
        date: { type: 'string', description: 'Data YYYY-MM-DD' },
        time: { type: 'string', description: 'Hora HH:MM (24h)' },
        professional: { type: 'string', description: 'Nome do profissional (opcional)' },
      },
      required: ['service', 'date', 'time'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela o próximo agendamento do cliente.',
    input_schema: { type: 'object', properties: {} },
  },
]

type ExecCtx = { tenantId: string; customerId?: string }

async function executeTool(name: string, input: any, ctx: ExecCtx): Promise<any> {
  const { tenantId, customerId } = ctx
  try {
    if (name === 'save_customer_info') {
      if (!customerId) return { ok: false }
      // name/email — always available
      const sets: string[] = []
      const vals: any[] = []
      let i = 1
      if (input.name) { sets.push(`name = $${i++}`); vals.push(String(input.name).slice(0, 120)) }
      if (input.email) { sets.push(`email = $${i++}`); vals.push(String(input.email).slice(0, 200)) }
      if (sets.length) {
        vals.push(customerId, tenantId)
        await db.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i}`, vals)
      }
      // interest — column from migration 013; tolerate its absence
      if (input.interested_service) {
        try {
          await db.query(
            'UPDATE customers SET interested_services = $1, last_interest_at = now() WHERE id = $2 AND tenant_id = $3',
            [String(input.interested_service).slice(0, 300), customerId, tenantId]
          )
        } catch { /* migration 013 not applied yet */ }
      }
      return { ok: true }
    }

    if (name === 'check_availability') {
      const service = await resolveService(tenantId, input.service ?? '')
      if (!service) return { error: 'servico_nao_encontrado' }
      const prof = await resolveProfessional(tenantId, input.professional)
      if (prof.ambiguous) return { error: 'escolha_profissional', profissionais: prof.options?.map((p) => p.name) }
      if (!prof.professional) return { error: 'sem_profissional' }
      const slots = await findAvailableSlots(tenantId, prof.professional.id, service.id, input.date)
      return {
        service: service.name, professional: prof.professional.name, date: input.date,
        horarios_livres: slots.length ? slots : [], sem_horario: slots.length === 0,
      }
    }

    if (name === 'book_appointment') {
      if (!customerId) return { error: 'sem_cliente' }
      const service = await resolveService(tenantId, input.service ?? '')
      if (!service) return { error: 'servico_nao_encontrado' }
      const prof = await resolveProfessional(tenantId, input.professional)
      if (prof.ambiguous) return { error: 'escolha_profissional', profissionais: prof.options?.map((p) => p.name) }
      if (!prof.professional) return { error: 'sem_profissional' }
      const res = await bookAppointment({
        tenantId, customerId, serviceId: service.id, professionalId: prof.professional.id,
        date: input.date, time: input.time,
      })
      if (!res.ok) return { error: res.reason === 'unavailable' ? 'horario_indisponivel' : 'dados_invalidos' }
      return { ok: true, agendado: { service: service.name, professional: prof.professional.name, date: input.date, time: input.time } }
    }

    if (name === 'cancel_appointment') {
      if (!customerId) return { error: 'sem_cliente' }
      const res = await cancelUpcomingAppointment(tenantId, customerId)
      return res.ok ? { ok: true, cancelado: res.when } : { error: 'sem_agendamento' }
    }

    return { error: 'ferramenta_desconhecida' }
  } catch (err) {
    console.error(`Tool ${name} failed:`, err)
    return { error: 'falha_interna' }
  }
}

// ── Main entry: run the bot with native tool-calling ────────────────────────

export async function runBot(params: {
  tenantId: string
  conversationId: string
  customerMessage: string
  customerId?: string
  customerName?: string
  customerPhone?: string
}): Promise<string> {
  const { tenantId, conversationId, customerMessage, customerId, customerName = '', customerPhone = '' } = params

  const [context, live, history, profile] = await Promise.all([
    getTenantContext(tenantId),
    getLiveBusinessContext(tenantId),
    getConversationHistory(conversationId),
    customerId ? getCustomerProfile(tenantId, customerId) : Promise.resolve({ history: [], interest: {} }),
  ])
  if (!context) throw new Error('Tenant config not found')

  // Resolve the model from the Root Admin config (single/hybrid) for this message.
  const aiConfig = await getAiConfig()
  let model = resolveModel(aiConfig, customerMessage)
  // Monthly cost cap per plan (0 = unlimited): downgrade to the cheapest model when over.
  const cap = Number(aiConfig.caps?.[context.plan] ?? 0)
  if (cap > 0 && (await monthlySpend(tenantId)) >= cap) {
    model = 'claude-haiku-4-5'
  }
  // Keep the bot fast/cheap: no extended thinking (haiku has none; disable it on others).
  const thinkingOff = !model.startsWith('claude-haiku')

  const { stable, volatile } = buildSystemPrompt(context, live, profile, customerName, customerPhone, history.length > 0)
  // Prompt caching: the stable per-tenant prefix is cached; the volatile block is not.
  const system: any = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: volatile },
  ]

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: customerMessage },
  ]

  const execCtx: ExecCtx = { tenantId, customerId }

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const createParams: any = { model, max_tokens: 1024, system, tools: TOOLS, messages }
    if (thinkingOff) createParams.thinking = { type: 'disabled' }
    const response: any = await anthropic.messages.create(createParams)

    recordUsage(tenantId, model, response.usage).catch(() => {})

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await executeTool(block.name, block.input, execCtx)
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
        }
      }
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      continue
    }

    // Final answer — concatenate text blocks
    const text = response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()
    return text || 'Desculpe, pode repetir? 😊'
  }

  return 'Só um instante, já te respondo!'
}
