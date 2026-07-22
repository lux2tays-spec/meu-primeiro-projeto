import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { redis } from '../lib/redis'
import { answerSupport } from '../lib/supportAssistant'
import { getAiConfig } from '../lib/botConfig'
import { monthlySpend } from '../lib/aiUsage'

// In-app support for tenant owners/staff: AI product-help assistant + tickets
// answered by the platform team (Root Admin). Always scoped by tenant_id from JWT.
//
// NO planGuard here: support is the billing/reactivation channel — a suspended
// or expired tenant MUST still be able to ask for help and open tickets.
// Abuse is contained by a per-tenant+user rate limit and the AI cost cap below.

const ASK_RATE_LIMIT = 20        // questions per tenant+user
const ASK_RATE_WINDOW = 60 * 60  // per hour

const askSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) }))
    .max(20)
    .optional(),
})

const createTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(8000),
  priority: z.enum(['normal', 'high']).optional(),
})

const appendMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000),
})

export const supportRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // AI assistant: answer a product-help question (and maybe suggest a ticket)
  app.post('/ask', async (request, reply) => {
    const { tenant_id, user_id } = request.user
    const { message, history } = askSchema.parse(request.body)

    // Per-tenant+user rate limit (Redis INCR) — support has no planGuard, so it
    // needs its own abuse ceiling.
    const rlKey = `support:rl:${tenant_id}:${user_id}`
    const count = await redis.incr(rlKey)
    if (count === 1) await redis.expire(rlKey, ASK_RATE_WINDOW)
    if (count > ASK_RATE_LIMIT) {
      return reply.status(429).send({
        error: 'Você fez muitas perguntas em pouco tempo 😊 Aguarde um pouco e tente novamente — ou abra um chamado que a equipe responde.',
      })
    }

    // Cost cap (same pattern as bot.ts): when the tenant's monthly AI spend is
    // over the plan cap, answer without calling the model.
    try {
      const aiConfig = await getAiConfig()
      const { rows: [tenant] } = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenant_id])
      const cap = Number(aiConfig.caps?.[tenant?.plan] ?? 0)
      if (cap > 0 && (await monthlySpend(tenant_id!)) >= cap) {
        return reply.send({
          reply: 'Nosso assistente automático está indisponível para sua conta neste momento 😊 Abra um chamado que a equipe de suporte te responde pessoalmente.',
          suggest_ticket: true,
        })
      }
    } catch (err) {
      request.log.warn({ err }, 'support/ask: verificação de custo falhou — seguindo mesmo assim')
    }

    const answer = await answerSupport(tenant_id!, message, history ?? [])
    return reply.send({ reply: answer.reply, suggest_ticket: answer.suggestTicket })
  })

  // List the tenant's tickets (with a preview of the latest message)
  app.get('/tickets', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows } = await db.query(
      `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at,
              LEFT((SELECT m.body FROM support_messages m
                    WHERE m.ticket_id = t.id
                    ORDER BY m.created_at DESC LIMIT 1), 200) AS last_message
       FROM support_tickets t
       WHERE t.tenant_id = $1
       ORDER BY t.updated_at DESC`,
      [tenant_id]
    )
    return reply.send(rows)
  })

  // Open a ticket (status 'open') with its first message
  app.post('/tickets', async (request, reply) => {
    const { tenant_id, user_id } = request.user
    const { subject, message, priority } = createTicketSchema.parse(request.body)

    const { rows: [ticket] } = await db.query(
      `INSERT INTO support_tickets (tenant_id, user_id, subject, status, priority)
       VALUES ($1, $2, $3, 'open', $4)
       RETURNING id, subject, status, priority, created_at, updated_at`,
      [tenant_id, user_id, subject, priority ?? 'normal']
    )
    await db.query(
      `INSERT INTO support_messages (ticket_id, sender, user_id, body)
       VALUES ($1, 'user', $2, $3)`,
      [ticket.id, user_id, message]
    )
    return reply.status(201).send(ticket)
  })

  // Ticket detail + full thread (scoped to tenant — 404 if not ours)
  app.get<{ Params: { id: string } }>('/tickets/:id', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [ticket] } = await db.query(
      `SELECT id, subject, status, priority, created_at, updated_at
       FROM support_tickets WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, tenant_id]
    )
    if (!ticket) return reply.status(404).send({ error: 'Chamado não encontrado' })

    const { rows: messages } = await db.query(
      `SELECT id, sender, body, created_at
       FROM support_messages WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [ticket.id]
    )
    return reply.send({ ...ticket, messages })
  })

  // Append a user message; a resolved ticket reopens automatically
  app.post<{ Params: { id: string } }>('/tickets/:id/messages', async (request, reply) => {
    const { tenant_id, user_id } = request.user
    const { body } = appendMessageSchema.parse(request.body)

    const { rows: [ticket] } = await db.query(
      `UPDATE support_tickets
       SET status = 'open', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, subject, status, priority, created_at, updated_at`,
      [request.params.id, tenant_id]
    )
    if (!ticket) return reply.status(404).send({ error: 'Chamado não encontrado' })

    const { rows: [message] } = await db.query(
      `INSERT INTO support_messages (ticket_id, sender, user_id, body)
       VALUES ($1, 'user', $2, $3)
       RETURNING id, sender, body, created_at`,
      [ticket.id, user_id, body]
    )
    return reply.status(201).send({ ticket, message })
  })
}
