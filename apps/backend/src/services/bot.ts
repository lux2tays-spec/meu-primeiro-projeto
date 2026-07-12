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

## FERRAMENTAS (USO OBRIGATÓRIO — nenhuma ação acontece sem elas)
Você NÃO consegue realizar nenhuma ação sozinho(a). Consultar horários, agendar, cancelar e salvar dados SÓ acontecem quando você CHAMA a ferramenta e ela retorna sucesso ("ok": true). Nunca simule uma ação, nunca prometa "fazer depois".
- check_availability: CHAME SEMPRE antes de mencionar ou oferecer QUALQUER horário. Nunca invente horários livres.
- book_appointment: a ÚNICA forma de agendar. CHAME após confirmar serviço + data + hora com o cliente.
- cancel_appointment: a ÚNICA forma de cancelar o próximo agendamento do cliente.
- save_customer_info: CHAME IMEDIATAMENTE (na mesma resposta) quando o cliente informar NOME, E-MAIL ou um serviço de interesse — mesmo que ele não vá fechar agora.

## HONESTIDADE (REGRAS INVIOLÁVEIS)
- Só diga "agendado", "confirmado" ou "garantido" DEPOIS que book_appointment retornar "ok": true NESTA conversa. Antes disso, o agendamento NÃO existe.
- Só diga "dados salvos" / "anotei seus dados" DEPOIS que save_customer_info retornar "ok": true.
- Se uma ferramenta retornar erro, o resultado é que a ação NÃO FOI FEITA. Seja honesto(a): peça desculpas brevemente e diga que não conseguiu concluir agora e que alguém da equipe vai confirmar com o cliente. É PROIBIDO: dizer que foi um "problema técnico" ou "instabilidade", dizer que "o sistema vai normalizar", prometer "processar depois", ou afirmar que a ação aconteceu.
- Significado dos erros: "sem_profissional" ou "sem_horario_config" = a agenda deste estabelecimento ainda não está configurada — NÃO ofereça nem confirme horários; diga que vai verificar a agenda e que alguém da equipe confirma o horário em seguida. "horario_indisponivel" = aquele horário foi ocupado — consulte check_availability e ofereça outro. "servico_nao_encontrado" = confirme com o cliente qual serviço ele quer (use os nomes da lista de serviços).
- Você NÃO tem como gerar link de pagamento, cobrar, dar desconto, parcelar ou enviar boleto/PIX. NUNCA ofereça nem prometa nada disso. Pagamento e valores especiais são tratados diretamente com o estabelecimento.
- Nunca prometa nenhuma ação futura que você não consegue executar com as ferramentas listadas acima.

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
    description: 'ÚNICA forma de salvar dados do cliente. CHAME IMEDIATAMENTE quando o cliente informar o nome, o e-mail ou demonstrar interesse em um serviço — na mesma resposta, mesmo que ele não vá agendar agora. Sem esta chamada, NADA fica salvo. Só afirme "dados salvos" se ela retornar "ok": true.',
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
    description: 'Retorna os horários REALMENTE livres para um serviço numa data. CHAME SEMPRE antes de mencionar, oferecer ou confirmar qualquer horário — nunca cite um horário sem consultar aqui primeiro. Se retornar erro (ex.: sem_horario_config, sem_profissional), NÃO ofereça horários.',
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
    description: 'ÚNICA forma de agendar de verdade. CHAME após o cliente confirmar serviço, data e hora. Se retornar "ok": true, o agendamento existe e você pode confirmar ao cliente. Se retornar erro, o agendamento NÃO foi feito — nunca diga que está agendado/garantido nesse caso.',
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
    description: 'ÚNICA forma de cancelar o próximo agendamento do cliente. CHAME quando o cliente pedir para cancelar. Só confirme o cancelamento se retornar "ok": true.',
    input_schema: { type: 'object', properties: {} },
  },
]

type ExecCtx = { tenantId: string; customerId?: string }

/** Logging wrapper: EVERY tool call is logged (tenant, tool, input, outcome). */
async function executeTool(name: string, input: any, ctx: ExecCtx): Promise<any> {
  console.log(`[bot:tool] CHAMADA tenant=${ctx.tenantId} customer=${ctx.customerId ?? 'AUSENTE'} tool=${name} input=${JSON.stringify(input)}`)
  let result: any
  try {
    result = await runTool(name, input, ctx)
  } catch (err) {
    console.error(`[bot:tool] EXCEÇÃO tenant=${ctx.tenantId} tool=${name}:`, err)
    result = { error: 'falha_interna' }
  }
  if (result && result.error) {
    console.error(`[bot:tool] ERRO tenant=${ctx.tenantId} tool=${name} resultado=${JSON.stringify(result)}`)
  } else {
    console.log(`[bot:tool] OK tenant=${ctx.tenantId} tool=${name} resultado=${JSON.stringify(result)}`)
  }
  return result
}

