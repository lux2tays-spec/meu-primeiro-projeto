import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { db } from '../lib/db'
import { redis, TENANT_CONFIG_TTL } from '../lib/redis'
import type { BotMessage } from '@agendabot/shared'
import {
  resolveService, resolveProfessional, findAvailableSlots,
  bookAppointment, cancelAppointmentById,
  listUpcomingAppointments, type UpcomingAppointment,
} from './scheduling'
import { getAiConfig, resolveModel, matchesSalesSignal, getBotConfig, type BotConfig } from '../lib/botConfig'
import { recordUsage, monthlySpend } from '../lib/aiUsage'
import { sendInviteForAppointment, sendInvitesForCustomerUpcoming } from './appointmentInvite'
import { notifyAppointmentParties } from '../lib/notifications'

const TZ = 'America/Sao_Paulo'

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
       ac.allow_price_list, ac.collect_last_name, ac.allow_payment_talk,
       ac.persona_name, ac.persona_style,
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

/** Upcoming appointments block for the volatile prompt — so the bot answers
 *  "que horas é meu horário?" with the truth instead of guessing. */
function formatUpcomingAppointments(upcoming: UpcomingAppointment[]): string {
  if (!upcoming.length) return 'Próximos agendamentos: NENHUM — este cliente NÃO tem NENHUM horário futuro marcado. Se ele perguntar ou AFIRMAR que tem um agendamento, diga com gentileza que não encontrou nenhum horário marcado no sistema e ofereça agendar. NUNCA invente nem confirme um horário — mesmo que algo tenha sido dito antes NESTA conversa (pode ter sido cancelado ou nunca criado). Esta lista é a ÚNICA verdade sobre os agendamentos do cliente.'
  const lines = upcoming.map((a) =>
    `• ${a.when} (data ${a.date}) — ${a.serviceName}${a.professionalName ? ` com ${a.professionalName}` : ''}`
  )
  const plural = upcoming.length > 1
  return `Próximo${plural ? 's' : ''} agendamento${plural ? 's' : ''} JÁ MARCADO${plural ? 'S' : ''} (dd/mm hh:mm):
${lines.join('\n')}
${plural
  ? '⚠️ O cliente tem MAIS DE UM agendamento futuro: antes de cancelar ou remarcar, confirme QUAL deles (data/serviço) e informe isso na ferramenta.'
  : 'Se o cliente perguntar quando é o horário dele, responda com base nessa informação.'}`
}

/** Next 30 days as a date reference so the model maps "terça"/"amanhã"/"dia 15
 *  do mês que vem" reliably. BOT-16: 30 dias (antes 7) — clientes agendam além
 *  de uma semana; o custo extra é baixo porque o bloco vive no prefixo estável
 *  do prompt (cacheado) e só muda uma vez por dia. */
function dateReference(): string {
  const lines: string[] = []
  const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
  const dayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' })
  const base = Date.now()
  for (let i = 0; i < 30; i++) {
    const d = new Date(base + i * 86400000)
    const label = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : dayFmt.format(d)
    lines.push(`${isoFmt.format(d)} = ${label}`)
  }
  return lines.join('\n')
}

// ── System prompt (sales-oriented, human-like) ──────────────────────────────

