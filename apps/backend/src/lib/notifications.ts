import { db } from './db'
import { sendNotificationEmail } from './email'
import { evolutionSend } from '../services/evolution'
import { SUPPORT_INSTANCE } from './supportBotConfig'
import { getPushConfig } from './pushConfig'

/**
 * Serviço central de avisos e notificações.
 *
 * `createNotification` grava o aviso na caixa in-app do destinatário e, conforme
 * as preferências do usuário (ou os canais forçados por um broadcast do Root),
 * despacha também por push (Expo), e-mail e WhatsApp. Reaproveita `sendEmail` e
 * `evolutionSend`, que já existem e estão em produção.
 *
 * Push: entregue via HTTP direto à Expo Push API (sem SDK / sem dependência
 * nativa no backend). Só funciona de fato quando houver tokens registrados —
 * o registro de token no app depende de um build nativo (EAS), então até lá o
 * push simplesmente não tem destinatários e é ignorado sem erro.
 */

export type NotificationType =
  | 'appointment_reminder'
  | 'new_customer'
  | 'reschedule'
  | 'confirmation'
  | 'service_completion'
  | 'broadcast'
  | 'trial_ending'
  | 'plan_limit'

export type NotificationChannel = 'inapp' | 'push' | 'email' | 'whatsapp'

// Mapeia o tipo de evento para a coluna de preferência por-evento. Tipos fora do
// mapa (ex.: trial_ending) não têm opt-out por-evento e passam sempre.
const EVENT_PREF_COLUMN: Partial<Record<NotificationType, string>> = {
  appointment_reminder: 'evt_appointment_reminder',
  new_customer: 'evt_new_customer',
  reschedule: 'evt_reschedule',
  confirmation: 'evt_confirmation',
  service_completion: 'evt_service_completion',
  broadcast: 'evt_broadcast',
}

interface Prefs {
  channel_inapp: boolean
  channel_push: boolean
  channel_email: boolean
  channel_whatsapp: boolean
  [key: string]: boolean
}

// Preferências padrão quando o usuário ainda não tem linha em notification_preferences.
const DEFAULT_PREFS: Prefs = {
  channel_inapp: true,
  channel_push: true,
  channel_email: false,
  channel_whatsapp: false,
  evt_appointment_reminder: true,
  evt_new_customer: true,
  evt_reschedule: true,
  evt_confirmation: true,
  evt_service_completion: true,
  evt_broadcast: true,
}

export async function getNotificationPrefs(userId: string): Promise<Prefs> {
  const { rows: [row] } = await db.query(
    'SELECT * FROM notification_preferences WHERE user_id = $1',
    [userId]
  )
  return row ? { ...DEFAULT_PREFS, ...row } : { ...DEFAULT_PREFS }
}

interface CreateNotificationParams {
  userId: string
  tenantId?: string | null
  type: NotificationType
  title: string
  body: string
  link?: string | null
  data?: Record<string, unknown> | null
  /**
   * Broadcast do Root: força a entrega SOMENTE nestes canais, ignorando o filtro
   * por-evento. In-app é sempre gravado. Quando omitido, usa as preferências.
   */
  channelsOverride?: NotificationChannel[]
}

/**
 * Cria um aviso in-app e despacha nos canais habilitados. Nunca lança para o
 * chamador — falhas de canal são logadas (o aviso in-app é o registro de verdade).
 */
export async function createNotification(params: CreateNotificationParams): Promise<string | null> {
  const { userId, tenantId = null, type, title, body, link = null, data = null, channelsOverride } = params

  const prefs = await getNotificationPrefs(userId)

  // Opt-out por-evento — vale para TODOS os tipos, inclusive broadcast: se o
  // usuário desativou este tipo de aviso (ex.: "Avisos da plataforma"), nada é
  // gravado nem entregue. O canal in-app é sempre a caixa de entrada quando o
  // aviso passa por aqui (não há toggle de in-app).
  const evtCol = EVENT_PREF_COLUMN[type]
  if (evtCol && prefs[evtCol] === false) {
    return null
  }

  // 1) Grava o aviso in-app (o registro de verdade).
  let notificationId: string | null = null
  try {
    const { rows: [row] } = await db.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, link, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tenantId, userId, type, title, body, link, data ? JSON.stringify(data) : null]
    )
    notificationId = row.id
  } catch (err) {
    console.error('[notifications] falha ao gravar aviso in-app:', err)
  }

  // 2) Decide os canais externos.
  //  - Avisos automáticos: respeitam os canais que o usuário habilitou.
  //  - Broadcast do Root: usa os canais que o Root escolheu (o controle do usuário
  //    sobre broadcasts é o opt-out por evento `evt_broadcast`, já aplicado acima).
  const wants = (ch: NotificationChannel) =>
    channelsOverride ? channelsOverride.includes(ch) : prefs[`channel_${ch}`] === true

  // Despacho best-effort, em paralelo. Nenhuma falha derruba o fluxo.
  const jobs: Promise<unknown>[] = []
  if (wants('push')) jobs.push(dispatchPush(userId, title, body, link, data).catch((e) => console.error('[notifications] push falhou:', e)))
  if (wants('email')) jobs.push(dispatchEmail(userId, title, body, link).catch((e) => console.error('[notifications] email falhou:', e)))
  if (wants('whatsapp')) jobs.push(dispatchWhatsApp(userId, tenantId, title, body).catch((e) => console.error('[notifications] whatsapp falhou:', e)))
  await Promise.allSettled(jobs)

  return notificationId
}