async function runTool(name: string, input: any, ctx: ExecCtx): Promise<any> {
  const { tenantId, customerId } = ctx
  {
    if (name === 'save_customer_info') {
      if (!customerId) return { error: 'sem_cliente' }
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
      if (!prof.professional) return { error: 'sem_profissional', detalhe: 'Nenhum profissional cadastrado — não ofereça horários; diga que a equipe vai confirmar.' }
      const slotsRes = await findAvailableSlots(tenantId, prof.professional.id, service.id, input.date)
      if (!slotsRes.ok) {
        return slotsRes.reason === 'sem_horario_config'
          ? { error: 'sem_horario_config', detalhe: 'Horários de atendimento não configurados para essa data — não ofereça horários; diga que a equipe vai confirmar.' }
          : { error: 'dados_invalidos' }
      }
      return {
        service: service.name, professional: prof.professional.name, date: input.date,
        horarios_livres: slotsRes.slots, sem_horario: slotsRes.slots.length === 0,
      }
    }

    if (name === 'book_appointment') {
      if (!customerId) return { error: 'sem_cliente' }
      const service = await resolveService(tenantId, input.service ?? '')
      if (!service) return { error: 'servico_nao_encontrado' }
      const prof = await resolveProfessional(tenantId, input.professional)
      if (prof.ambiguous) return { error: 'escolha_profissional', profissionais: prof.options?.map((p) => p.name) }
      if (!prof.professional) return { error: 'sem_profissional', detalhe: 'Nenhum profissional cadastrado — o agendamento NÃO foi feito; diga que a equipe vai confirmar.' }
      const res = await bookAppointment({
        tenantId, customerId, serviceId: service.id, professionalId: prof.professional.id,
        date: input.date, time: input.time,
      })
      if (!res.ok) {
        if (res.reason === 'unavailable') return { error: 'horario_indisponivel' }
        if (res.reason === 'sem_horario_config') return { error: 'sem_horario_config', detalhe: 'Agenda não configurada para essa data — o agendamento NÃO foi feito; diga que a equipe vai confirmar.' }
        return { error: 'dados_invalidos' }
      }
      return { ok: true, agendado: { service: service.name, professional: prof.professional.name, date: input.date, time: input.time } }
    }

    if (name === 'cancel_appointment') {
      if (!customerId) return { error: 'sem_cliente' }
      const res = await cancelUpcomingAppointment(tenantId, customerId)
      return res.ok ? { ok: true, cancelado: res.when } : { error: 'sem_agendamento' }
    }

    return { error: 'ferramenta_desconhecida' }
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

  // The webhook always resolves/creates the customer before dispatching; if this
  // ever regresses, surface it loudly — without customerId every action tool fails.
  if (!customerId) {
    console.warn(`[bot] AVISO tenant=${tenantId} conversa=${conversationId}: customerId AUSENTE — save_customer_info/book_appointment/cancel_appointment vão falhar`)
  }

  const [context, live, history, profile] = await Promise.all([
    getTenantContext(tenantId),
    getLiveBusinessContext(tenantId),
    getConversationHistory(conversationId),
    customerId ? getCustomerProfile(tenantId, customerId) : Promise.resolve({ history: [], interest: {} }),
  ])
  if (!context) throw new Error('Tenant config not found')

  // Resolve the model + API key from the Root Admin config (single/hybrid) for this message.
  const aiConfig = await getAiConfig()
  // API key comes from the Root Admin panel; fall back to env for existing deployments.
  const anthropic = new Anthropic({
    apiKey: aiConfig.api_key || process.env.ANTHROPIC_API_KEY,
    ...(aiConfig.base_url ? { baseURL: aiConfig.base_url } : {}),
  })
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

  // Single place to call the model — preserves model-config, prompt caching,
  // thinking-disabled and usage-recording behavior for every request in the loop.
  const callModel = async (toolChoice: any): Promise<any> => {
    const createParams: any = { model, max_tokens: 1024, system, tools: TOOLS, tool_choice: toolChoice, messages }
    if (thinkingOff) createParams.thinking = { type: 'disabled' }
    const response: any = await anthropic.messages.create(createParams)
    recordUsage(tenantId, model, response.usage).catch(() => {})
    return response
  }

  const extractText = (response: any): string =>
    response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await callModel({ type: 'auto' })

    // Branch on tool_use BLOCKS, not stop_reason — the model can emit a tool_use
    // and stop with a different stop_reason; the old code then returned an empty
    // text turn and the customer got the generic "Desculpe, pode repetir?".
    const toolUses = response.content.filter((b: any) => b.type === 'tool_use')
    if (toolUses.length > 0) {
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const block of toolUses) {
        const result = await executeTool(block.name, block.input, execCtx)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: Boolean(result && result.error),
        })
      }
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      continue // ALWAYS loop again so the model produces a final natural-language reply
    }

    const text = extractText(response)
    if (text) return text
    break // no tools and no text — force a plain-text reply below
  }

  // Tool budget exhausted, or the model produced an empty turn: one final call
  // with tool_choice "none" so the customer ALWAYS gets a real reply that
  // reflects the actual tool results (never a fabricated success).
  console.warn(`[bot] tenant=${tenantId} conversa=${conversationId}: forçando resposta final em texto (tool_choice=none)`)
  const finalResponse = await callModel({ type: 'none' })
  const finalText = extractText(finalResponse)
  return finalText || 'Desculpe, não consegui concluir isso agora. 🙏 Alguém da nossa equipe vai continuar seu atendimento em breve!'
}