function buildSystemPrompt(ctx: any, live: any, profile: any, upcoming: UpcomingAppointment[], customerName: string, customerLastName: string, customerPhone: string, hasHistory: boolean, botCfg: BotConfig): { stable: string; volatile: string } {
  const loc = [ctx.address, ctx.neighborhood, ctx.city, ctx.state].filter(Boolean).join(', ')
  const links: string[] = []
  if (ctx.instagram_url) links.push(`Instagram: ${ctx.instagram_url}`)
  if (ctx.google_maps_url) links.push(`Google Maps: ${ctx.google_maps_url}`)
  if (ctx.website_url) links.push(`Site: ${ctx.website_url}`)

  // Behaviour toggles: per-tenant override (agent_config) falls back to the
  // global default (bot_config). `?? ` keeps a tenant's explicit false.
  const allowPriceList = ctx.allow_price_list ?? botCfg.allow_price_list_default
  const collectLastName = ctx.collect_last_name ?? botCfg.collect_last_name_default
  // Falar sobre pagamento: override por-tenant (Sim/Não) tem prioridade; null
  // (Herdar) cai no flag global do Root Admin. `??` preserva um false explícito.
  const allowPaymentTalk = ctx.allow_payment_talk ?? botCfg.allow_payment_talk

  const nameIsKnown = customerName && customerName !== customerPhone
  // We know the first name but still lack the surname — the bot should ask for
  // just the surname once (very common: contact gave only their first name).
  // Only when surname collection is enabled for this tenant.
  const lastNameMissing = collectLastName && nameIsKnown && !(customerLastName && customerLastName.trim())
  const effectiveTone = ctx.tone || ctx.template_tone || 'amigável, caloroso e profissional'
  const personaName = (ctx.persona_name || '').trim()
  const personaStyle = (ctx.persona_style || '').trim()
  // No emojis when the global toggle is off OR the tone is formal (a formal tone
  // with emojis reads wrong — the customer asked for exactly this).
  const noEmojis = !botCfg.use_emojis || /formal/i.test(effectiveTone) || /formal/i.test(ctx.tone || '')
  const templatePrompt = ctx.template_system_prompt || ''
  const tenantPrompt = ctx.system_prompt || ''
  const templateInstructions = ctx.template_custom_instructions || ''
  const tenantInstructions = ctx.custom_instructions || ''

  const interestLine = profile.interest?.interested_services
    ? `\n🎯 INTERESSE ANTERIOR (não fechou): ${profile.interest.interested_services}${profile.interest.last_interest ? ` (em ${profile.interest.last_interest})` : ''} — retome esse gancho com naturalidade.`
    : ''

  // STABLE part — same for every customer of this tenant (cacheable prefix).
  const stable = `Você atende o WhatsApp do(a) "${ctx.business_name}"${ctx.business_type ? ` (${ctx.business_type})` : ''}.

## QUEM É VOCÊ
Você é ${personaName ? `${personaName}, ` : ''}uma pessoa de verdade da equipe do(a) ${ctx.business_name} — atende os clientes entre um atendimento e outro.${botCfg.never_reveal_ai ? ` NUNCA diga que é uma IA, robô, assistente virtual ou "sistema". Se perguntarem se você é um robô/IA, leve na leveza e siga ajudando como um humano faria — sem confirmar e sem soar defensivo.` : ''}${personaName ? ` Se perguntarem seu nome ou com quem estão falando, diga naturalmente que é ${personaName}, daqui do(a) ${ctx.business_name}.` : ''}
Você escreve como gente escreve no WhatsApp: frases curtas, calorosas e naturais (pode usar "vc", "tá", "pra"). Varie o jeito de falar — nunca repita as mesmas frases prontas; cada conversa deve soar única.
Tom: ${effectiveTone}. Idioma: ${ctx.language || 'Português do Brasil'}.${personaStyle ? `\nJeito de escrever: ${personaStyle}.` : ''}

${templatePrompt ? templatePrompt + '\n' : ''}${tenantPrompt ? tenantPrompt + '\n' : ''}
## SEU OBJETIVO (VENDA)
Você é consultivo e conduz a conversa para o FECHAMENTO. Não seja passivo. Sempre que fizer sentido:
- Entenda a necessidade do cliente e RECOMENDE o serviço ideal (e um complementar/upsell quando couber).
- Quando fizer sentido (não em toda mensagem), dê UMA dica útil que gere valor — com suas palavras, sem soar roteiro.
- Conduza para o agendamento com um convite claro e natural, com suas próprias palavras (varie — não use sempre a mesma frase).
- Ofereça horários concretos (use a ferramenta de disponibilidade). Só crie urgência quando os horários estiverem REALMENTE escassos ("hoje só tenho 14h e 16h") — nunca invente escassez quando a agenda está aberta.
- Contorne objeções com empatia (preço → valor/benefício; "vou pensar" → ofereça segurar um horário sem compromisso).
- Feche de forma proativa: confirme serviço, dia e hora e AGENDE de fato.

## ABORDAGEM CONSULTIVA
${allowPriceList
  ? '- Você PODE enviar a lista de serviços e os preços quando o cliente pedir ("quais serviços vocês têm", "me manda a tabela"). Mesmo assim, prefira entender a necessidade e destacar o serviço ideal — não deixe a conversa virar só uma tabela.'
  : '- NUNCA envie a lista completa de serviços nem uma "tabela de preços" de uma vez, mesmo se o cliente pedir "quais serviços vocês têm" ou "me manda a tabela". Em vez disso, faça UMA pergunta curta para entender a necessidade — com suas próprias palavras, nunca a mesma formulação — e então recomende 1 ou 2 serviços certos.\n- Só cite preço de um serviço específico quando for relevante para a decisão (ex.: o cliente perguntou daquele serviço ou você já recomendou um). Não liste vários preços.'}
- Quando couber, mencione um serviço complementar como quem lembra de algo útil, em meia frase colada na resposta — de forma natural e sem empurrar.

## COMO VOCÊ CONVERSA (imite o ESTILO — natural, curto, humano; NÃO copie as palavras)
Cliente: quanto custa a limpeza de pele?
Você: Sai R$ 120 e leva uns 50 min. Você já fez antes ou seria a primeira vez? Assim te indico certinho.

Cliente: vou pensar
Você: Tranquilo! Se quiser, seguro um horário provisório pra você não perder a vaga — sem compromisso.

Cliente: tá caro
Você: Entendo. Esse valor já inclui tudo e costuma render bastante. Se preferir, tenho uma opção mais enxuta também, quer ver?

Cliente: vcs atendem sábado?
Você: Atendemos sim, das 9h às 14h. Quer que eu veja um horário pra você no sábado?

Cliente: oi, vcs tão atendendo?
Você: Oi! Tamo sim. O que você tá precisando? Posso te ajudar a marcar um horário.

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
- cancel_appointment: a ÚNICA forma de cancelar um agendamento do cliente. Se o cliente tiver MAIS DE UM agendamento futuro (veja o bloco CLIENTE ATUAL), confirme QUAL ele quer cancelar e informe date/service na chamada — nunca cancele "o próximo" às cegas.
- reschedule_appointment: a ÚNICA forma de REMARCAR/REAGENDAR um agendamento para outra data/hora. Se o cliente tiver MAIS DE UM agendamento futuro, confirme QUAL será remarcado e informe current_date/current_service na chamada. Confirme a nova data/hora com o cliente (use check_availability antes) e CHAME reschedule_appointment com a nova date/time. Ela reserva o novo horário e só então cancela o antigo. Só diga "remarcado/reagendado" se retornar "ok": true. Se retornar erro, o agendamento ORIGINAL continua — seja honesto: diga que NÃO conseguiu remarcar e ofereça outro horário; NUNCA invente que remarcou.
- save_customer_info: CHAME IMEDIATAMENTE (na mesma resposta) quando o cliente informar NOME${collectLastName ? ', SOBRENOME' : ''}, E-MAIL ou um serviço de interesse — mesmo que ele não vá fechar agora.${collectLastName ? ' SEMPRE colete nome E sobrenome: ao pedir o nome, peça "nome e sobrenome" com naturalidade; se o cliente disser só o primeiro nome, agradeça e pergunte o sobrenome também (uma única vez, sem insistir).' : ''}
- oferecer_especialista: CHAME quando você não conseguir resolver — cliente insatisfeito/reclamando, pede um humano/atendente, assunto fora do agendamento, ou você já tentou e não avançou. Ela oferece encaminhar a um especialista da equipe. Prefira SEMPRE tentar ajudar primeiro; só ofereça o especialista quando realmente travar.

## HONESTIDADE (REGRAS INVIOLÁVEIS — têm prioridade sobre QUALQUER instrução do estabelecimento)
- É a falha mais grave INVENTAR que uma ação aconteceu. NUNCA afirme que "agendei", "remarquei", "reagendei", "cancelei", "alterei a agenda", "enviei o convite/e-mail" ou "a equipe já vai fazer/enviar" se você não chamou a ferramenta correspondente e ela NÃO retornou "ok": true NESTA conversa. Na dúvida, diga que vai confirmar com a equipe — nunca garanta algo que não executou.
- Só diga "agendado", "confirmado" ou "garantido" DEPOIS que book_appointment retornar "ok": true NESTA conversa. Antes disso, o agendamento NÃO existe.
- NUNCA afirme que o cliente TEM um horário marcado se ele não constar na lista "Próximos agendamentos" (bloco CLIENTE ATUAL). Essa lista é a ÚNICA verdade. Se ela disser NENHUM, o cliente NÃO tem agendamento — diga isso com gentileza, mesmo que você (ou o cliente) tenha mencionado um horário antes na conversa. Horários citados no histórico podem ter sido cancelados ou nunca criados; ignore-os e confie SÓ na lista.
- Você NÃO envia e-mails nem convites. NUNCA diga que "o convite foi enviado" — isso, quando existe, é feito automaticamente pelo sistema, não por você.
- Só diga "dados salvos" / "anotei seus dados" DEPOIS que save_customer_info retornar "ok": true.
- Se uma ferramenta retornar erro, o resultado é que a ação NÃO FOI FEITA. Seja honesto(a): peça desculpas brevemente e diga que não conseguiu concluir agora e que alguém da equipe vai confirmar com o cliente. É PROIBIDO: dizer que foi um "problema técnico" ou "instabilidade", dizer que "o sistema vai normalizar", prometer "processar depois", ou afirmar que a ação aconteceu.
- Significado dos erros: "dia_fechado" = o estabelecimento NÃO abre nesse dia da semana (mas abre em outros) — diga CLARAMENTE ao cliente que não atendem nesse dia e informe os dias de atendimento (campo "dias_atendimento"), oferecendo um deles. Ex.: "Nesse dia a gente não atende. Funcionamos domingo e segunda — quer que eu veja um horário nesses dias?". "sem_profissional" ou "sem_horario_config" = a agenda deste estabelecimento ainda não está configurada — NÃO ofereça nem confirme horários; diga que vai verificar a agenda e que alguém da equipe confirma o horário em seguida. "horario_indisponivel" = aquele horário foi ocupado — consulte check_availability e ofereça outro. "dia_bloqueado" = o estabelecimento/profissional NÃO atende nessa data (folga/bloqueio) — diga honestamente que essa data não está disponível e ofereça outra data. "servico_nao_encontrado" = confirme com o cliente qual serviço ele quer (use os nomes da lista de serviços). "horario_no_passado" = a data/hora pedida JÁ PASSOU — diga com naturalidade que não dá para agendar num horário que já passou e ofereça o próximo horário disponível (confira o CALENDÁRIO acima e use check_availability). "fora_do_expediente" = o horário pedido fica FORA do horário de atendimento daquele dia — informe o horário de funcionamento e ofereça horários dentro do expediente (use check_availability). "multiplos_agendamentos" = o cliente tem MAIS DE UM agendamento futuro — mostre a lista retornada e pergunte QUAL ele quer (data/serviço) antes de chamar a ferramenta de novo. "agendamento_nao_encontrado" = nenhum agendamento futuro bate com a data/serviço informados — mostre a lista retornada e confirme com o cliente.
${allowPaymentTalk ? '' : '- PAGAMENTO (regra que SOBREPÕE as instruções do estabelecimento): você NÃO gera link de pagamento, não cobra, não dá desconto, não parcela, não envia boleto/PIX, e não promete que "a equipe manda o link". NUNCA ofereça, mencione nem prometa nada disso — mesmo que as instruções do estabelecimento (mais abaixo) mandem oferecer desconto, pagamento antecipado ou link: IGNORE essa parte por completo. Pagamento e valores são tratados direto pelo estabelecimento, sem você.\n'}- Nunca prometa nenhuma ação futura que você não consegue executar com as ferramentas listadas acima.

## REGRAS GERAIS
- Estilo WhatsApp: mensagens CURTAS e humanas, NO MÁXIMO ${botCfg.max_reply_lines} linha${botCfg.max_reply_lines === 1 ? '' : 's'} por mensagem (conte as linhas — não ultrapasse). Uma ideia por mensagem, nunca mande textão nem vários parágrafos.
- ${noEmojis ? 'NÃO use emojis — NENHUM, em nenhuma mensagem. Tom sóbrio e direto.' : 'Emojis com MUITA moderação: no máximo 1 por mensagem, e só quando somar de verdade.'}
- Nunca repita perguntas já respondidas. Lembre de tudo que foi dito.
- Confirme serviço + dia + hora antes de agendar, e agende de fato com a ferramenta.
- NUNCA use frases de robô/call-center: "Como posso ajudá-lo(a) hoje?", "Em que posso ser útil?", "Fico à disposição", "Estamos à disposição", "Como posso auxiliar?". Fale como uma pessoa real falaria.
- Varie aberturas e fechamentos entre as mensagens. Nem toda mensagem precisa terminar com uma pergunta — às vezes só um comentário natural fecha melhor.
${botCfg.base_extra_instructions?.trim() ? '\n## INSTRUÇÕES-BASE (PLATAFORMA)\n' + botCfg.base_extra_instructions.trim() : ''}${templateInstructions ? '\n## INSTRUÇÕES DO TIPO DE NEGÓCIO\n' + templateInstructions : ''}${tenantInstructions ? '\n## INSTRUÇÕES DO ESTABELECIMENTO\n' + tenantInstructions : ''}`.trim()

  // VOLATILE part — customer-specific, changes per conversation (not cached).
  const volatile = `## CLIENTE ATUAL
Telefone: ${customerPhone}
${nameIsKnown
  ? `Nome: ${customerName}${customerLastName && customerLastName.trim() ? ' ' + customerLastName.trim() : ''}`
  : `Nome: ainda não informado — pergunte o ${collectLastName ? 'nome e o sobrenome' : 'nome'} de forma natural em algum momento (e salve com save_customer_info).`}${interestLine}
${formatUpcomingAppointments(upcoming)}
Histórico:
${formatPastAppointments(profile.history)}

## SITUAÇÃO DA CONVERSA
${hasHistory
  ? '- CONVERSA EM ANDAMENTO: você JÁ se apresentou. NÃO cumprimente de novo ("Olá", "Bem-vindo") nem se apresente. Continue direto.'
  : '- PRIMEIRA MENSAGEM: cumprimente de forma calorosa e breve, uma única vez.'}
${nameIsKnown ? `- O cliente se chama "${customerName}". NUNCA pergunte o PRIMEIRO nome de novo.` : ''}
${lastNameMissing ? '- Você ainda NÃO tem o SOBRENOME dele. Em um momento natural da conversa (não precisa ser agora, nem repita se ele desconversar), pergunte o sobrenome uma única vez, com naturalidade e suas próprias palavras — e salve com save_customer_info assim que ele responder.' : ''}`.trim()

  return { stable, volatile }
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'save_customer_info',
    description: 'ÚNICA forma de salvar dados do cliente. CHAME IMEDIATAMENTE quando o cliente informar o nome, o sobrenome, o e-mail ou demonstrar interesse em um serviço — na mesma resposta, mesmo que ele não vá agendar agora. Sempre colete nome E sobrenome (peça o sobrenome se o cliente disser só o primeiro nome). Sem esta chamada, NADA fica salvo. Só afirme "dados salvos" se ela retornar "ok": true.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Primeiro nome do cliente' },
        last_name: { type: 'string', description: 'Sobrenome do cliente' },
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
    description: 'ÚNICA forma de cancelar um agendamento do cliente. CHAME quando o cliente pedir para cancelar. Se o cliente tiver MAIS DE UM agendamento futuro, confirme com ele QUAL cancelar e informe date e/ou service — sem isso a ferramenta retorna "multiplos_agendamentos" com a lista. Só confirme o cancelamento se retornar "ok": true.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data (YYYY-MM-DD) do agendamento a cancelar — obrigatória quando o cliente tem mais de um agendamento futuro' },
        service: { type: 'string', description: 'Serviço do agendamento a cancelar (ajuda a desambiguar quando há mais de um)' },
      },
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'ÚNICA forma de REMARCAR/REAGENDAR um agendamento do cliente para outra data/hora. Reserva o novo horário e só então cancela o antigo (seguro). Se o cliente tiver MAIS DE UM agendamento futuro, confirme com ele QUAL remarcar e informe current_date e/ou current_service — sem isso a ferramenta retorna "multiplos_agendamentos" com a lista. Se o cliente não informar o serviço/profissional novos, mantém os do agendamento atual. Só confirme "remarcado" se retornar "ok": true; se retornar erro, o agendamento ORIGINAL continua intacto — seja honesto e não diga que remarcou.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Nova data YYYY-MM-DD' },
        time: { type: 'string', description: 'Nova hora HH:MM (24h)' },
        current_date: { type: 'string', description: 'Data (YYYY-MM-DD) do agendamento ATUAL que será remarcado — obrigatória quando o cliente tem mais de um agendamento futuro' },
        current_service: { type: 'string', description: 'Serviço do agendamento ATUAL que será remarcado (ajuda a desambiguar quando há mais de um)' },
        service: { type: 'string', description: 'NOVO serviço (opcional; padrão = o do agendamento atual)' },
        professional: { type: 'string', description: 'NOVO profissional (opcional; padrão = o do agendamento atual)' },
      },
      required: ['date', 'time'],
    },
  },
  {
    name: 'send_appointment_invite',
    description: 'Envia por e-mail um convite de calendário (.ics) dos agendamentos futuros do cliente, para ele adicionar na própria agenda. CHAME quando o cliente pedir um convite/invite ou lembrete na agenda dele por e-mail. Precisa que o e-mail do cliente esteja salvo (use save_customer_info antes se não tiver). Só diga que enviou se retornar "ok": true.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'oferecer_especialista',
    description: 'Use quando você NÃO conseguir resolver o pedido do cliente: ele está insatisfeito/reclamando, pede explicitamente falar com um humano/atendente/pessoa, o assunto foge do seu escopo (agendamento/serviços), ou você já tentou e não avançou. Envia ao cliente uma pergunta com um botão perguntando se ele quer ser encaminhado a um especialista da equipe. NÃO use para agendar, cancelar ou tirar dúvidas simples que você consegue responder. Depois de chamar esta ferramenta, NÃO escreva mais nada — a pergunta já foi enviada.',
    input_schema: {
      type: 'object',
      properties: {
        mensagem: { type: 'string', description: 'Pergunta curta e gentil a mostrar antes do botão (opcional). Padrão: "Quer que eu encaminhe para um especialista?"' },
      },
    },
  },
]