/**
 * Notifica todos os gestores (owner/admin) de um tenant. Usado para avisos de
 * negócio: novo cliente, novo agendamento, remarcação, etc.
 */
export async function notifyTenantManagers(
  tenantId: string,
  notif: Omit<CreateNotificationParams, 'userId' | 'tenantId'>
): Promise<void> {
  const { rows } = await db.query(
    `SELECT user_id FROM user_roles WHERE tenant_id = $1 AND role IN ('owner', 'admin')`,
    [tenantId]
  )
  await Promise.allSettled(
    rows.map((r: any) => createNotification({ ...notif, tenantId, userId: r.user_id }))
  )
}

/**
 * Notifica TODOS os usuários do tenant (owner + admin + staff). Usado para avisos
 * que todo mundo do negócio precisa ver — ex.: limite de mensagens atingido.
 */
export async function notifyAllTenantUsers(
  tenantId: string,
  notif: Omit<CreateNotificationParams, 'userId' | 'tenantId'>
): Promise<void> {
  const { rows } = await db.query(
    `SELECT DISTINCT user_id FROM user_roles WHERE tenant_id = $1`,
    [tenantId]
  )
  await Promise.allSettled(
    rows.map((r: any) => createNotification({ ...notif, tenantId, userId: r.user_id }))
  )
}

/**
 * Notifica os interessados em um agendamento: gestores (owner/admin) do tenant e
 * o usuário vinculado ao profissional que fará o serviço (se houver). Deduplicado.
 */
export async function notifyAppointmentParties(
  tenantId: string,
  professionalId: string | null,
  notif: Omit<CreateNotificationParams, 'userId' | 'tenantId'>
): Promise<void> {
  const { rows } = await db.query(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM user_roles WHERE tenant_id = $1 AND role IN ('owner', 'admin')
       UNION
       SELECT user_id FROM professionals WHERE id = $2 AND tenant_id = $1 AND user_id IS NOT NULL
     ) parties WHERE user_id IS NOT NULL`,
    [tenantId, professionalId]
  )
  await Promise.allSettled(
    rows.map((r: any) => createNotification({ ...notif, tenantId, userId: r.user_id }))
  )
}

/**
 * Broadcast do Root Admin: envia um comunicado a todos os proprietários ou a
 * todos os usuários do sistema, pelos canais escolhidos (in-app, e-mail, WhatsApp).
 * Registra o envio em `broadcasts` e retorna quantos destinatários receberam.
 *
 * tenantId é nulo (aviso de plataforma) → o WhatsApp sai da instância de suporte.
 */
export type BroadcastTarget = 'owners' | 'all' | 'trial_expired' | 'free' | 'cancelled'

export async function sendBroadcast(params: {
  title: string
  body: string
  link?: string | null
  target: BroadcastTarget
  channels: NotificationChannel[]
  createdBy?: string | null
}): Promise<{ recipients: number; broadcastId: string | null }> {
  const { title, body, link = null, target, channels, createdBy = null } = params

  // Destinatários. Além de owners/all, há SEGMENTOS de win-back (donos de tenants
  // por situação comercial) — sempre excluindo quem pediu exclusão de conta.
  const ownersOfTenants = (cond: string) =>
    `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN tenants t ON t.id = ur.tenant_id
      WHERE ur.role = 'owner' AND t.deletion_requested_at IS NULL AND ${cond}`
  const recipientQuery =
    target === 'owners' ? `SELECT DISTINCT user_id FROM user_roles WHERE role = 'owner'`
    : target === 'all' ? `SELECT DISTINCT user_id FROM user_roles`
    : target === 'trial_expired' ? ownersOfTenants(`t.status = 'trial' AND t.trial_ends_at < NOW()`)
    : target === 'free' ? ownersOfTenants(`t.plan = 'free' AND t.status = 'active'`)
    : /* cancelled */ ownersOfTenants(`t.status IN ('cancelled', 'suspended')`)
  const { rows } = await db.query(recipientQuery)

  // Canais forçados incluem sempre in-app (o comunicado fica na caixa de avisos).
  const channelsOverride: NotificationChannel[] = Array.from(new Set<NotificationChannel>(['inapp', ...channels]))

  await Promise.allSettled(
    rows.map((r: any) => createNotification({
      userId: r.user_id,
      tenantId: null,
      type: 'broadcast',
      title, body, link,
      channelsOverride,
    }))
  )

  let broadcastId: string | null = null
  try {
    const { rows: [b] } = await db.query(
      `INSERT INTO broadcasts (title, body, link, target, channels, recipients_count, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [title, body, link, target, channels, rows.length, createdBy]
    )
    broadcastId = b.id
  } catch (err) {
    console.error('[notifications] falha ao registrar broadcast:', err)
  }

  return { recipients: rows.length, broadcastId }
}

