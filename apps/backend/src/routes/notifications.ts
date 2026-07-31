import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { getNotificationPrefs } from '../lib/notifications'
import { getPushConfig } from '../lib/pushConfig'

const prefsSchema = z.object({
  channel_inapp: z.boolean().optional(),
  channel_push: z.boolean().optional(),
  channel_email: z.boolean().optional(),
  channel_whatsapp: z.boolean().optional(),
  evt_appointment_reminder: z.boolean().optional(),
  evt_new_customer: z.boolean().optional(),
  evt_reschedule: z.boolean().optional(),
  evt_confirmation: z.boolean().optional(),
  evt_service_completion: z.boolean().optional(),
  evt_broadcast: z.boolean().optional(),
})

const pushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']).optional(),
})

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // ── Lista os avisos do usuário logado (mais recentes primeiro) ──────────────
  app.get('/', async (request, reply) => {
    const { user_id } = request.user
    const { limit } = request.query as { limit?: string }
    const lim = Math.min(Math.max(parseInt(limit ?? '30', 10) || 30, 1), 100)
    const { rows } = await db.query(
      `SELECT id, tenant_id, type, title, body, link, data, read_at, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [user_id, lim]
    )
    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [user_id]
    )
    return reply.send({ notifications: rows, unread: count })
  })

  // ── Só a contagem de não-lidos (para o badge do sino) ───────────────────────
  app.get('/unread-count', async (request, reply) => {
    const { user_id } = request.user
    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
      [user_id]
    )
    return reply.send({ unread: count })
  })

  // ── Marca um aviso como lido ────────────────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id/read', async (request, reply) => {
    const { user_id } = request.user
    await db.query(
      'UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
      [request.params.id, user_id]
    )
    return reply.send({ ok: true })
  })

  // ── Marca todos como lidos ──────────────────────────────────────────────────
  app.post('/read-all', async (request, reply) => {
    const { user_id } = request.user
    await db.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
      [user_id]
    )
    return reply.send({ ok: true })
  })

  // ── Preferências de notificação ─────────────────────────────────────────────
  app.get('/preferences', async (request, reply) => {
    const { user_id } = request.user
    return reply.send(await getNotificationPrefs(user_id))
  })

  app.put('/preferences', async (request, reply) => {
    const { user_id } = request.user
    const body = prefsSchema.parse(request.body)

    const cols = Object.keys(body)
    if (cols.length === 0) return reply.send(await getNotificationPrefs(user_id))

    // UPSERT: cria a linha do usuário se não existir, senão atualiza os campos enviados.
    const insertCols = ['user_id', ...cols]
    const insertVals = [user_id, ...cols.map((c) => (body as any)[c])]
    const placeholders = insertVals.map((_, i) => `$${i + 1}`)
    const updates = cols.map((c) => `${c} = EXCLUDED.${c}`)
    updates.push('updated_at = NOW()')

    const { rows: [row] } = await db.query(
      `INSERT INTO notification_preferences (${insertCols.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (user_id) DO UPDATE SET ${updates.join(', ')}
       RETURNING *`,
      insertVals
    )
    return reply.send(row)
  })

  // Config pública de push para o app (só o projectId; o token fica no servidor).
  app.get('/push-config', async (_request, reply) => {
    const { eas_project_id } = await getPushConfig()
    return reply.send({ eas_project_id })
  })

  // Diagnóstico: o usuário logado tem token de push registrado?
  app.get('/push-status', async (request, reply) => {
    const { user_id } = request.user
    const { rows } = await db.query('SELECT token, platform, updated_at FROM push_tokens WHERE user_id = $1', [user_id])
    return reply.send({ registered: rows.length > 0, count: rows.length, tokens: rows.map((r: any) => ({ platform: r.platform, tail: String(r.token).slice(-8), updated_at: r.updated_at })) })
  })

  // Diagnóstico: envia um push de teste ao próprio usuário e retorna a resposta
  // crua da Expo (para ver por que não chega — ex.: DeviceNotRegistered, erro FCM).
  app.post('/test-push', async (request, reply) => {
    const { user_id } = request.user
    const { rows } = await db.query('SELECT token FROM push_tokens WHERE user_id = $1', [user_id])
    const tokens = rows.map((r: any) => r.token).filter((t: string) => /^Expo(nent)?PushToken\[/.test(t))
    if (tokens.length === 0) return reply.send({ ok: false, reason: 'no_token', detail: 'Nenhum token de push registrado para este usuário. Abra o app e aceite a permissão de notificações.' })

    const { expo_access_token } = await getPushConfig()
    const messages = tokens.map((to: string) => ({ to, sound: 'default', title: 'Teste de push 🔔', body: 'Se você recebeu isto, o push está funcionando!', data: { link: '/notifications' } }))
    const body = JSON.stringify(messages)
    const send = async (withToken: boolean) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
      if (withToken && expo_access_token) headers.Authorization = `Bearer ${expo_access_token}`
      const res = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body })
      const text = await res.text()
      let json: any = null; try { json = JSON.parse(text) } catch { /* not json */ }
      return { status: res.status, ok: res.ok, body: json ?? text.slice(0, 300) }
    }
    try {
      let result = await send(!!expo_access_token)
      let fellBack = false
      // Token inválido → reenvia sem token (o que a Expo aceita anônimo).
      if (!result.ok && expo_access_token && (result.status === 401 || result.status === 403)) {
        result = await send(false)
        fellBack = true
      }
      // Sucesso HTTP mas com ticket de erro (ex.: credencial FCM) → sinaliza.
      const ticketError = result.ok && Array.isArray(result.body?.data) && result.body.data.find((d: any) => d?.status === 'error')
      return reply.send({
        ok: result.ok && !ticketError,
        status: result.status,
        had_token: !!expo_access_token,
        fell_back_no_token: fellBack,
        ticket_error: ticketError ? (ticketError.details?.error ?? ticketError.message) : null,
        expo: result.body,
        detail: !result.ok ? `Expo retornou HTTP ${result.status}${expo_access_token ? ' (token de acesso pode estar inválido)' : ''}.`
          : ticketError ? `Erro no envio: ${ticketError.details?.error ?? ticketError.message} (verifique a credencial FCM no EAS).`
          : 'Enviado com sucesso.',
        sent_to: tokens.length,
      })
    } catch (e: any) {
      return reply.send({ ok: false, reason: 'send_failed', detail: e?.message })
    }
  })

  // ── Registro / remoção de push token (Expo) ─────────────────────────────────
  app.post('/push-token', async (request, reply) => {
    const { user_id } = request.user
    const { token, platform } = pushTokenSchema.parse(request.body)
    // Um token pertence a um único usuário (o mais recente a registrá-lo).
    await db.query(
      `INSERT INTO push_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = NOW()`,
      [user_id, token, platform ?? null]
    )
    return reply.send({ ok: true })
  })

  app.delete('/push-token', async (request, reply) => {
    const { user_id } = request.user
    const { token } = z.object({ token: z.string().min(1) }).parse(request.body)
    await db.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, user_id])
    return reply.send({ ok: true })
  })
}