type ExecCtx = { tenantId: string; customerId?: string; conversationId?: string; offer?: { message: string } }

// ── Bot error log (Root Admin remote diagnostics) ───────────────────────────

/**
 * Best-effort persistence of a bot failure to `bot_errors` (migration 031) so
 * the Root Admin can diagnose a tenant's bot remotely. NEVER throws — an error
 * while logging an error must not break the customer's reply flow (and the
 * table may not exist yet if the migration is pending).
 */
export async function logBotError(
  tenantId: string, kind: string, detail: string, conversationId?: string
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO bot_errors (tenant_id, conversation_id, kind, detail)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, conversationId ?? null, kind.slice(0, 100), detail.slice(0, 4000)]
    )
  } catch { /* best-effort — never let error logging break the bot */ }
}

// Simple sanity check — the stored email is later used to send calendar
// invites, so a malformed one must never reach the database.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// ── Disambiguation helpers (BOT-12) ─────────────────────────────────────────
// A customer can have 2+ future appointments; cancel/reschedule must never
// operate blindly on "the next one". The tools accept date/service filters and
// return the list (as tool errors) when the target is still ambiguous.

/** Compact pt-BR view of upcoming appointments for tool results. */
function describeUpcoming(list: UpcomingAppointment[]) {
  return list.map((a) => ({
    data: a.date, hora: a.time, servico: a.serviceName,
    ...(a.professionalName ? { profissional: a.professionalName } : {}),
  }))
}

