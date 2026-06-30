import Anthropic from '@anthropic-ai/sdk'
import { db } from '../lib/db'
import { redis, BOT_CONTEXT_TTL, TENANT_CONFIG_TTL } from '../lib/redis'
import type { BotMessage } from '@agendabot/shared'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

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
  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now)
  todayEnd.setHours(23, 59, 59, 999)
  const tomorrowStart = new Date(todayStart)
  tomorrowStart.setDate(tomorrowStart.getDate() + 1)
  const tomorrowEnd = new Date(todayEnd)
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1)

  const [servicesRes, hoursRes, todayAppsRes, tomorrowAppsRes] = await Promise.all([
    db.query(
      `SELECT name, description, duration_minutes, price
       FROM services WHERE tenant_id = $1 AND active = TRUE ORDER BY name`,
      [tenantId]
    ),
    db.query(
      `SELECT p.name AS professional_name, wh.day_of_week, wh.start_time, wh.end_time
       FROM working_hours wh
       JOIN professionals p ON p.id = wh.professional_id
       WHERE wh.tenant_id = $1
       ORDER BY p.name, wh.day_of_week`,
      [tenantId]
    ),
    db.query(
      `SELECT a.starts_at, a.ends_at, a.status, s.name AS service, p.name AS professional, c.name AS customer_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id
       JOIN customers c ON c.id = a.customer_id
       WHERE a.tenant_id = $1 AND a.starts_at BETWEEN $2 AND $3 AND a.status != 'cancelled'
       ORDER BY a.starts_at`,
      [tenantId, todayStart.toISOString(), todayEnd.toISOString()]
    ),
    db.query(
      `SELECT a.starts_at, a.ends_at, s.name AS service, p.name AS professional
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id
       WHERE a.tenant_id = $1 AND a.starts_at BETWEEN $2 AND $3 AND a.status != 'cancelled'
       ORDER BY a.starts_at`,
      [tenantId, tomorrowStart.toISOString(), tomorrowEnd.toISOString()]
    ),
  ])

  return {
    services: servicesRes.rows,
    workingHours: hoursRes.rows,
    todayAppointments: todayAppsRes.rows,
    tomorrowAppointments: tomorrowAppsRes.rows,
  }
}

async function getCustomerContext(tenantId: string, customerId: string) {
  const { rows } = await db.query(
    `SELECT a.starts_at, a.status, s.name AS service, p.name AS professional
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     JOIN professionals p ON p.id = a.professional_id
     WHERE a.tenant_id = $1 AND a.customer_id = $2
     ORDER BY a.starts_at DESC
     LIMIT 10`,
    [tenantId, customerId]
  )
  return rows
}

async function getConversationHistory(conversationId: string): Promise<BotMessage[]> {
  const cacheKey = `bot:context:${conversationId}`
  const cached = await redis.get(cacheKey)
  if (cached) return JSON.parse(cached)

  const { rows } = await db.query(
    `SELECT role, content, created_at AS timestamp
     FROM messages
     WHERE conversation_id = $1 AND archived_at IS NULL
     ORDER BY created_at DESC
     LIMIT 20`,
    [conversationId]
  )

  const history = rows.reverse() as BotMessage[]
  await redis.setex(cacheKey, BOT_CONTEXT_TTL, JSON.stringify(history))
  return history
}

async function appendToHistory(conversationId: string, message: BotMessage) {
  const cacheKey = `bot:context:${conversationId}`
  const history = await getConversationHistory(conversationId)
  const trimmed = [...history, message].slice(-20)
  await redis.setex(cacheKey, BOT_CONTEXT_TTL, JSON.stringify(trimmed))
}

function formatWorkingHours(rows: any[]): string {
  const byProfessional: Record<string, string[]> = {}
  for (const r of rows) {
    if (!byProfessional[r.professional_name]) byProfessional[r.professional_name] = []
    byProfessional[r.professional_name].push(
      `${DAY_NAMES[r.day_of_week]}: ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`
    )
  }
  return Object.entries(byProfessional)
    .map(([name, days]) => `• ${name}: ${days.join(', ')}`)
    .join('\n')
}