// ── Push (Expo Push API via HTTP; sem dependência nativa) ────────────────────
async function dispatchPush(
  userId: string,
  title: string,
  body: string,
  link: string | null,
  data: Record<string, unknown> | null
): Promise<void> {
  const { rows } = await db.query('SELECT token FROM push_tokens WHERE user_id = $1', [userId])
  const tokens = rows.map((r: any) => r.token).filter((t: string) => /^Expo(nent)?PushToken\[/.test(t))
  if (tokens.length === 0) return // sem device registrado (push ainda não ativado)

  const messages = tokens.map((to: string) => ({
    to,
    sound: 'default',
    title,
    body,
    data: { ...(data ?? {}), link },
  }))
  // Token de acesso da Expo (Root Admin, opcional): envia autenticado quando presente.
  // Se o token for inválido (401/403), reenvia SEM token — o envio anônimo é aceito
  // pela Expo, então um token errado nunca derruba o push.
  const { expo_access_token } = await getPushConfig()
  const payload = JSON.stringify(messages)
  const send = (withToken: boolean) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (withToken && expo_access_token) headers.Authorization = `Bearer ${expo_access_token}`
    return fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers, body: payload })
  }
  let res = await send(!!expo_access_token)
  if (!res.ok && expo_access_token && (res.status === 401 || res.status === 403)) {
    console.warn('[notifications] Expo push 401/403 com token — reenviando sem token (token de acesso inválido?)')
    res = await send(false)
  }
  if (!res.ok) {
    console.error('[notifications] Expo push respondeu', res.status, await res.text().catch(() => ''))
  }
}

// ── E-mail ───────────────────────────────────────────────────────────────────
async function dispatchEmail(userId: string, title: string, body: string, link: string | null): Promise<void> {
  const { rows: [user] } = await db.query('SELECT email FROM users WHERE id = $1', [userId])
  if (!user?.email) return
  const fullLink = link ? absoluteAppLink(link) : undefined
  await sendNotificationEmail(user.email, title, `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body)}</p>`, fullLink)
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
async function dispatchWhatsApp(
  userId: string,
  tenantId: string | null,
  title: string,
  body: string
): Promise<void> {
  const { rows: [user] } = await db.query('SELECT phone FROM users WHERE id = $1', [userId])
  const phone = (user?.phone ?? '').replace(/\D/g, '')
  if (!phone) return

  // Aviso de um tenant → sai da instância WhatsApp conectada DAQUELE tenant.
  // Broadcast da plataforma (tenantId nulo) → sai da instância de suporte/plataforma.
  let instanceName: string | null = null
  if (tenantId) {
    const { rows: [inst] } = await db.query(
      `SELECT instance_name FROM whatsapp_instances WHERE tenant_id = $1 AND status = 'connected' LIMIT 1`,
      [tenantId]
    )
    instanceName = inst?.instance_name ?? null
  } else {
    instanceName = SUPPORT_INSTANCE
  }
  if (!instanceName) return
  await evolutionSend(instanceName, phone, `*${title}*\n\n${body}`)
}

function absoluteAppLink(link: string): string {
  const base = process.env.TENANT_WEB_URL ?? 'http://localhost:3002'
  return link.startsWith('http') ? link : `${base}${link.startsWith('/') ? '' : '/'}${link}`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}