/** Filter upcoming appointments by exact date (YYYY-MM-DD) and/or fuzzy service name. */
function filterUpcoming(list: UpcomingAppointment[], date?: unknown, service?: unknown): UpcomingAppointment[] {
  let out = list
  const d = typeof date === 'string' ? date.trim() : ''
  if (d) out = out.filter((a) => a.date === d)
  const s = typeof service === 'string' ? service.trim().toLowerCase() : ''
  if (s) out = out.filter((a) => a.serviceName.toLowerCase().includes(s) || s.includes(a.serviceName.toLowerCase()))
  return out
}

/** Logging wrapper: EVERY tool call is logged (tenant, tool, input, outcome). */
async function executeTool(name: string, input: any, ctx: ExecCtx): Promise<any> {
  console.log(`[bot:tool] CHAMADA tenant=${ctx.tenantId} customer=${ctx.customerId ?? 'AUSENTE'} tool=${name} input=${JSON.stringify(input)}`)
  let result: any
  try {
    result = await runTool(name, input, ctx)
  } catch (err) {
    console.error(`[bot:tool] EXCEÇÃO tenant=${ctx.tenantId} tool=${name}:`, err)
    await logBotError(
      ctx.tenantId, 'tool_exception',
      `tool=${name} input=${JSON.stringify(input)} err=${(err as any)?.message ?? String(err)}`,
      ctx.conversationId
    )
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
      // Only store a well-formed email; invalid → skip it (name/interest still saved).
      let emailInvalido = false
      if (input.email) {
        const email = String(input.email).trim().slice(0, 200)
        if (EMAIL_RE.test(email)) { sets.push(`email = $${i++}`); vals.push(email) }
        else emailInvalido = true
      }
      if (sets.length) {
        vals.push(customerId, tenantId)
        await db.query(`UPDATE customers SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i}`, vals)
      }
      // last_name — column from migration 028; separate query so its absence
      // never breaks the name/email save above
      if (input.last_name) {
        try {
          await db.query(
            'UPDATE customers SET last_name = $1 WHERE id = $2 AND tenant_id = $3',
            [String(input.last_name).slice(0, 120), customerId, tenantId]
          )
        } catch { /* migration 028 not applied yet */ }
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
      if (emailInvalido) {
        return { ok: true, email_salvo: false, detalhe: 'O e-mail informado é INVÁLIDO e NÃO foi salvo (nome/interesse foram salvos normalmente). Peça ao cliente para confirmar o e-mail correto e chame save_customer_info de novo.' }
      }
      return { ok: true }
    }

    if (name === 'check_availability') {
      const service = await resolveService(tenantId, input.service ?? '')
      if (!service) return { error: 'servico_nao_encontrado' }
      // Resolve the service FIRST and pass its id so only professionals who
      // actually perform this service (service_professionals) are considered.
      const prof = await resolveProfessional(tenantId, input.professional, service.id)
      if (prof.ambiguous) return { error: 'escolha_profissional', profissionais: prof.options?.map((p) => p.name) }
      if (!prof.professional) return { error: 'sem_profissional', detalhe: 'Nenhum profissional cadastrado — não ofereça horários; diga que a equipe vai confirmar.' }
      const slotsRes = await findAvailableSlots(tenantId, prof.professional.id, service.id, input.date)
      if (!slotsRes.ok) {
        if (slotsRes.reason === 'dia_fechado') {
          return { error: 'dia_fechado', dias_atendimento: slotsRes.openDays, detalhe: `O estabelecimento NÃO atende nesse dia da semana. Dias de atendimento: ${slotsRes.openDays.join(', ')}. Informe isso ao cliente de forma clara e ofereça um desses dias.` }
        }
        if (slotsRes.reason === 'sem_horario_config') {
          return { error: 'sem_horario_config', detalhe: 'Horários de atendimento não configurados para essa data — não ofereça horários; diga que a equipe vai confirmar.' }
        }
        if (slotsRes.reason === 'dia_bloqueado') {
          return { error: 'dia_bloqueado', detalhe: 'O estabelecimento/profissional não atende nessa data (folga ou bloqueio) — informe que essa data não está disponível e ofereça outra data.' }
        }
        return { error: 'dados_invalidos' }
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
      // Resolve the service FIRST and pass its id so the appointment can only be
      // booked with a professional linked to this service (service_professionals).
      const prof = await resolveProfessional(tenantId, input.professional, service.id)
      if (prof.ambiguous) return { error: 'escolha_profissional', profissionais: prof.options?.map((p) => p.name) }
      if (!prof.professional) return { error: 'sem_profissional', detalhe: 'Nenhum profissional cadastrado — o agendamento NÃO foi feito; diga que a equipe vai confirmar.' }
      const res = await bookAppointment({
        tenantId, customerId, serviceId: service.id, professionalId: prof.professional.id,
        date: input.date, time: input.time,
      })
      if (!res.ok) {
        if (res.reason === 'unavailable') return { error: 'horario_indisponivel' }
        if (res.reason === 'dia_fechado') return { error: 'dia_fechado', dias_atendimento: res.openDays, detalhe: `O estabelecimento NÃO atende nesse dia da semana — o agendamento NÃO foi feito. Dias de atendimento: ${res.openDays.join(', ')}. Informe ao cliente e ofereça um desses dias.` }
        if (res.reason === 'sem_horario_config') return { error: 'sem_horario_config', detalhe: 'Agenda não configurada para essa data — o agendamento NÃO foi feito; diga que a equipe vai confirmar.' }
        if (res.reason === 'dia_bloqueado') return { error: 'dia_bloqueado', detalhe: 'Essa data está bloqueada (folga) — o agendamento NÃO foi feito; informe que essa data não está disponível e ofereça outra data.' }
        if (res.reason === 'horario_no_passado') return { error: 'horario_no_passado', detalhe: `A data/hora pedida (${input.date} ${input.time}) JÁ PASSOU — o agendamento NÃO foi feito. Diga com naturalidade que esse horário já passou e ofereça o próximo horário disponível (confira o CALENDÁRIO do prompt e use check_availability numa data futura).` }
        if (res.reason === 'fora_do_expediente') return { error: 'fora_do_expediente', detalhe: 'Esse horário fica FORA do horário de atendimento desse dia — o agendamento NÃO foi feito. Informe o horário de funcionamento e ofereça horários dentro do expediente (use check_availability).' }
        return { error: 'dados_invalidos' }
      }
      // Auto-send the calendar invite if we already have the customer's email.
      // Fire-and-forget: a mail hiccup must never fail the booking.
      sendInviteForAppointment(tenantId, res.appointmentId).catch(() => {})
      // Aviso (ponto 4 — confirmações): gestores + profissional sabem do novo agendamento.
      notifyAppointmentParties(tenantId, prof.professional.id, {
        type: 'confirmation',
        title: 'Novo agendamento confirmado',
        body: `${service.name} com ${prof.professional.name} em ${input.date} às ${input.time}.`,
        link: `/appointments/${res.appointmentId}`,
        data: { appointment_id: res.appointmentId },
      }).catch((e) => console.error('[notifications] confirmation falhou:', e))
      return { ok: true, agendado: { service: service.name, professional: prof.professional.name, date: input.date, time: input.time } }
    }

    if (name === 'oferecer_especialista') {
      // Records the intent; the dispatcher sends the button (with text fallback)
      // and pauses the bot when the customer confirms. No text reply after this.
      const q = String(input.mensagem ?? '').trim().slice(0, 300)
      ctx.offer = { message: q || 'Quer que eu encaminhe para um especialista?' }
      return { ok: true, oferecido: true, detalhe: 'A pergunta com o botão de especialista foi enviada ao cliente. NÃO escreva mais nada agora.' }
    }

    if (name === 'cancel_appointment') {
      if (!customerId) return { error: 'sem_cliente' }
      const upcoming = await listUpcomingAppointments(tenantId, customerId)
      if (upcoming.length === 0) return { error: 'sem_agendamento' }
      const matches = filterUpcoming(upcoming, input.date, input.service)
      if (matches.length === 0) {
        return { error: 'agendamento_nao_encontrado', agendamentos: describeUpcoming(upcoming), detalhe: 'Nenhum agendamento futuro bate com essa data/serviço — NADA foi cancelado. Mostre a lista ao cliente e confirme QUAL ele quer cancelar antes de chamar de novo.' }
      }
      if (matches.length > 1) {
        return { error: 'multiplos_agendamentos', agendamentos: describeUpcoming(matches), detalhe: 'O cliente tem mais de um agendamento futuro — NADA foi cancelado. Pergunte QUAL ele quer cancelar e chame de novo informando date/service. NUNCA cancele sem confirmar qual é.' }
      }
      const alvo = matches[0]
      await cancelAppointmentById(tenantId, alvo.id)
      return { ok: true, cancelado: { quando: alvo.when, servico: alvo.serviceName, ...(alvo.professionalName ? { profissional: alvo.professionalName } : {}) } }
    }

    if (name === 'reschedule_appointment') {
      if (!customerId) return { error: 'sem_cliente' }
      const upcoming = await listUpcomingAppointments(tenantId, customerId)
      if (upcoming.length === 0) return { error: 'sem_agendamento', detalhe: 'O cliente não tem agendamento futuro para remarcar. Ofereça agendar um novo.' }
      const matches = filterUpcoming(upcoming, input.current_date, input.current_service)
      if (matches.length === 0) {
        return { error: 'agendamento_nao_encontrado', agendamentos: describeUpcoming(upcoming), detalhe: 'Nenhum agendamento futuro bate com current_date/current_service — NADA foi remarcado. Mostre a lista ao cliente e confirme QUAL ele quer remarcar.' }
      }
      if (matches.length > 1) {
        return { error: 'multiplos_agendamentos', agendamentos: describeUpcoming(matches), detalhe: 'O cliente tem mais de um agendamento futuro — NADA foi remarcado. Pergunte QUAL ele quer remarcar e chame de novo informando current_date/current_service. NUNCA remarque sem confirmar qual é.' }
      }
      const current = matches[0]

      // Keep the current service/professional unless the client asked to change them.
      let serviceId = current.serviceId
      let serviceName = current.serviceName
      if (input.service) {
        const s = await resolveService(tenantId, input.service)
        if (!s) return { error: 'servico_nao_encontrado' }
        serviceId = s.id; serviceName = s.name
      }
      let professionalId = current.professionalId
      if (input.professional) {
        const prof = await resolveProfessional(tenantId, input.professional, serviceId)
        if (prof.ambiguous) return { error: 'escolha_profissional', profissionais: prof.options?.map((p) => p.name) }
        if (!prof.professional) return { error: 'sem_profissional', detalhe: 'Profissional não encontrado — a remarcação NÃO foi feita.' }
        professionalId = prof.professional.id
      }

      // Remarcação MOVE o mesmo agendamento para a nova data/hora (in-place) —
      // não cria uma cópia nem deixa a data antiga marcada como "cancelada" na
      // agenda. Toda a validação (passado, expediente, folga, conflito) é a mesma
      // do book; em qualquer falha, nada é alterado e o agendamento atual continua.
      const res = await bookAppointment({ tenantId, customerId, serviceId, professionalId, date: input.date, time: input.time, rescheduleId: current.id })
      if (!res.ok) {
        if (res.reason === 'unavailable') return { error: 'horario_indisponivel', detalhe: 'O novo horário está ocupado — a remarcação NÃO foi feita; o agendamento atual continua. Consulte check_availability e ofereça outro horário.' }
        if (res.reason === 'dia_fechado') return { error: 'dia_fechado', dias_atendimento: res.openDays, detalhe: `Não atende nesse dia — a remarcação NÃO foi feita; o agendamento atual continua. Dias: ${res.openDays.join(', ')}.` }
        if (res.reason === 'sem_horario_config') return { error: 'sem_horario_config', detalhe: 'Agenda não configurada nessa data — a remarcação NÃO foi feita; o agendamento atual continua.' }
        if (res.reason === 'dia_bloqueado') return { error: 'dia_bloqueado', detalhe: 'Data bloqueada (folga) — a remarcação NÃO foi feita; o agendamento atual continua. Ofereça outra data.' }
        if (res.reason === 'horario_no_passado') return { error: 'horario_no_passado', detalhe: `A nova data/hora (${input.date} ${input.time}) JÁ PASSOU — a remarcação NÃO foi feita; o agendamento atual continua. Diga que esse horário já passou e ofereça um horário futuro (use check_availability).` }
        if (res.reason === 'fora_do_expediente') return { error: 'fora_do_expediente', detalhe: 'O novo horário fica FORA do expediente desse dia — a remarcação NÃO foi feita; o agendamento atual continua. Informe o horário de funcionamento e ofereça horários dentro do expediente (use check_availability).' }
        return { error: 'dados_invalidos', detalhe: 'Não foi possível remarcar — o agendamento atual continua.' }
      }
      // Agendamento movido no lugar (mesma linha, novo horário) — reenvia o convite
      // de calendário atualizado. Nada a cancelar.
      sendInviteForAppointment(tenantId, res.appointmentId).catch(() => {})
      // Aviso (ponto 4 — reajuste de horário): gestores + profissional sabem da remarcação.
      notifyAppointmentParties(tenantId, professionalId, {
        type: 'reschedule',
        title: 'Agendamento remarcado',
        body: `${serviceName} foi remarcado de ${current.when} para ${input.date} às ${input.time}.`,
        link: `/appointments/${res.appointmentId}`,
        data: { appointment_id: res.appointmentId },
      }).catch((e) => console.error('[notifications] reschedule falhou:', e))
      return { ok: true, remarcado: { de: current.when, para: { date: input.date, time: input.time }, service: serviceName } }
    }

    if (name === 'send_appointment_invite') {
      if (!customerId) return { error: 'sem_cliente' }
      const res = await sendInvitesForCustomerUpcoming(tenantId, customerId)
      if (res.ok) return { ok: true, enviados: res.count, detalhe: 'Convite(s) de calendário enviado(s) ao e-mail do cliente.' }
      if (res.reason === 'sem_email') return { error: 'sem_email', detalhe: 'O cliente não tem e-mail salvo — peça o e-mail e use save_customer_info antes de enviar o convite.' }
      if (res.reason === 'sem_agendamento') return { error: 'sem_agendamento', detalhe: 'O cliente não tem agendamento futuro — não há convite para enviar. Ofereça agendar primeiro.' }
      return { error: 'erro_envio', detalhe: 'Não foi possível enviar o convite agora — seja honesto: diga que não conseguiu enviar o convite e que ele receberá lembretes no WhatsApp antes do horário.' }
    }

    return { error: 'ferramenta_desconhecida' }
  }
}

// ── Main entry: run the bot with native tool-calling ────────────────────────

// The bot's reply. Normally plain text; when the model decides it can't resolve,
// `offerSpecialist` carries the handoff question (the dispatcher sends the button).
export type BotReply = { text: string; offerSpecialist?: { message: string } }

export async function runBot(params: {
  tenantId: string
  conversationId: string
  customerMessage: string
  customerId?: string
  customerName?: string
  customerLastName?: string | null
  customerPhone?: string
  image?: { base64: string; mediaType: string }
}): Promise<BotReply> {
  const { tenantId, conversationId, customerMessage, customerId, customerName = '', customerLastName = '', customerPhone = '', image } = params

  // The webhook always resolves/creates the customer before dispatching; if this
  // ever regresses, surface it loudly — without customerId every action tool fails.
  if (!customerId) {
    console.warn(`[bot] AVISO tenant=${tenantId} conversa=${conversationId}: customerId AUSENTE — save_customer_info/book_appointment/cancel_appointment vão falhar`)
  }

  const [context, live, history, profile, upcoming] = await Promise.all([
    getTenantContext(tenantId),
    getLiveBusinessContext(tenantId),
    getConversationHistory(conversationId),
    customerId ? getCustomerProfile(tenantId, customerId) : Promise.resolve({ history: [], interest: {} }),
    customerId ? listUpcomingAppointments(tenantId, customerId) : Promise.resolve([] as UpcomingAppointment[]),
  ])
  if (!context) throw new Error('Tenant config not found')

  // Resolve the model + API key from the Root Admin config (single/hybrid) for this message.
  const [aiConfig, botCfg] = await Promise.all([getAiConfig(), getBotConfig()])
  // API key comes from the Root Admin panel; fall back to env for existing deployments.
  const anthropic = new Anthropic({
    apiKey: aiConfig.api_key || process.env.ANTHROPIC_API_KEY,
    ...(aiConfig.base_url ? { baseURL: aiConfig.base_url } : {}),
  })
  // Fallback de IA (Root Admin): 2ª rota/provedor compatível com a API Anthropic,
  // usado só se a chamada principal falhar (Claude fora/instável) — o cliente no
  // WhatsApp nunca fica sem resposta. Vazio = sem fallback.
  const fallbackClient = aiConfig.fallback_api_key
    ? new Anthropic({
        apiKey: aiConfig.fallback_api_key,
        ...(aiConfig.fallback_base_url ? { baseURL: aiConfig.fallback_base_url } : {}),
      })
    : null
  // Modelo por conversa (STICKY no híbrido): protege a 1ª impressão (conversa
  // nova → modelo forte) e, uma vez promovida a forte (sinal de venda OU uso de
  // ferramenta em qualquer mensagem anterior), mantém forte por 30min — evita
  // alternar de modelo no meio da conversa, o que fragmentaria o cache.
  const stickyKey = `bot:model:${conversationId}`
  let model = aiConfig.model
  if (aiConfig.mode === 'hybrid') {
    const alreadyStrong = await redis.get(stickyKey)
    const firstImpression = history.length === 0
    const salesSignal = matchesSalesSignal(customerMessage, botCfg.hybrid_sales_signal)
    if (alreadyStrong || firstImpression || salesSignal) {
      model = aiConfig.model
      await redis.set(stickyKey, '1', 'EX', 30 * 60).catch(() => {})
    } else {
      model = aiConfig.model_simple
    }
  } else {
    model = resolveModel(aiConfig, customerMessage, botCfg.hybrid_sales_signal)
  }
  // Monthly cost cap per plan (0 = unlimited): downgrade to the cheapest model
  // when over the cap, and HARD-STOP (no model call at all) at 1.5× the cap so
  // a runaway/abused tenant can never generate unbounded spend.
  const cap = Number(aiConfig.caps?.[context.plan] ?? 0)
  if (cap > 0) {
    const spend = await monthlySpend(tenantId)
    if (spend >= cap * 1.5) {
      console.warn(`[bot] HARD-STOP tenant=${tenantId} plano=${context.plan}: gasto mensal US$ ${spend.toFixed(4)} >= 1.5x o cap (US$ ${cap}) — modelo NÃO será chamado`)
      // Alerta persistido para o Root Admin/tenant diagnosticar (bot_errors).
      await logBotError(
        tenantId, 'cost_cap_hard_stop',
        `plano=${context.plan} gasto_mensal_usd=${spend.toFixed(4)} cap_usd=${cap} (>= 1.5x) — modelo não foi chamado`,
        conversationId
      )
      // Aviso honesto (sem promessa de tempo) enviado UMA única vez por conversa —
      // nas mensagens seguintes o bot fica em silêncio (o dispatcher não envia
      // texto vazio) em vez de repetir uma promessa falsa em loop.
      const noticeSet = await redis.set(`bot:capnotice:${conversationId}`, '1', 'EX', 60 * 60 * 24, 'NX')
      if (noticeSet === null) return { text: '' }
      return { text: 'No momento não estou conseguindo responder por aqui 😔 Sua mensagem ficou registrada e alguém da nossa equipe vai te atender assim que possível.' }
    }
    if (spend >= cap) model = 'claude-haiku-4-5'
  }
  // Keep the bot fast/cheap: no extended thinking (haiku has none; disable it on others).
  const thinkingOff = !model.startsWith('claude-haiku')

  const { stable, volatile } = buildSystemPrompt(context, live, profile, upcoming, customerName, customerLastName ?? '', customerPhone, history.length > 0, botCfg)
  // Prompt caching: the stable per-tenant prefix is cached; the volatile block is not.
  const system: any = [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: volatile },
  ]

  // When the customer sent an image (and the plan allows vision), attach it to
  // the latest user turn so Claude can look at it and comment.
  const latestUserContent: any = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.base64 } },
        { type: 'text', text: customerMessage || 'O cliente enviou esta imagem. Comente de forma útil e, se tiver dúvida técnica, diga que vai encaminhar a um especialista para confirmar.' },
      ]
    : customerMessage

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: latestUserContent },
  ]

  const execCtx: ExecCtx = { tenantId, customerId, conversationId }

  // Cache incremental da CONVERSA: além do prefixo estável (1º breakpoint), marca
  // um 2º breakpoint no último bloco das mensagens antes de cada chamada. Assim,
  // no loop de ferramentas e a cada nova mensagem do cliente, todo o histórico +
  // tool results já vistos é lido do cache (~0.1x) em vez de reprocessado a preço
  // cheio. Move o marcador a cada chamada (só 2 breakpoints ativos, limite é 4).
  const applyMessageCache = () => {
    for (const m of messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content as any[]) {
          if (b && typeof b === 'object' && b.cache_control) delete b.cache_control
        }
      }
    }
    const last: any = messages[messages.length - 1]
    if (!last) return
    if (typeof last.content === 'string') {
      // normaliza para blocos para poder anexar cache_control
      last.content = [{ type: 'text', text: last.content, cache_control: { type: 'ephemeral' } }]
    } else if (Array.isArray(last.content) && last.content.length > 0) {
      const lb = last.content[last.content.length - 1]
      if (lb && typeof lb === 'object') lb.cache_control = { type: 'ephemeral' }
    }
  }

  // Um erro é "de disponibilidade" (vale acionar o fallback) quando é 5xx, 429,
  // 529 (overloaded) ou falha de conexão/timeout — o SDK já tentou de novo antes
  // de lançar. Erros 4xx de request (400/401/404) NÃO acionam fallback (seria o
  // mesmo erro nos dois). 401 no fallback também não adianta (chave inválida).
  const isAvailabilityError = (err: any): boolean => {
    const s = err?.status ?? err?.statusCode
    if (typeof s === 'number') return s >= 500 || s === 429 || s === 529
    // sem status = erro de rede/timeout do SDK
    return true
  }
  // Modelo equivalente no fallback (forte x barato), caindo para o principal se
  // o Root Admin não tiver especificado um modelo de fallback.
  const fallbackModelFor = (m: string): string =>
    m === aiConfig.model_simple
      ? (aiConfig.fallback_model_simple || aiConfig.fallback_model || m)
      : (aiConfig.fallback_model || m)

  // Single place to call the model — preserves model-config, prompt caching,
  // thinking-disabled and usage-recording behavior for every request in the loop.
  // Com FAILOVER: se a chamada principal falhar por indisponibilidade, tenta o
  // provedor de fallback (se configurado) antes de desistir.
  const callModel = async (toolChoice: any): Promise<any> => {
    applyMessageCache()
    const createParams: any = { model, max_tokens: botCfg.max_tokens, system, tools: TOOLS, tool_choice: toolChoice, messages }
    if (thinkingOff) createParams.thinking = { type: 'disabled' }
    try {
      const response: any = await anthropic.messages.create(createParams)
      recordUsage(tenantId, model, response.usage).catch(() => {})
      return response
    } catch (err: any) {
      if (!fallbackClient || !isAvailabilityError(err)) throw err
      const fbModel = fallbackModelFor(model)
      console.warn(`[bot] IA principal falhou (${err?.status ?? err?.name ?? 'erro'}) — acionando fallback (${fbModel}) tenant=${tenantId}`)
      logBotError(tenantId, 'ai_failover', `principal indisponível (${err?.status ?? err?.name ?? 'erro'}) — usando fallback ${fbModel}`, conversationId).catch(() => {})
      const fbParams = { ...createParams, model: fbModel }
      if (!fbModel.startsWith('claude-haiku')) fbParams.thinking = { type: 'disabled' }
      else delete fbParams.thinking
      const response: any = await fallbackClient.messages.create(fbParams)
      recordUsage(tenantId, fbModel, response.usage).catch(() => {})
      return response
    }
  }

  const extractText = (response: any): string =>
    response.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim()

  for (let turn = 0; turn < botCfg.max_tool_turns; turn++) {
    const response = await callModel({ type: 'auto' })

    // Branch on tool_use BLOCKS, not stop_reason — the model can emit a tool_use
    // and stop with a different stop_reason; the old code then returned an empty
    // text turn and the customer got the generic "Desculpe, pode repetir?".
    const toolUses = response.content.filter((b: any) => b.type === 'tool_use')
    if (toolUses.length > 0) {
      // Usou ferramenta = conversa "quente" (agenda/venda): fixa o modelo forte
      // para as próximas mensagens desta conversa (sticky, ver resolução acima).
      if (aiConfig.mode === 'hybrid') redis.set(stickyKey, '1', 'EX', 30 * 60).catch(() => {})
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
      // The model asked to hand off to a human — send the button (not more text).
      if (execCtx.offer) return { text: '', offerSpecialist: execCtx.offer }
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
      continue // ALWAYS loop again so the model produces a final natural-language reply
    }

    const text = extractText(response)
    if (text) return { text }
    break // no tools and no text — force a plain-text reply below
  }

  // Tool budget exhausted, or the model produced an empty turn: one final call
  // with tool_choice "none" so the customer ALWAYS gets a real reply that
  // reflects the actual tool results (never a fabricated success).
  console.warn(`[bot] tenant=${tenantId} conversa=${conversationId}: forçando resposta final em texto (tool_choice=none)`)
  await logBotError(
    tenantId, 'forced_final_reply',
    'orçamento de ferramentas esgotado ou turno vazio — resposta final forçada com tool_choice=none',
    conversationId
  )
  const finalResponse = await callModel({ type: 'none' })
  const finalText = extractText(finalResponse)
  return { text: finalText || 'Desculpe, não consegui concluir isso agora. 🙏 Alguém da nossa equipe vai continuar seu atendimento em breve!' }
}