function formatServices(rows: any[]): string {
  return rows
    .map((s) => {
      const desc = s.description ? ` — ${s.description}` : ''
      return `• ${s.name}${desc} | R$ ${Number(s.price).toFixed(2)} | ${s.duration_minutes} min`
    })
    .join('\n')
}

function formatTodayAppointments(rows: any[]): string {
  if (!rows.length) return 'Sem agendamentos confirmados para hoje.'
  return rows
    .map((a) => {
      const time = new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      return `• ${time} — ${a.service} com ${a.professional} (${a.customer_name})`
    })
    .join('\n')
}

function formatPastAppointments(rows: any[]): string {
  if (!rows.length) return 'Este cliente não tem histórico de atendimentos.'
  return rows
    .map((a) => {
      const date = new Date(a.starts_at).toLocaleDateString('pt-BR')
      return `• ${date} — ${a.service} com ${a.professional} (${a.status})`
    })
    .join('\n')
}

function buildSystemPrompt(ctx: any, live: any, customerHistory: any[], customerName: string, customerPhone: string, hasHistory: boolean): string {
  const loc = [ctx.address, ctx.neighborhood, ctx.city, ctx.state].filter(Boolean).join(', ')
  const links: string[] = []
  if (ctx.instagram_url) links.push(`Instagram: ${ctx.instagram_url}`)
  if (ctx.google_maps_url) links.push(`Google Maps: ${ctx.google_maps_url}`)
  if (ctx.website_url) links.push(`Site: ${ctx.website_url}`)
  if (ctx.whatsapp_number) links.push(`WhatsApp: ${ctx.whatsapp_number}`)

  const now = new Date()
  const todayName = DAY_NAMES[now.getDay()]
  const todayFmt = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })

  const nameIsKnown = customerName && customerName !== customerPhone
  const effectiveTone = ctx.tone || ctx.template_tone || 'amigável e profissional'

  // Merge global template with tenant-specific config
  const templatePrompt = ctx.template_system_prompt || ''
  const templateInstructions = ctx.template_custom_instructions || ''
  const tenantPrompt = ctx.system_prompt || ''
  const tenantInstructions = ctx.custom_instructions || ''

  const continuationWarning = hasHistory
    ? `REGRA ABSOLUTA — LEIA ANTES DE TUDO:
Você está no meio de uma conversa em andamento.
PROIBIDO: saudações ("Olá", "Oi", "Bem-vindo"), apresentações ("Sou o Jackinho", "Me chamo"), boas-vindas.
${nameIsKnown ? `PROIBIDO: perguntar o nome. O nome do cliente é "${customerName}".` : 'PROIBIDO: perguntar o nome se o cliente já o disse no histórico abaixo.'}
OBRIGATÓRIO: responda diretamente ao que o cliente disse na última mensagem.
FIM DA REGRA ABSOLUTA.\n\n`
    : ''

  return `${continuationWarning}Você é o assistente virtual de WhatsApp do(a) "${ctx.business_name}"${ctx.business_type ? ` (${ctx.business_type})` : ''}.
Tom de voz: ${effectiveTone}. Idioma: ${ctx.language || 'Português'}.
Hoje é ${todayFmt}.

${templatePrompt ? templatePrompt + '\n' : ''}${tenantPrompt ? tenantPrompt + '\n' : ''}

## IDENTIDADE DO NEGÓCIO
${ctx.business_info ? ctx.business_info + '\n' : ''}${loc ? `Endereço: ${loc}\n` : ''}${links.length ? links.join('\n') + '\n' : ''}

## SERVIÇOS E PREÇOS
${formatServices(live.services) || 'Sem serviços cadastrados.'}

## HORÁRIOS DE ATENDIMENTO
${formatWorkingHours(live.workingHours) || 'Horários não configurados.'}

## AGENDA DE HOJE (${todayName})
${formatTodayAppointments(live.todayAppointments)}

## AGENDA DE AMANHÃ
${live.tomorrowAppointments.length
  ? live.tomorrowAppointments.map((a: any) => {
      const time = new Date(a.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      return `• ${time} — ${a.service} com ${a.professional}`
    }).join('\n')
  : 'Sem agendamentos para amanhã.'}

## CLIENTE ATUAL
Telefone: ${customerPhone}
${nameIsKnown ? `Nome: ${customerName} (não pergunte o nome novamente)` : 'Nome: ainda não informado'}
${formatPastAppointments(customerHistory)}

## REGRAS ABSOLUTAS — NUNCA VIOLE ESTAS REGRAS
${hasHistory
  ? '⚠️ CONVERSA EM ANDAMENTO: Você JÁ se apresentou. PROIBIDO se apresentar novamente. Continue a conversa diretamente.'
  : '✅ PRIMEIRA MENSAGEM: Apresente-se brevemente uma única vez.'}
- ${nameIsKnown ? `⚠️ NOME JÁ CONHECIDO: O cliente se chama "${customerName}". NUNCA peça o nome novamente.` : 'Se precisar do nome, pergunte UMA única vez durante toda a conversa.'}
- NUNCA repita perguntas já feitas nesta conversa.
- NUNCA envie saudações repetidas ("Olá!", "Bem-vindo!") se já foram enviadas antes.
- Mantenha total continuidade: lembre de TUDO que foi dito nesta sessão.
- Se o cliente foi atendido há mais de ${ctx.return_reminder_days ?? 30} dias, sugira proativamente um retorno.
- Seja conciso: respostas curtas e diretas, sem repetir o que já foi dito.

## SUAS RESPONSABILIDADES
- Responder dúvidas sobre serviços, preços, horários, localização e redes sociais
- Ajudar o cliente a agendar, remarcar ou cancelar atendimentos
- Consultar a agenda antes de sugerir horários — nunca sugira horários já ocupados
- Enviar localização, Instagram ou Google Maps quando solicitado

${templateInstructions ? '## INSTRUÇÕES DO TIPO DE NEGÓCIO\n' + templateInstructions + '\n' : ''}
${tenantInstructions ? '## INSTRUÇÕES ESPECÍFICAS DO ESTABELECIMENTO\n' + tenantInstructions + '\n' : ''}

## FORMATO DE RESPOSTA
Na maioria das vezes, responda com texto simples e direto — SEM JSON.
Use JSON SOMENTE nestas situações específicas:
- Cliente informa o nome → { "action": "UPDATE_CUSTOMER_INFO", "reply": "mensagem", "data": { "name": "nome" } }
- Cliente informa o e-mail → { "action": "UPDATE_CUSTOMER_INFO", "reply": "mensagem", "data": { "email": "email" } }
- Agendamento confirmado → { "action": "SCHEDULE", "reply": "mensagem", "data": { ... } }
- Cancelamento confirmado → { "action": "CANCEL", "reply": "mensagem", "data": { ... } }
IMPORTANTE: Nunca use JSON para respostas comuns. Responda sempre em texto puro, sem blocos de código.
`.trim()
}

export async function processMessage(params: {
  tenantId: string
  conversationId: string
  customerMessage: string
  customerId?: string
  customerName?: string
  customerPhone?: string
}) {
  const { tenantId, conversationId, customerMessage, customerId, customerName = '', customerPhone = '' } = params

  const [context, live, history, customerHistory] = await Promise.all([
    getTenantContext(tenantId),
    getLiveBusinessContext(tenantId),
    getConversationHistory(conversationId),
    customerId ? getCustomerContext(tenantId, customerId) : Promise.resolve([]),
  ])

  if (!context) throw new Error('Tenant config not found')

  const systemPrompt = buildSystemPrompt(context, live, customerHistory, customerName, customerPhone, history.length > 0)

  const messages = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user' as const, content: customerMessage },
  ]

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const assistantContent = response.content[0].type === 'text' ? response.content[0].text : ''

  await appendToHistory(conversationId, { role: 'user', content: customerMessage, timestamp: new Date().toISOString() })
  await appendToHistory(conversationId, { role: 'assistant', content: assistantContent, timestamp: new Date().toISOString() })

  return assistantContent
}