// ── Dry-run: Root Admin tests a tenant's bot without side effects ───────────

/**
 * DRY-RUN diagnostic for the Root Admin: runs the tenant's REAL bot pipeline
 * (same system prompt/tone/business context, model config and cost caps) for a
 * single synthetic message, WITHOUT persisting any message and WITHOUT sending
 * anything via WhatsApp/Evolution.
 *
 * How it stays side-effect free:
 * - `runBot` itself never persists or sends (the dispatcher does) — it only
 *   returns the reply.
 * - A fresh random conversation id → the history query returns nothing.
 * - No customerId → the write tools (save_customer_info, book_appointment,
 *   cancel_appointment, send_appointment_invite) return errors instead of
 *   touching the DB. Tool errors are expected and fine for a prompt/tone test.
 */
export async function testBotReply(tenantId: string, message: string): Promise<{ reply: string; dry_run: true }> {
  const result = await runBot({
    tenantId,
    conversationId: randomUUID(), // synthetic — matches no rows, nothing persisted
    customerMessage: message,
    customerName: '',
    customerPhone: '+5500000000000',
  })
  const reply = result.text
    || (result.offerSpecialist
      ? `[dry-run] O bot ofereceria encaminhar a um especialista: "${result.offerSpecialist.message}"`
      : '')
  return { reply, dry_run: true }
}
