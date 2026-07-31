import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { db } from '../lib/db'
import { hashPassword } from '../lib/password'
import { invalidateAiConfig, getAiConfig, invalidateBotConfig } from '../lib/botConfig'
import { redis, QR_CODE_TTL } from '../lib/redis'
import { monthlySpend } from '../lib/aiUsage'
import { testBotReply } from '../services/bot'
import {
  evolutionConnectionState,
  evolutionCreateInstance,
  evolutionGetQR,
  evolutionGetStatus,
  evolutionLogout,
} from '../services/evolution'
import {
  SUPPORT_INSTANCE,
  getSupportBotConfig,
  updateSupportBotConfig,
} from '../lib/supportBotConfig'
import { encrypt, decrypt, maskSecret } from '../lib/crypto'
import { logAdminAction, auditFromRequest } from '../lib/auditLog'
import { sendBroadcast } from '../lib/notifications'
import { computeFinanceExtras } from '../lib/financeiroCalc'
import { invalidatePushConfig } from '../lib/pushConfig'

// Secret fields (per platform_settings key) that must be encrypted at rest and
// never returned in full to the admin panel.
const SECRET_FIELDS: Record<string, string[]> = {
  payment_config: ['mp_access_token', 'mp_webhook_secret'],
  ai_config: ['api_key', 'transcription_api_key'],
  evolution_config: ['key', 'webhook_secret'],
  smtp_config: ['pass'],
  email_config: ['resend_api_key'],
  google_config: ['client_secret'],
  push_config: ['expo_access_token'],
}
import { invalidatePaymentConfig } from '../lib/paymentConfig'
import {
  invalidateEvolutionConfig,
  invalidateSmtpConfig,
  invalidateEmailConfig,
  invalidateGoogleConfig,
  getEvolutionConfig,
} from '../lib/integrationConfig'
import { invalidateBrandConfig } from '../lib/brandConfig'
import { ASSET_SLOTS } from './branding'
import { handoffUpdateSchema, invalidateHandoffConfig } from '../lib/handoffConfig'

export const rootRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).requireRoot)

  // ── Dashboard Stats ─────────────────────────────────────────────────────────
  app.get('/stats', async (_request, reply) => {
    const [
      totals, byPlan, byStatus, recentTenants,
      mrr, newThisMonth, churn30d, topAffiliates,
    ] = await Promise.all([
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM tenants) as total_tenants,
          (SELECT COUNT(*) FROM tenants WHERE status = 'active') as active_tenants,
          (SELECT COUNT(*) FROM tenants WHERE status = 'trial') as trial_tenants,
          (SELECT COUNT(*) FROM tenants WHERE status = 'suspended' OR status = 'cancelled') as churned_tenants,
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM appointments WHERE DATE(created_at) = CURRENT_DATE) as appointments_today,
          (SELECT COUNT(*) FROM messages WHERE DATE(created_at) = CURRENT_DATE) as messages_today
      `),
      db.query(`SELECT plan, COUNT(*) as count FROM tenants GROUP BY plan`),
      db.query(`SELECT status, COUNT(*) as count FROM tenants GROUP BY status`),
      db.query(`
        SELECT t.id, t.name, t.plan, t.status, t.created_at,
               u.name as owner_name, u.email as owner_email
        FROM tenants t
        LEFT JOIN user_roles ur ON ur.tenant_id = t.id AND ur.role = 'owner'
        LEFT JOIN users u ON u.id = ur.user_id
        ORDER BY t.created_at DESC LIMIT 5
      `),
      db.query(`
        SELECT
          SUM(CASE WHEN plan='basico' THEN 8900 WHEN plan='premium' THEN 16900 WHEN plan='profissional' THEN 29900 ELSE 0 END) as mrr_cents
        FROM tenants WHERE status = 'active'
      `),
      db.query(`SELECT COUNT(*) FROM tenants WHERE created_at >= NOW() - INTERVAL '30 days'`),
      db.query(`SELECT COUNT(*) FROM tenants WHERE status = 'cancelled'`),
      db.query(`
        SELECT a.id, u.name, a.referral_code, a.pending_earnings, a.paid_earnings,
               (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) AS total_referrals
        FROM affiliates a JOIN users u ON u.id = a.user_id
        ORDER BY a.pending_earnings DESC LIMIT 5
      `),
    ])

    return reply.send({
      ...totals.rows[0],
      by_plan: Object.fromEntries(byPlan.rows.map((r: any) => [r.plan, Number(r.count)])),
      by_status: Object.fromEntries(byStatus.rows.map((r: any) => [r.status, Number(r.count)])),
      recent_tenants: recentTenants.rows,
      mrr_cents: Number(mrr.rows[0]?.mrr_cents ?? 0),
      new_tenants_30d: Number(newThisMonth.rows[0].count),
      churn_30d: Number(churn30d.rows[0].count),
      top_affiliates: topAffiliates.rows,
    })
  })

  // ── Tenants ─────────────────────────────────────────────────────────────────
  app.get('/tenants', async (request, reply) => {
    const { search, plan, status, page = '1', limit = '20' } = request.query as Record<string, string>
    const offset = (Number(page) - 1) * Number(limit)

    let where = 'WHERE 1=1'
    const params: unknown[] = []
    let i = 1

    if (search) { where += ` AND (t.name ILIKE $${i} OR u.email ILIKE $${i})`; params.push(`%${search}%`); i++ }
    if (plan)   { where += ` AND t.plan = $${i}`; params.push(plan); i++ }
    if (status) { where += ` AND t.status = $${i}`; params.push(status); i++ }

    const [rows, count] = await Promise.all([
      db.query(`
        SELECT t.*,
          u.name as owner_name, u.email as owner_email,
          ac.business_type,
          btt.display_name AS business_type_name,
          (SELECT COUNT(*) FROM user_roles ur WHERE ur.tenant_id = t.id) as user_count,
          (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id) as appointment_count,
          wi.status as whatsapp_status
        FROM tenants t
        LEFT JOIN user_roles ur2 ON ur2.tenant_id = t.id AND ur2.role = 'owner'
        LEFT JOIN users u ON u.id = ur2.user_id
        LEFT JOIN whatsapp_instances wi ON wi.tenant_id = t.id
        LEFT JOIN agent_config ac ON ac.tenant_id = t.id
        LEFT JOIN business_type_templates btt ON btt.business_type = ac.business_type
        ${where}
        ORDER BY t.created_at DESC
        LIMIT $${i} OFFSET $${i + 1}
      `, [...params, Number(limit), offset]),
      db.query(`
        SELECT COUNT(*) FROM tenants t
        LEFT JOIN user_roles ur2 ON ur2.tenant_id = t.id AND ur2.role = 'owner'
        LEFT JOIN users u ON u.id = ur2.user_id
        ${where}
      `, params),
    ])

    return reply.send({ data: rows.rows, total: Number(count.rows[0].count), page: Number(page), limit: Number(limit) })
  })

  app.get<{ Params: { id: string } }>('/tenants/:id', async (request, reply) => {
    const { rows: [tenant] } = await db.query(`
      SELECT t.*,
        u.name as owner_name, u.email as owner_email, u.id as owner_id,
        wi.status as whatsapp_status, wi.phone_number as whatsapp_phone,
        ac.system_prompt, ac.tone, ac.business_info,
        ac.business_type, ac.custom_instructions, ac.language,
        ac.handoff_enabled, ac.handoff_pause_on_owner_reply, ac.handoff_timeout_min,
        ac.handoff_offer_message, ac.handoff_button_label, ac.handoff_ack_message,
        ac.handoff_resume_message, ac.handoff_owner_resume_keyword,
        s.status as subscription_status, s.next_billing_date, s.mp_subscription_id
      FROM tenants t
      LEFT JOIN user_roles ur2 ON ur2.tenant_id = t.id AND ur2.role = 'owner'
      LEFT JOIN users u ON u.id = ur2.user_id
      LEFT JOIN whatsapp_instances wi ON wi.tenant_id = t.id
      LEFT JOIN agent_config ac ON ac.tenant_id = t.id
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      WHERE t.id = $1
    `, [request.params.id])
    if (!tenant) return reply.status(404).send({ error: 'Not found' })

    const { rows: staff } = await db.query(`
      SELECT u.id, u.name, u.email, u.phone, ur.role
      FROM users u JOIN user_roles ur ON ur.user_id = u.id
      WHERE ur.tenant_id = $1 ORDER BY ur.role, u.name
    `, [request.params.id])

    const { rows: appointments } = await db.query(`
      SELECT DATE(starts_at) as date, COUNT(*) as count, status
      FROM appointments WHERE tenant_id = $1 AND starts_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(starts_at), status ORDER BY date
    `, [request.params.id])

    return reply.send({ ...tenant, staff, appointment_stats: appointments })
  })

  // Validated body for root tenant updates — 'status' is part of the tenant
  // state machine, so only known values are accepted (ZodError → 400 globally).
  const tenantPatchSchema = z.object({
    plan: z.string().min(1).max(64).optional().nullable(),
    status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional().nullable(),
    max_agendas: z.number().int().min(1).optional().nullable(),
    max_users: z.number().int().min(1).optional().nullable(),
    trial_ends_at: z.string().datetime({ offset: true }).optional().nullable(),
  })

  app.patch<{ Params: { id: string } }>('/tenants/:id', async (request, reply) => {
    const body = tenantPatchSchema.parse(request.body ?? {})
    const { plan, status, max_agendas, max_users, trial_ends_at } = body
    const { rows: [tenant] } = await db.query(`
      UPDATE tenants SET
        plan = COALESCE($1, plan),
        status = COALESCE($2, status),
        max_agendas = COALESCE($3, max_agendas),
        max_users = COALESCE($4, max_users),
        trial_ends_at = COALESCE($5, trial_ends_at)
      WHERE id = $6 RETURNING *
    `, [plan, status, max_agendas, max_users, trial_ends_at, request.params.id])
    if (!tenant) return reply.status(404).send({ error: 'Not found' })
    const changed = Object.entries(body)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${v}`)
    await logAdminAction(auditFromRequest(request, 'tenant.update', request.params.id, `campos: ${changed.join(', ')}`))
    return reply.send(tenant)
  })

  // Root Admin edits a tenant's human-handoff settings (same fields the owner
  // sees in the app). agent_config values → code defaults in lib/handoffConfig.
  app.patch<{ Params: { id: string } }>('/tenants/:id/handoff', async (request, reply) => {
    const body = handoffUpdateSchema.parse(request.body ?? {})
    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) { sets.push(`${k} = $${i++}`); values.push(v) }
    }
    if (!sets.length) return reply.status(400).send({ error: 'Nada para atualizar' })
    sets.push('updated_at = NOW()')
    values.push(request.params.id)
    const { rows: [ac] } = await db.query(
      `UPDATE agent_config SET ${sets.join(', ')} WHERE tenant_id = $${i} RETURNING tenant_id`,
      values
    )
    if (!ac) return reply.status(404).send({ error: 'Tenant sem configuração de agente' })
    await redis.del(`tenant:config:${request.params.id}`)
    await invalidateHandoffConfig(request.params.id)
    await logAdminAction(auditFromRequest(request, 'tenant.handoff.update', request.params.id, `campos: ${Object.keys(body).join(', ')}`))
    return reply.send({ ok: true })
  })

  // Root Admin edits a tenant's AI agent prompt/config (same fields the owner
  // edits via PATCH /agent/config). Tone is free text (matches routes/agent.ts).
  const agentPatchSchema = z.object({
    system_prompt:       z.string().optional(),
    tone:                z.string().max(60).optional(),
    language:            z.string().optional(),
    business_info:       z.string().optional(),
    business_type:       z.string().optional(),
    custom_instructions: z.string().optional(),
  })

  app.patch<{ Params: { id: string } }>('/tenants/:id/agent', async (request, reply) => {
    const body = agentPatchSchema.parse(request.body ?? {})
    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) { sets.push(`${k} = $${i++}`); values.push(v) }
    }
    if (!sets.length) return reply.status(400).send({ error: 'Nada para atualizar' })
    sets.push('updated_at = NOW()')
    values.push(request.params.id)
    const { rows: [ac] } = await db.query(
      `UPDATE agent_config SET ${sets.join(', ')} WHERE tenant_id = $${i} RETURNING tenant_id`,
      values
    )
    if (!ac) return reply.status(404).send({ error: 'Tenant sem configuração de agente' })
    await redis.del(`tenant:config:${request.params.id}`)
    await logAdminAction(auditFromRequest(request, 'tenant.agent.update', request.params.id, `campos: ${Object.keys(body).join(', ')}`))
    return reply.send({ ok: true })
  })

  // Tenant staff — role never accepts 'root': the root role is global and must
  // not be assignable through tenant staff management (privilege escalation).
  const staffAddSchema = z.object({
    user_id: z.string().uuid(),
    role: z.enum(['admin', 'staff', 'owner']),
  })

  const staffEditSchema = z.object({
    name:  z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(30).nullable().optional(),
    role:  z.enum(['admin', 'staff', 'owner']).optional(),
  })

  // Tenant staff: add
  app.post<{ Params: { id: string } }>('/tenants/:id/staff', async (request, reply) => {
    const { user_id, role } = staffAddSchema.parse(request.body ?? {})
    await db.query(
      `INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
      [user_id, request.params.id, role]
    )
    await logAdminAction(auditFromRequest(request, 'tenant.staff.add', request.params.id, `user ${user_id} → ${role}`))
    return reply.status(201).send({ ok: true })
  })

  // Tenant staff: edit user info + role
  app.patch<{ Params: { id: string; userId: string } }>('/tenants/:id/staff/:userId', async (request, reply) => {
    const { name, email, phone, role } = staffEditSchema.parse(request.body ?? {})

    // The user must belong to this tenant before we touch the GLOBAL users row.
    const { rows: [link] } = await db.query(
      `SELECT role FROM user_roles WHERE tenant_id = $1 AND user_id = $2`,
      [request.params.id, request.params.userId]
    )
    if (!link) return reply.status(404).send({ error: 'Usuário não pertence a este tenant' })

    if (name || email || phone !== undefined) {
      await db.query(
        `UPDATE users SET
           name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone)
         WHERE id = $4`,
        [name || null, email || null, phone !== undefined ? (phone || null) : undefined, request.params.userId]
      )
    }
    if (role) {
      await db.query(
        `UPDATE user_roles SET role = $1 WHERE tenant_id = $2 AND user_id = $3 AND role != 'owner'`,
        [role, request.params.id, request.params.userId]
      )
    }
    const changed = Object.entries({ name, email, phone, role })
      .filter(([, v]) => v !== undefined).map(([k]) => k)
    await logAdminAction(auditFromRequest(request, 'tenant.staff.update', request.params.id, `user ${request.params.userId}, campos: ${changed.join(', ')}`))
    return reply.send({ ok: true })
  })

  // Tenant staff: remove
  app.delete<{ Params: { id: string; userId: string } }>('/tenants/:id/staff/:userId', async (request, reply) => {
    await db.query(
      `DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role != 'owner'`,
      [request.params.id, request.params.userId]
    )
    await logAdminAction(auditFromRequest(request, 'tenant.staff.remove', request.params.id, `user ${request.params.userId}`))
    return reply.send({ ok: true })
  })

  // Extend tenant trial
  app.post<{ Params: { id: string } }>('/tenants/:id/extend-trial', async (request, reply) => {
    const { days } = z.object({
      days: z.number().int().min(1).max(365).default(7),
    }).parse(request.body ?? {})
    await db.query(
      `UPDATE tenants SET trial_ends_at = COALESCE(trial_ends_at, NOW()) + ($1 || ' days')::interval, status = 'trial' WHERE id = $2`,
      [days, request.params.id]
    )
    await logAdminAction(auditFromRequest(request, 'tenant.trial_extend', request.params.id, `+${days} dias`))
    return reply.send({ ok: true })
  })

  // ── Users ───────────────────────────────────────────────────────────────────
  app.get('/users', async (request, reply) => {
    const { search, page = '1', limit = '50' } = request.query as Record<string, string>
    const offset = (Number(page) - 1) * Number(limit)

    let where = 'WHERE 1=1'
    const params: unknown[] = []
    if (search) { where += ` AND (u.name ILIKE $1 OR u.email ILIKE $1)`; params.push(`%${search}%`) }

    const { rows } = await db.query(`
      SELECT u.id, u.name, u.email, u.phone, u.created_at,
             u.google_sub IS NOT NULL as has_google,
             json_agg(json_build_object('tenant_id', ur.tenant_id, 'tenant_name', t.name, 'role', ur.role)) as tenants
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN tenants t ON t.id = ur.tenant_id
      ${where}
      GROUP BY u.id ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, Number(limit), offset])

    return reply.send(rows)
  })

  // Create user
  app.post('/users', async (request, reply) => {
    const { name, email, phone, password } = request.body as any
    const password_hash = hashPassword(password ?? randomBytes(24).toString('hex'))
    try {
      const { rows: [user] } = await db.query(
        `INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, phone, created_at`,
        [name, email, phone || null, password_hash]
      )
      // NEVER log the password — only identifying, non-secret fields.
      await logAdminAction(auditFromRequest(request, 'user.create', user.id, `${name} <${email}>`))
      return reply.status(201).send(user)
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'E-mail já cadastrado' })
      throw e
    }
  })

  // Edit user
  app.patch<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const { name, email, phone, password } = request.body as any
    const updates: string[] = []
    const params: unknown[] = []
    let i = 1

    if (name !== undefined)  { updates.push(`name = $${i++}`);  params.push(name) }
    if (email !== undefined) { updates.push(`email = $${i++}`); params.push(email) }
    if (phone !== undefined) { updates.push(`phone = $${i++}`); params.push(phone || null) }
    if (password) {
      updates.push(`password_hash = $${i++}`)
      params.push(hashPassword(password))
    }

    if (updates.length === 0) return reply.send({ ok: true })

    params.push(request.params.id)
    try {
      const { rows: [user] } = await db.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, name, email, phone, created_at`,
        params
      )
      if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
      // NEVER log the password — only which fields changed (field names, no values).
      const changed = [
        name !== undefined && 'name',
        email !== undefined && 'email',
        phone !== undefined && 'phone',
        password && 'password',
      ].filter(Boolean)
      await logAdminAction(auditFromRequest(request, 'user.update', request.params.id, `campos: ${changed.join(', ')}`))
      return reply.send(user)
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'E-mail já cadastrado' })
      throw e
    }
  })

  // Delete user
  app.delete<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const { rows: [user] } = await db.query(`SELECT id, email FROM users WHERE id = $1`, [request.params.id])
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    await db.query(`DELETE FROM users WHERE id = $1`, [request.params.id])
    await logAdminAction(auditFromRequest(request, 'user.delete', request.params.id, `${user.email}`))
    return reply.send({ ok: true })
  })

  // ── Platform Settings ────────────────────────────────────────────────────────
  app.get('/settings', async (_request, reply) => {
    const { rows } = await db.query(`SELECT key, value FROM platform_settings ORDER BY key`)
    const out: Record<string, any> = {}
    for (const r of rows as any[]) {
      const secrets = SECRET_FIELDS[r.key]
      if (secrets && r.value && typeof r.value === 'object') {
        // Return secrets masked (decrypt first — values may be encrypted at rest).
        const masked = { ...r.value }
        for (const f of secrets) {
          if (masked[f]) masked[f] = maskSecret(decrypt(String(masked[f])))
        }
        out[r.key] = masked
      } else {
        out[r.key] = r.value
      }
    }
    return reply.send(out)
  })

  app.patch<{ Params: { key: string } }>('/settings/:key', async (request, reply) => {
    const key = request.params.key
    let body: any = request.body
    const secrets = SECRET_FIELDS[key]

    if (secrets && body && typeof body === 'object') {
      // Encrypt secrets at rest. A masked/blank incoming value means "unchanged"
      // (the panel showed a masked value) → keep the existing encrypted secret.
      const { rows: [existing] } = await db.query(
        `SELECT value FROM platform_settings WHERE key = $1`, [key]
      )
      const prev = existing?.value ?? {}
      body = { ...body }
      for (const f of secrets) {
        const incoming = body[f]
        if (incoming === undefined) continue
        if (!incoming || String(incoming).includes('****')) {
          body[f] = prev[f] ?? '' // unchanged → keep stored (already encrypted)
        } else {
          body[f] = encrypt(String(incoming))
        }
      }
    }

    await db.query(
      `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(body)]
    )
    if (key === 'ai_config') await invalidateAiConfig()
    if (key === 'bot_config') await invalidateBotConfig()
    if (key === 'payment_config') await invalidatePaymentConfig()
    if (key === 'evolution_config') await invalidateEvolutionConfig()
    if (key === 'smtp_config') await invalidateSmtpConfig()
    if (key === 'email_config') await invalidateEmailConfig()
    if (key === 'google_config') await invalidateGoogleConfig()
    if (key === 'brand_config') await invalidateBrandConfig()
    if (key === 'push_config') await invalidatePushConfig()
    // Governance: record WHO changed the config (secret values never logged).
    const changed = body && typeof body === 'object' ? Object.keys(body).join(', ') : ''
    await logAdminAction(auditFromRequest(request, 'settings.update', key, `campos: ${changed}`))
    return reply.send({ ok: true })
  })

  // ── Support/sales bot (platform WhatsApp) ────────────────────────────────────
  const supportBehaviourSchema = z.object({
    enabled: z.boolean().optional(),
    system_prompt: z.string().max(8000).optional(),
    product_info: z.string().max(8000).optional(),
    register_url: z.string().url().max(300).optional(),
  })

  // Current config + live connection state.
  app.get('/support-bot', async (_request, reply) => {
    const cfg = await getSupportBotConfig()
    return reply.send(cfg)
  })

  // Update behaviour fields (never touches runtime connection state).
  app.patch('/support-bot', async (request, reply) => {
    const body = supportBehaviourSchema.parse(request.body)
    const next = await updateSupportBotConfig(body)
    await logAdminAction(auditFromRequest(request, 'support_bot.update', 'support_bot_config', `campos: ${Object.keys(body).join(', ')}`))
    return reply.send(next)
  })

  // Connect the system WhatsApp: create the Evolution instance + fetch QR.
  app.post('/support-bot/connect', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const evoCfg = await getEvolutionConfig()
    const secret = evoCfg.webhook_secret
    const webhookUrl = `${evoCfg.webhook_base}/webhook/whatsapp/${SUPPORT_INSTANCE}${secret ? `?token=${encodeURIComponent(secret)}` : ''}`
    await updateSupportBotConfig({ status: 'qr_pending' })
    await evolutionCreateInstance(SUPPORT_INSTANCE, webhookUrl)
    const qrData = await evolutionGetQR(SUPPORT_INSTANCE)
    if (qrData) {
      await redis.setex('support:qr', QR_CODE_TTL, JSON.stringify(qrData))
      await logAdminAction(auditFromRequest(request, 'support_bot.connect', SUPPORT_INSTANCE, 'iniciou conexão'))
      return reply.send(qrData)
    }
    return reply.send({ qr_pending: true })
  })

  // Poll for the QR (from webhook cache or a fresh fetch).
  app.get('/support-bot/qr', async (_request, reply) => {
    const cached = await redis.get('support:qr')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.qrcode) return reply.send(parsed)
    }
    const qrData = await evolutionGetQR(SUPPORT_INSTANCE)
    if (qrData) {
      await redis.setex('support:qr', QR_CODE_TTL, JSON.stringify(qrData))
      return reply.send(qrData)
    }
    return reply.status(202).send({ qr_pending: true })
  })

  // Live connection status (syncs the stored status with Evolution).
  app.get('/support-bot/status', async (_request, reply) => {
    const cfg = await getSupportBotConfig()
    const liveStatus = await evolutionGetStatus(SUPPORT_INSTANCE)
    const state = liveStatus?.instance?.state ?? liveStatus?.state ?? 'unknown'
    let next = cfg
    if (state === 'open' && cfg.status !== 'connected') {
      next = await updateSupportBotConfig({ status: 'connected' })
    } else if (state === 'close' && cfg.status !== 'disconnected') {
      next = await updateSupportBotConfig({ status: 'disconnected', phone_number: null })
      await redis.del('support:qr')
    }
    return reply.send({ ...next, live: { state } })
  })

  // Disconnect / unlink the system WhatsApp.
  app.post('/support-bot/disconnect', async (request, reply) => {
    await evolutionLogout(SUPPORT_INSTANCE)
    const next = await updateSupportBotConfig({ status: 'disconnected', phone_number: null })
    await redis.del('support:qr')
    await logAdminAction(auditFromRequest(request, 'support_bot.disconnect', SUPPORT_INSTANCE, 'desconectou'))
    return reply.send(next)
  })

  // Audit trail (governance) — who changed what in the Root Admin, when.
  app.get('/audit-log', async (request, reply) => {
    const { limit = '100', offset = '0' } = request.query as { limit?: string; offset?: string }
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 500)
    const off = Math.max(Number(offset) || 0, 0)
    const { rows } = await db.query(
      `SELECT actor_email, action, target, summary, ip,
              to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS at
       FROM admin_audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [lim, off]
    )
    return reply.send(rows)
  })

  // Infra status (read-only) — health of DB, Redis, Evolution and last backup.
  // NEVER returns any secret (URLs/keys/passwords) — only up/down + metrics.
  app.get('/infra-status', async (_request, reply) => {
    // DB ping
    const db_ = await (async () => {
      const t = Date.now()
      try { await db.query('SELECT 1'); return { ok: true, latency_ms: Date.now() - t } }
      catch { return { ok: false, latency_ms: null as number | null } }
    })()

    // Redis ping
    const redis_ = await (async () => {
      const t = Date.now()
      try { await redis.ping(); return { ok: true, latency_ms: Date.now() - t } }
      catch { return { ok: false, latency_ms: null as number | null } }
    })()

    // Evolution — count instances (never expose url/key)
    const evolution_ = await (async () => {
      const cfg = await getEvolutionConfig()
      const configured = !!(cfg.url && cfg.key)
      if (!configured) return { ok: false, configured: false, total: 0, connected: 0 }
      try {
        const res = await fetch(`${cfg.url}/instance/fetchInstances`, {
          headers: { apikey: cfg.key }, signal: AbortSignal.timeout(6000),
        })
        if (!res.ok) return { ok: false, configured: true, total: 0, connected: 0 }
        const list: any[] = await res.json().catch(() => [])
        const arr = Array.isArray(list) ? list : []
        const stateOf = (i: any) => i?.connectionStatus ?? i?.instance?.state ?? i?.state ?? ''
        const connected = arr.filter((i) => stateOf(i) === 'open').length
        return { ok: true, configured: true, total: arr.length, connected }
      } catch { return { ok: false, configured: true, total: 0, connected: 0 } }
    })()

    // Last backup (from backup_log — written by infra/backup.sh)
    const backup_ = await (async () => {
      try {
        const { rows: [b] } = await db.query(
          `SELECT filename, size_bytes,
                  to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS at,
                  EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS age_hours,
                  (SELECT COUNT(*) FROM backup_log) AS total
           FROM backup_log ORDER BY created_at DESC LIMIT 1`
        )
        if (!b) return { ok: false, last_at: null, age_hours: null, total: 0 }
        const ageHours = Number(b.age_hours)
        return {
          // Consider healthy if the last backup ran within ~26h (daily + margin)
          ok: ageHours <= 26,
          last_at: b.at,
          age_hours: Math.round(ageHours * 10) / 10,
          size_bytes: b.size_bytes ? Number(b.size_bytes) : null,
          total: Number(b.total),
        }
      } catch {
        // Table may not exist yet (migration not applied) — report as unknown
        return { ok: false, last_at: null, age_hours: null, total: 0 }
      }
    })()

    return reply.send({ db: db_, redis: redis_, evolution: evolution_, backup: backup_ })
  })

  // ── Branding (dynamic logo/favicon/colors) ────────────────────────────────
  // Current branding state for the admin panel: which asset slots exist + when.
  app.get('/branding', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT slot, content_type,
              to_char(updated_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS at
       FROM branding_assets`
    )
    const assets: Record<string, any> = {}
    for (const r of rows as any[]) assets[r.slot] = { content_type: r.content_type, at: r.at, url: `/branding/asset/${r.slot}` }
    return reply.send({ slots: ASSET_SLOTS, assets })
  })

  const ALLOWED_IMG = new Set([
    'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp',
    'image/x-icon', 'image/vnd.microsoft.icon',
  ])
  const MAX_ASSET_BYTES = 2 * 1024 * 1024 // 2 MB

  // Upload/replace a branding asset (base64 data URL in JSON — no multipart needed).
  app.put<{ Params: { slot: string } }>('/branding/asset/:slot', async (request, reply) => {
    const slot = request.params.slot
    if (!(ASSET_SLOTS as readonly string[]).includes(slot)) {
      return reply.status(400).send({ error: 'Slot inválido' })
    }
    const { data_url } = (request.body ?? {}) as { data_url?: string }
    const m = typeof data_url === 'string' && data_url.match(/^data:([^;]+);base64,(.+)$/s)
    if (!m) return reply.status(400).send({ error: 'Imagem inválida (envie um data URL base64)' })
    const contentType = m[1].toLowerCase()
    if (!ALLOWED_IMG.has(contentType)) {
      return reply.status(400).send({ error: 'Formato não suportado (use PNG, JPG, SVG, WEBP ou ICO)' })
    }
    let buf: Buffer
    try { buf = Buffer.from(m[2], 'base64') } catch { return reply.status(400).send({ error: 'Base64 inválido' }) }
    if (buf.length === 0) return reply.status(400).send({ error: 'Arquivo vazio' })
    if (buf.length > MAX_ASSET_BYTES) return reply.status(413).send({ error: 'Arquivo muito grande (máx. 2 MB)' })

    await db.query(
      `INSERT INTO branding_assets (slot, content_type, data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (slot) DO UPDATE SET content_type = $2, data = $3, updated_at = NOW()`,
      [slot, contentType, buf]
    )
    await logAdminAction(auditFromRequest(request, 'branding.upload', slot, `${contentType}, ${buf.length} bytes`))
    return reply.send({ ok: true })
  })

  // Remove a branding asset (apps fall back to the bundled default).
  app.delete<{ Params: { slot: string } }>('/branding/asset/:slot', async (request, reply) => {
    const slot = request.params.slot
    if (!(ASSET_SLOTS as readonly string[]).includes(slot)) {
      return reply.status(400).send({ error: 'Slot inválido' })
    }
    await db.query('DELETE FROM branding_assets WHERE slot = $1', [slot])
    await logAdminAction(auditFromRequest(request, 'branding.delete', slot))
    return reply.send({ ok: true })
  })

  // ── AI usage & cost dashboard ─────────────────────────────────────────────
  app.get('/ai-usage', async (request, reply) => {
    const days = Math.min(Math.max(Number((request.query as any)?.days) || 30, 1), 365)
    const TOK = 'input_tokens + output_tokens + cache_read_tokens + cache_write_tokens'

    // usd→brl rate from ai_config (for display)
    const { rows: [cfg] } = await db.query("SELECT value FROM platform_settings WHERE key = 'ai_config'")
    const usdBrl = Number(cfg?.value?.usd_brl_rate ?? 6)

    try {
      const [totals, monthTotal, byDay, byTenant, byModel] = await Promise.all([
        db.query(
          `SELECT COALESCE(SUM(cost_usd),0)::float AS cost, COALESCE(SUM(${TOK}),0)::bigint AS tokens, COUNT(*)::int AS calls
           FROM ai_usage WHERE created_at >= now() - ($1::int * interval '1 day')`, [days]),
        db.query(
          `SELECT COALESCE(SUM(cost_usd),0)::float AS cost
           FROM ai_usage
           WHERE date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo')
               = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')`),
        db.query(
          `SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
                  SUM(cost_usd)::float AS cost, SUM(${TOK})::bigint AS tokens
           FROM ai_usage WHERE created_at >= now() - ($1::int * interval '1 day')
           GROUP BY day ORDER BY day`, [days]),
        db.query(
          `SELECT COALESCE(t.name, '(desconhecido)') AS tenant, u.tenant_id,
                  SUM(u.cost_usd)::float AS cost, SUM(${TOK})::bigint AS tokens, COUNT(*)::int AS calls
           FROM ai_usage u LEFT JOIN tenants t ON t.id = u.tenant_id
           WHERE u.created_at >= now() - ($1::int * interval '1 day')
           GROUP BY u.tenant_id, t.name ORDER BY cost DESC LIMIT 20`, [days]),
        db.query(
          `SELECT model, SUM(cost_usd)::float AS cost, SUM(${TOK})::bigint AS tokens, COUNT(*)::int AS calls
           FROM ai_usage WHERE created_at >= now() - ($1::int * interval '1 day')
           GROUP BY model ORDER BY cost DESC`, [days]),
      ])
      return reply.send({
        days,
        usd_brl_rate: usdBrl,
        totals: totals.rows[0],
        month_cost: monthTotal.rows[0].cost,
        by_day: byDay.rows,
        by_tenant: byTenant.rows,
        by_model: byModel.rows,
      })
    } catch {
      // ai_usage table not created yet (migration 014 pending) — return empty shape
      return reply.send({
        days, usd_brl_rate: usdBrl,
        totals: { cost: 0, tokens: 0, calls: 0 }, month_cost: 0,
        by_day: [], by_tenant: [], by_model: [], pending_migration: true,
      })
    }
  })

  // ── Platform Plans ───────────────────────────────────────────────────────────
  app.get('/plans', async (_request, reply) => {
    const { rows } = await db.query(`SELECT * FROM platform_plans ORDER BY sort_order, name`)
    return reply.send(rows)
  })

  app.post('/plans', async (request, reply) => {
    const { slug, name, description, price_cents, max_agendas, max_users, trial_days, features, is_active, sort_order } = request.body as any
    try {
      const { rows: [plan] } = await db.query(
        `INSERT INTO platform_plans (slug, name, description, price_cents, max_agendas, max_users, trial_days, features, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [slug, name, description ?? null, price_cents ?? 0, max_agendas ?? 1, max_users ?? 1,
         trial_days ?? 0, JSON.stringify(features ?? []), is_active ?? true, sort_order ?? 0]
      )
      await logAdminAction(auditFromRequest(request, 'plan.create', plan.id, `${slug} — ${name}`))
      return reply.status(201).send(plan)
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'Slug já existe' })
      throw e
    }
  })

  app.patch<{ Params: { id: string } }>('/plans/:id', async (request, reply) => {
    const { name, description, price_cents, max_agendas, max_users, trial_days, features, is_active, sort_order, media_enabled } = request.body as any
    const { rows: [plan] } = await db.query(
      `UPDATE platform_plans SET
         name          = COALESCE($1, name),
         description   = COALESCE($2, description),
         price_cents   = COALESCE($3, price_cents),
         max_agendas   = COALESCE($4, max_agendas),
         max_users     = COALESCE($5, max_users),
         trial_days    = COALESCE($6, trial_days),
         features      = COALESCE($7, features),
         is_active     = COALESCE($8, is_active),
         sort_order    = COALESCE($9, sort_order),
         media_enabled = COALESCE($11, media_enabled),
         updated_at    = NOW()
       WHERE id = $10 RETURNING *`,
      [name, description, price_cents, max_agendas, max_users, trial_days,
       features ? JSON.stringify(features) : null, is_active, sort_order, request.params.id,
       typeof media_enabled === 'boolean' ? media_enabled : null]
    )
    if (!plan) return reply.status(404).send({ error: 'Plano não encontrado' })
    // Plan capability changed → drop cached media flags so the bot re-reads it.
    // SCAN (non-blocking) instead of KEYS, which is O(N) and blocks Redis.
    try {
      const stream = redis.scanStream({ match: 'tenant:media:*', count: 100 })
      for await (const keys of stream as unknown as AsyncIterable<string[]>) {
        if (keys.length) await redis.del(...keys)
      }
    } catch { /* cache cleanup is best-effort */ }
    const changed = Object.entries({ name, description, price_cents, max_agendas, max_users, trial_days, features, is_active, sort_order, media_enabled })
      .filter(([, v]) => v !== undefined).map(([k]) => k)
    await logAdminAction(auditFromRequest(request, 'plan.update', request.params.id, `${plan.slug ?? plan.name} — campos: ${changed.join(', ')}`))
    return reply.send(plan)
  })

  app.delete<{ Params: { id: string } }>('/plans/:id', async (request, reply) => {
    const { rows: [plan] } = await db.query(`SELECT slug FROM platform_plans WHERE id = $1`, [request.params.id])
    if (!plan) return reply.status(404).send({ error: 'Plano não encontrado' })
    if (['free', 'basico', 'premium', 'profissional'].includes(plan.slug)) {
      return reply.status(400).send({ error: 'Planos padrão não podem ser excluídos' })
    }
    await db.query(`DELETE FROM platform_plans WHERE id = $1`, [request.params.id])
    await logAdminAction(auditFromRequest(request, 'plan.delete', request.params.id, `${plan.slug}`))
    return reply.send({ ok: true })
  })

  // ── Business Type Templates ──────────────────────────────────────────────────
  app.get('/business-type-templates', async (_request, reply) => {
    const { rows } = await db.query(`SELECT * FROM business_type_templates ORDER BY display_name`)
    return reply.send(rows)
  })

  app.post('/business-type-templates', async (request, reply) => {
    const { business_type, display_name, system_prompt, custom_instructions, tone } = request.body as any
    try {
      const { rows: [t] } = await db.query(
        `INSERT INTO business_type_templates (business_type, display_name, system_prompt, custom_instructions, tone)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [business_type, display_name, system_prompt ?? '', custom_instructions ?? '', tone ?? 'amigável e profissional']
      )
      await logAdminAction(auditFromRequest(request, 'template.create', t.id, `${business_type} — ${display_name}`))
      return reply.status(201).send(t)
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'Tipo de negócio já existe' })
      throw e
    }
  })

  app.patch<{ Params: { id: string } }>('/business-type-templates/:id', async (request, reply) => {
    const { display_name, system_prompt, custom_instructions, tone } = request.body as any
    const { rows: [t] } = await db.query(
      `UPDATE business_type_templates SET
         display_name        = COALESCE($1, display_name),
         system_prompt       = COALESCE($2, system_prompt),
         custom_instructions = COALESCE($3, custom_instructions),
         tone                = COALESCE($4, tone),
         updated_at          = NOW()
       WHERE id = $5 RETURNING *`,
      [display_name, system_prompt, custom_instructions, tone, request.params.id]
    )
    if (!t) return reply.status(404).send({ error: 'Template não encontrado' })
    const changed = Object.entries({ display_name, system_prompt, custom_instructions, tone })
      .filter(([, v]) => v !== undefined).map(([k]) => k)
    await logAdminAction(auditFromRequest(request, 'template.update', request.params.id, `${t.business_type} — campos: ${changed.join(', ')}`))
    return reply.send(t)
  })

  app.delete<{ Params: { id: string } }>('/business-type-templates/:id', async (request, reply) => {
    const { rows: [t] } = await db.query(
      `DELETE FROM business_type_templates WHERE id = $1 RETURNING business_type`,
      [request.params.id]
    )
    await logAdminAction(auditFromRequest(request, 'template.delete', request.params.id, t ? `${t.business_type}` : undefined))
    return reply.send({ ok: true })
  })

  // ── Revenue ──────────────────────────────────────────────────────────────────
  app.get('/revenue', async (_request, reply) => {
    const [monthly, planDist, recentSubs] = await Promise.all([
      db.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month,
          COUNT(*) as new_tenants,
          SUM(CASE WHEN plan='basico' THEN 8900 WHEN plan='premium' THEN 16900 WHEN plan='profissional' THEN 29900 ELSE 0 END) as mrr_cents
        FROM tenants WHERE status = 'active' AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at) ORDER BY month
      `),
      db.query(`
        SELECT plan,
          COUNT(*) as count,
          SUM(CASE WHEN plan='basico' THEN 8900 WHEN plan='premium' THEN 16900 WHEN plan='profissional' THEN 29900 ELSE 0 END) as revenue_cents
        FROM tenants WHERE status = 'active' GROUP BY plan
      `),
      db.query(`
        SELECT t.name as tenant_name, t.plan, s.status, s.next_billing_date, s.mp_subscription_id, t.created_at
        FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
        ORDER BY t.created_at DESC LIMIT 20
      `),
    ])

    return reply.send({ monthly: monthly.rows, by_plan: planDist.rows, recent_subscriptions: recentSubs.rows })
  })

  // ── Affiliates ───────────────────────────────────────────────────────────────
  app.get('/affiliates', async (_request, reply) => {
    const { rows } = await db.query(`
      SELECT a.*, u.name, u.email,
        (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) as referral_count,
        (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.paid_at IS NULL) as pending_count
      FROM affiliates a JOIN users u ON u.id = a.user_id
      ORDER BY a.pending_earnings DESC
    `)
    return reply.send(rows)
  })

  app.post<{ Params: { id: string } }>('/affiliates/:id/pay', async (request, reply) => {
    // Capture the amount being paid BEFORE zeroing it, for the audit trail.
    const { rows: [aff] } = await db.query(
      `SELECT pending_earnings FROM affiliates WHERE id = $1`, [request.params.id]
    )
    if (!aff) return reply.status(404).send({ error: 'Afiliado não encontrado' })
    await db.query(`UPDATE affiliate_referrals SET paid_at = NOW() WHERE affiliate_id = $1 AND paid_at IS NULL`, [request.params.id])
    await db.query(`UPDATE affiliates SET paid_earnings = paid_earnings + pending_earnings, pending_earnings = 0 WHERE id = $1`, [request.params.id])
    await logAdminAction(auditFromRequest(request, 'affiliate.pay', request.params.id, `valor: ${aff.pending_earnings}`))
    return reply.send({ ok: true })
  })

  // ── Support tickets (all tenants) ────────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>('/support/tickets', async (request, reply) => {
    const status = request.query.status
    if (status && !['open', 'resolved'].includes(status)) {
      return reply.status(400).send({ error: 'Status inválido' })
    }
    const params: any[] = []
    let where = ''
    if (status) { params.push(status); where = `WHERE st.status = $1` }
    const { rows } = await db.query(
      `SELECT st.id, st.tenant_id, t.name AS tenant_name, u.name AS requester_name,
              st.subject, st.status, st.priority, st.created_at, st.updated_at
       FROM support_tickets st
       JOIN tenants t ON t.id = st.tenant_id
       LEFT JOIN users u ON u.id = st.user_id
       ${where}
       ORDER BY st.updated_at DESC`,
      params
    )
    return reply.send(rows)
  })

  app.get<{ Params: { id: string } }>('/support/tickets/:id', async (request, reply) => {
    const { rows: [ticket] } = await db.query(
      `SELECT st.id, st.tenant_id, t.name AS tenant_name, u.name AS requester_name,
              st.subject, st.status, st.priority, st.created_at, st.updated_at
       FROM support_tickets st
       JOIN tenants t ON t.id = st.tenant_id
       LEFT JOIN users u ON u.id = st.user_id
       WHERE st.id = $1`,
      [request.params.id]
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

  app.post<{ Params: { id: string } }>('/support/tickets/:id/reply', async (request, reply) => {
    const body = String((request.body as any)?.body ?? '').trim()
    if (!body) return reply.status(400).send({ error: 'Mensagem obrigatória' })

    const { rows: [ticket] } = await db.query(
      `UPDATE support_tickets SET updated_at = NOW() WHERE id = $1
       RETURNING id, subject, status, priority, created_at, updated_at`,
      [request.params.id]
    )
    if (!ticket) return reply.status(404).send({ error: 'Chamado não encontrado' })

    const { rows: [message] } = await db.query(
      `INSERT INTO support_messages (ticket_id, sender, user_id, body)
       VALUES ($1, 'admin', $2, $3)
       RETURNING id, sender, body, created_at`,
      [ticket.id, request.user.user_id, body.slice(0, 8000)]
    )
    logAdminAction(auditFromRequest(request, 'support.reply', ticket.id, `Resposta no chamado "${ticket.subject}"`))
    return reply.status(201).send({ ticket, message })
  })

  app.patch<{ Params: { id: string } }>('/support/tickets/:id', async (request, reply) => {
    const status = (request.body as any)?.status
    if (!['open', 'resolved'].includes(status)) {
      return reply.status(400).send({ error: 'Status inválido (use open ou resolved)' })
    }
    const { rows: [ticket] } = await db.query(
      `UPDATE support_tickets SET status = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, tenant_id, subject, status, priority, created_at, updated_at`,
      [status, request.params.id]
    )
    if (!ticket) return reply.status(404).send({ error: 'Chamado não encontrado' })
    logAdminAction(auditFromRequest(request, 'support.status', ticket.id, `Chamado "${ticket.subject}" → ${status}`))
    return reply.send(ticket)
  })

  // ── Remote support: diagnose/fix a tenant's bot remotely ────────────────────

  // UUID guard for :id/:cid params — a malformed uuid must return 400, never
  // bubble up as a Postgres cast error (500).
  const isUuid = (v: string) => z.string().uuid().safeParse(v).success

  const pageParams = (q: any, defLimit = 50, maxLimit = 200) => ({
    limit: Math.min(Math.max(Number(q?.limit) || defLimit, 1), maxLimit),
    offset: Math.max(Number(q?.offset) || 0, 0),
  })

  // Conversations viewer — LGPD-sensitive (customer personal data + message
  // content), so EVERY access is audited.
  app.get<{ Params: { id: string } }>('/tenants/:id/conversations', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { limit, offset } = pageParams(request.query)

    const { rows: [tenant] } = await db.query(`SELECT id FROM tenants WHERE id = $1`, [id])
    if (!tenant) return reply.status(404).send({ error: 'Tenant não encontrado' })

    const { rows } = await db.query(
      `SELECT c.id, c.customer_id,
              cu.name AS customer_name, cu.last_name AS customer_last_name,
              cu.phone AS customer_phone,
              c.bot_paused_until,
              (c.bot_paused_until IS NOT NULL AND c.bot_paused_until > NOW()) AS bot_paused,
              c.updated_at,
              (SELECT LEFT(m.content, 160) FROM messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC LIMIT 1) AS last_message
       FROM conversations c
       JOIN customers cu ON cu.id = c.customer_id
       WHERE c.tenant_id = $1
       ORDER BY c.updated_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    )
    await logAdminAction(auditFromRequest(request, 'tenant.conversations.view', id, `${rows.length} conversas (offset ${offset})`))
    return reply.send({ data: rows, limit, offset })
  })

  // Messages of one conversation (read-only). tenant_id comes from the
  // conversation row itself — never from a client-supplied param.
  app.get<{ Params: { cid: string } }>('/conversations/:cid/messages', async (request, reply) => {
    const { cid } = request.params
    if (!isUuid(cid)) return reply.status(400).send({ error: 'ID inválido' })
    const { limit, offset } = pageParams(request.query)

    const { rows: [conv] } = await db.query(
      `SELECT id, tenant_id, customer_id FROM conversations WHERE id = $1`, [cid]
    )
    if (!conv) return reply.status(404).send({ error: 'Conversa não encontrada' })

    const { rows: messages } = await db.query(
      `SELECT id, role, content, created_at
       FROM messages WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [cid, limit, offset]
    )
    await logAdminAction(auditFromRequest(request, 'conversation.view', cid, `tenant ${conv.tenant_id}, ${messages.length} mensagens (offset ${offset})`))
    return reply.send({ conversation_id: cid, tenant_id: conv.tenant_id, data: messages, limit, offset })
  })

  // Persisted bot errors (migration 031) — newest first.
  app.get<{ Params: { id: string } }>('/tenants/:id/bot-errors', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { limit } = pageParams(request.query)
    try {
      const { rows } = await db.query(
        `SELECT id, conversation_id, kind, detail, created_at
         FROM bot_errors WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [id, limit]
      )
      return reply.send(rows)
    } catch {
      // bot_errors table not created yet (migration 031 pending) — empty list
      return reply.send([])
    }
  })

  // WhatsApp instance + live Evolution state. NEVER exposes Evolution url/key.
  app.get<{ Params: { id: string } }>('/tenants/:id/whatsapp', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { rows: [instance] } = await db.query(
      `SELECT instance_name, status, phone_number FROM whatsapp_instances WHERE tenant_id = $1`,
      [id]
    )
    if (!instance) return reply.send({ instance: null, live: null })
    const live = await evolutionConnectionState(instance.instance_name)
    return reply.send({ instance, live })
  })

  // Reconnect a tenant's WhatsApp — same flow as the tenant-facing
  // POST /whatsapp/connect (create instance if needed + fetch QR), but driven
  // by the Root Admin for the target tenant. Each call holds a slow (~18s)
  // upstream QR poll → same strict rate limit as the tenant route.
  app.post<{ Params: { id: string } }>('/tenants/:id/whatsapp/reconnect', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { rows: [tenant] } = await db.query(`SELECT id FROM tenants WHERE id = $1`, [id])
    if (!tenant) return reply.status(404).send({ error: 'Tenant não encontrado' })

    const instanceName = `tenant_${id.replace(/-/g, '')}`
    const evoCfg = await getEvolutionConfig()
    const secret = evoCfg.webhook_secret
    const webhookUrl = `${evoCfg.webhook_base}/webhook/whatsapp/${instanceName}${secret ? `?token=${encodeURIComponent(secret)}` : ''}`

    await db.query(
      `INSERT INTO whatsapp_instances (tenant_id, instance_name, status)
       VALUES ($1, $2, 'qr_pending')
       ON CONFLICT (tenant_id) DO UPDATE SET instance_name = $2, status = 'qr_pending'`,
      [id, instanceName]
    )
    await evolutionCreateInstance(instanceName, webhookUrl)
    const qrData = await evolutionGetQR(instanceName)

    await logAdminAction(auditFromRequest(request, 'tenant.whatsapp.reconnect', id, qrData ? 'QR gerado' : 'QR pendente'))
    if (qrData) {
      // Same cache the tenant app polls via GET /whatsapp/qr
      await redis.setex(`whatsapp:qr:${id}`, QR_CODE_TTL, JSON.stringify(qrData))
      return reply.send(qrData)
    }
    return reply.send({ qr_pending: true })
  })

  // Force-logout a tenant's WhatsApp session (unlinks the device).
  app.post<{ Params: { id: string } }>('/tenants/:id/whatsapp/logout', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { rows: [instance] } = await db.query(
      `SELECT instance_name FROM whatsapp_instances WHERE tenant_id = $1`, [id]
    )
    if (!instance) return reply.status(404).send({ error: 'Tenant sem instância de WhatsApp' })

    await evolutionLogout(instance.instance_name)
    await db.query(
      `UPDATE whatsapp_instances SET status = 'disconnected', phone_number = NULL WHERE tenant_id = $1`,
      [id]
    )
    await redis.del(`whatsapp:qr:${id}`)
    await logAdminAction(auditFromRequest(request, 'tenant.whatsapp.logout', id, instance.instance_name))
    return reply.send({ ok: true })
  })

  // Test the tenant's bot (DRY-RUN) — runs the real pipeline (prompt/tone/
  // business config + model routing) for a synthetic message. Nothing is
  // persisted and nothing is sent via WhatsApp (see testBotReply in services/bot).
  app.post<{ Params: { id: string } }>('/tenants/:id/test-bot', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { message } = z.object({ message: z.string().min(1).max(2000) }).parse(request.body ?? {})

    const { rows: [ac] } = await db.query(`SELECT tenant_id FROM agent_config WHERE tenant_id = $1`, [id])
    if (!ac) return reply.status(404).send({ error: 'Tenant sem configuração de agente' })

    const result = await testBotReply(id, message)
    await logAdminAction(auditFromRequest(request, 'tenant.test_bot', id, `dry-run (${message.length} chars)`))
    return reply.send({ reply: result.reply, dry_run: true })
  })

  // Clear a tenant's Redis caches (config/handoff/media/QR + bot contexts of
  // its recent conversations) so config changes take effect immediately.
  app.post<{ Params: { id: string } }>('/tenants/:id/clear-cache', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })

    let cleared = await redis.del(
      `tenant:config:${id}`, `tenant:handoff:${id}`, `tenant:media:${id}`, `whatsapp:qr:${id}`
    )
    // bot:context:{conversationId} for this tenant — bounded to the most recent
    // conversations (the context TTL is 30min, so recent ones cover the cache).
    try {
      const { rows } = await db.query(
        `SELECT id FROM conversations WHERE tenant_id = $1 ORDER BY updated_at DESC LIMIT 500`, [id]
      )
      const keys = (rows as any[]).map((r) => `bot:context:${r.id}`)
      for (let i = 0; i < keys.length; i += 100) {
        cleared += await redis.del(...keys.slice(i, i + 100))
      }
    } catch { /* cache cleanup is best-effort */ }

    await logAdminAction(auditFromRequest(request, 'tenant.cache.clear', id, `${cleared} chaves removidas`))
    return reply.send({ ok: true, cleared })
  })

  // AI usage of ONE tenant: current-month spend vs. the plan's cap (+ last 30
  // days per day). Complements the global GET /ai-usage dashboard.
  app.get<{ Params: { id: string } }>('/tenants/:id/ai-usage', async (request, reply) => {
    const { id } = request.params
    if (!isUuid(id)) return reply.status(400).send({ error: 'ID inválido' })
    const { rows: [tenant] } = await db.query(`SELECT plan FROM tenants WHERE id = $1`, [id])
    if (!tenant) return reply.status(404).send({ error: 'Tenant não encontrado' })

    const [spend, aiConfig] = await Promise.all([monthlySpend(id), getAiConfig()])
    const cap = Number(aiConfig.caps?.[tenant.plan] ?? 0)

    let recent: any[] = []
    try {
      const { rows } = await db.query(
        `SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
                SUM(cost_usd)::float AS cost,
                SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)::bigint AS tokens,
                COUNT(*)::int AS calls
         FROM ai_usage
         WHERE tenant_id = $1 AND created_at >= now() - interval '30 days'
         GROUP BY day ORDER BY day DESC`,
        [id]
      )
      recent = rows
    } catch { /* ai_usage table not created yet (migration 014 pending) */ }

    return reply.send({
      month_spend: spend,
      cap,                                       // 0 = unlimited
      plan: tenant.plan,
      hard_stop_at: cap > 0 ? cap * 1.5 : null,  // bot stops calling the model here
      recent,
    })
  })

  // ── Exportação de dados (CSV para Excel pt-BR) ──────────────────────────────
  // Excel pt-BR expects: UTF-8 BOM, ';' as separator, CRLF line endings and
  // decimal comma. Dates are formatted in America/Sao_Paulo by Postgres.
  const csvField = (v: string | number | null): string => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const toCsv = (headers: string[], rows: (string | number | null)[][]): string =>
    '\uFEFF' + [headers, ...rows].map((r) => r.map(csvField).join(';')).join('\r\n') + '\r\n'

  // NUMERIC comes back from pg as string — normalize to pt-BR decimal comma.
  const brNumber = (v: unknown): string => {
    const n = Number(v ?? 0)
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace('.', ',')
  }

  const sendCsv = (reply: any, name: string, csv: string) => {
    const date = new Date().toISOString().slice(0, 10)
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name}-${date}.csv"`)
      .send(csv)
  }

  const TENANT_STATUS_PT: Record<string, string> = {
    trial: 'Trial', active: 'Ativo', suspended: 'Suspenso', cancelled: 'Cancelado',
  }
  const APPT_STATUS_PT: Record<string, string> = {
    pending: 'Pendente', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado',
  }
  // Same plan prices used for the MRR calculation in GET /root/stats.
  const PLAN_PRICE: Record<string, number> = { basico: 89, premium: 169, profissional: 299, free: 0 }

  // All customers across all tenants, with attendance + revenue aggregates.
  app.get('/export/customers', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.name AS tenant_name,
             c.name, c.last_name, c.phone, c.email,
             COALESCE(ag.cnt, 0)::int          AS appointment_count,
             COALESCE(ag.total, 0)             AS total_value,
             ag.last_service,
             ag.last_at,
             to_char(c.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS created_at
      FROM customers c
      JOIN tenants t ON t.id = c.tenant_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS cnt,
               COALESCE(SUM(s.price), 0) AS total,
               (ARRAY_AGG(s.name ORDER BY a.starts_at DESC))[1] AS last_service,
               to_char(MAX(a.starts_at) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS last_at
        FROM appointments a
        LEFT JOIN services s ON s.id = a.service_id
        WHERE a.customer_id = c.id AND a.status != 'cancelled'
      ) ag ON TRUE
      ORDER BY t.name, c.name
    `)
    const csv = toCsv(
      ['Estabelecimento', 'Nome', 'Sobrenome', 'Telefone', 'E-mail',
       'Nº de atendimentos', 'Valor total', 'Último serviço', 'Último atendimento', 'Cliente desde'],
      (rows as any[]).map((r) => [
        r.tenant_name, r.name, r.last_name, r.phone, r.email,
        r.appointment_count, brNumber(r.total_value), r.last_service, r.last_at, r.created_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.customers', 'csv', `${rows.length} clientes`))
    return sendCsv(reply, 'clientes', csv)
  })

  // All tenants with owner, contact, address and usage counters.
  app.get('/export/tenants', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.name, t.slug,
             btt.display_name AS business_type_name,
             t.plan, t.status,
             u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
             t.contact_email, t.contact_phone, t.responsible_name,
             ac.address, ac.neighborhood, ac.city, ac.state,
             (SELECT COUNT(*) FROM user_roles ur WHERE ur.tenant_id = t.id)::int   AS user_count,
             (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id)::int   AS appointment_count,
             wi.status AS whatsapp_status,
             to_char(t.trial_ends_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS trial_ends_at,
             to_char(t.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS created_at
      FROM tenants t
      LEFT JOIN user_roles ur2 ON ur2.tenant_id = t.id AND ur2.role = 'owner'
      LEFT JOIN users u ON u.id = ur2.user_id
      LEFT JOIN agent_config ac ON ac.tenant_id = t.id
      LEFT JOIN business_type_templates btt ON btt.business_type = ac.business_type
      LEFT JOIN whatsapp_instances wi ON wi.tenant_id = t.id
      ORDER BY t.created_at DESC
    `)
    const csv = toCsv(
      ['Nome', 'Slug', 'Tipo de negócio', 'Plano', 'Status',
       'Dono', 'E-mail do dono', 'Telefone do dono',
       'E-mail de contato', 'Telefone de contato', 'Responsável', 'Endereço',
       'Nº de usuários', 'Nº de agendamentos', 'WhatsApp', 'Trial até', 'Criado em'],
      (rows as any[]).map((r) => [
        r.name, r.slug, r.business_type_name, r.plan,
        TENANT_STATUS_PT[r.status] ?? r.status,
        r.owner_name, r.owner_email, r.owner_phone,
        r.contact_email, r.contact_phone, r.responsible_name,
        [r.address, r.neighborhood, r.city, r.state].filter(Boolean).join(', ') || null,
        r.user_count, r.appointment_count, r.whatsapp_status, r.trial_ends_at, r.created_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.tenants', 'csv', `${rows.length} tenants`))
    return sendCsv(reply, 'estabelecimentos', csv)
  })

  // All appointments (financial view) — price comes from services via service_id.
  app.get('/export/appointments', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS date,
             to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI')    AS time,
             t.name AS tenant_name,
             TRIM(CONCAT(c.name, ' ', COALESCE(c.last_name, ''))) AS customer_name,
             c.phone AS customer_phone,
             s.name AS service_name,
             p.name AS professional_name,
             s.price,
             a.status,
             to_char(a.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS created_at
      FROM appointments a
      JOIN tenants t ON t.id = a.tenant_id
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN services s ON s.id = a.service_id
      LEFT JOIN professionals p ON p.id = a.professional_id
      ORDER BY a.starts_at DESC
    `)
    const csv = toCsv(
      ['Data', 'Hora', 'Estabelecimento', 'Cliente', 'Telefone do cliente',
       'Serviço', 'Profissional', 'Valor', 'Status', 'Criado em'],
      (rows as any[]).map((r) => [
        r.date, r.time, r.tenant_name, r.customer_name, r.customer_phone,
        r.service_name, r.professional_name,
        r.price !== null && r.price !== undefined ? brNumber(r.price) : null,
        APPT_STATUS_PT[r.status] ?? r.status, r.created_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.appointments', 'csv', `${rows.length} agendamentos`))
    return sendCsv(reply, 'agendamentos', csv)
  })

  // Subscription/revenue data per tenant (includes tenants without subscription).
  app.get('/export/subscriptions', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.name AS tenant_name, t.plan,
             s.status AS subscription_status,
             to_char(s.next_billing_date, 'DD/MM/YYYY') AS next_billing_date,
             s.mp_subscription_id
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      ORDER BY t.name
    `)
    const csv = toCsv(
      ['Estabelecimento', 'Plano', 'Status da assinatura', 'Próxima cobrança',
       'ID Mercado Pago', 'Valor do plano'],
      (rows as any[]).map((r) => [
        r.tenant_name, r.plan, r.subscription_status, r.next_billing_date,
        r.mp_subscription_id, brNumber(PLAN_PRICE[r.plan] ?? 0),
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.subscriptions', 'csv', `${rows.length} tenants`))
    return sendCsv(reply, 'assinaturas', csv)
  })

  const COMMISSION_STATUS_PT: Record<string, string> = { pending: 'Pendente', paid: 'Pago' }
  const COMMISSION_TYPE_PT: Record<string, string> = { percent: 'Percentual (%)', fixed: 'Fixo (R$)' }

  // All generated commissions (one per completed appointment) across tenants.
  app.get('/export/commissions', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.name AS tenant_name,
             p.name AS professional_name,
             s.name AS service_name,
             TRIM(CONCAT(c.name, ' ', COALESCE(c.last_name, ''))) AS customer_name,
             co.service_price, co.commission_type, co.commission_value, co.amount, co.status,
             to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS service_at,
             to_char(co.paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')  AS paid_at
      FROM commissions co
      JOIN tenants t ON t.id = co.tenant_id
      JOIN professionals p ON p.id = co.professional_id
      LEFT JOIN services s ON s.id = co.service_id
      JOIN appointments a ON a.id = co.appointment_id
      LEFT JOIN customers c ON c.id = a.customer_id
      ORDER BY a.starts_at DESC
    `)
    const csv = toCsv(
      ['Estabelecimento', 'Profissional', 'Serviço', 'Cliente', 'Preço do serviço',
       'Tipo de comissão', 'Valor configurado', 'Comissão (R$)', 'Status',
       'Data do atendimento', 'Pago em'],
      (rows as any[]).map((r) => [
        r.tenant_name, r.professional_name, r.service_name, r.customer_name,
        brNumber(r.service_price),
        COMMISSION_TYPE_PT[r.commission_type] ?? r.commission_type,
        brNumber(r.commission_value), brNumber(r.amount),
        COMMISSION_STATUS_PT[r.status] ?? r.status,
        r.service_at, r.paid_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.commissions', 'csv', `${rows.length} comissões`))
    return sendCsv(reply, 'comissoes', csv)
  })

  // Service catalog across tenants: price, duration, commission setup, usage.
  app.get('/export/services', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.name AS tenant_name,
             s.name, s.price, s.duration_minutes, s.reminder_days, s.active,
             (SELECT COUNT(*) FROM service_professionals sp WHERE sp.service_id = s.id)::int AS professional_count,
             (SELECT STRING_AGG(
                       p.name || ': ' ||
                       CASE WHEN sp.commission_type = 'percent'
                            THEN REPLACE(sp.commission_value::text, '.', ',') || '%'
                            ELSE 'R$ ' || REPLACE(sp.commission_value::text, '.', ',') END,
                       '; ' ORDER BY p.name)
              FROM service_professionals sp
              JOIN professionals p ON p.id = sp.professional_id
              WHERE sp.service_id = s.id AND sp.commission_enabled) AS commissions_configured,
             (SELECT COUNT(*) FROM appointments a
              WHERE a.service_id = s.id AND a.status != 'cancelled')::int AS appointment_count,
             to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS created_at
      FROM services s
      JOIN tenants t ON t.id = s.tenant_id
      ORDER BY t.name, s.name
    `)
    const csv = toCsv(
      ['Estabelecimento', 'Serviço', 'Preço', 'Duração (min)', 'Lembrete (dias)',
       'Ativo', 'Nº de profissionais', 'Comissões configuradas', 'Nº de atendimentos', 'Criado em'],
      (rows as any[]).map((r) => [
        r.tenant_name, r.name, brNumber(r.price), r.duration_minutes, r.reminder_days,
        r.active ? 'Sim' : 'Não', r.professional_count, r.commissions_configured,
        r.appointment_count, r.created_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.services', 'csv', `${rows.length} serviços`))
    return sendCsv(reply, 'servicos', csv)
  })

  // Professionals across tenants: linked user, services attended, workload.
  app.get('/export/professionals', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT t.name AS tenant_name,
             p.name, p.phone, p.active,
             u.name AS user_name, u.email AS user_email,
             (SELECT STRING_AGG(s.name, '; ' ORDER BY s.name)
              FROM service_professionals sp
              JOIN services s ON s.id = sp.service_id
              WHERE sp.professional_id = p.id) AS services,
             (SELECT COUNT(*) FROM appointments a
              WHERE a.professional_id = p.id AND a.status != 'cancelled')::int AS appointment_count,
             (SELECT COALESCE(SUM(co.amount), 0) FROM commissions co
              WHERE co.professional_id = p.id AND co.status = 'pending') AS pending_commissions,
             to_char(p.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS created_at
      FROM professionals p
      JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY t.name, p.name
    `)
    const csv = toCsv(
      ['Estabelecimento', 'Profissional', 'Telefone', 'Ativo',
       'Usuário vinculado', 'E-mail do usuário', 'Serviços que atende',
       'Nº de agendamentos', 'Comissões pendentes (R$)', 'Criado em'],
      (rows as any[]).map((r) => [
        r.tenant_name, r.name, r.phone, r.active ? 'Sim' : 'Não',
        r.user_name, r.user_email, r.services,
        r.appointment_count, brNumber(r.pending_commissions), r.created_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.professionals', 'csv', `${rows.length} profissionais`))
    return sendCsv(reply, 'profissionais', csv)
  })

  // Affiliates + their referrals (one row per referral; affiliates with no
  // referral still appear with empty referral columns). Earnings are BRL cents.
  app.get('/export/affiliates', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT u.name AS affiliate_name, u.email AS affiliate_email,
             a.referral_code, a.pending_earnings, a.paid_earnings,
             t.name AS referred_tenant, t.plan AS referred_plan, t.status AS referred_status,
             ar.commission_brl,
             to_char(ar.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS referred_at,
             to_char(ar.paid_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY')    AS commission_paid_at,
             CASE WHEN ar.id IS NULL THEN NULL
                  WHEN ar.paid_at IS NULL THEN 'Pendente' ELSE 'Pago' END AS commission_status
      FROM affiliates a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN affiliate_referrals ar ON ar.affiliate_id = a.id
      LEFT JOIN tenants t ON t.id = ar.tenant_id
      ORDER BY u.name, ar.created_at DESC NULLS LAST
    `)
    const csv = toCsv(
      ['Afiliado', 'E-mail', 'Código de indicação',
       'Estabelecimento indicado', 'Plano do indicado', 'Status do indicado',
       'Comissão da indicação (R$)', 'Status da comissão', 'Indicado em', 'Comissão paga em',
       'Ganhos pendentes (R$)', 'Ganhos pagos (R$)'],
      (rows as any[]).map((r) => [
        r.affiliate_name, r.affiliate_email, r.referral_code,
        r.referred_tenant, r.referred_plan,
        r.referred_status ? (TENANT_STATUS_PT[r.referred_status] ?? r.referred_status) : null,
        r.commission_brl !== null && r.commission_brl !== undefined ? brNumber(Number(r.commission_brl) / 100) : null,
        r.commission_status, r.referred_at, r.commission_paid_at,
        brNumber(Number(r.pending_earnings) / 100), brNumber(Number(r.paid_earnings) / 100),
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.affiliates', 'csv', `${rows.length} linhas`))
    return sendCsv(reply, 'afiliados', csv)
  })

  // All platform users with their roles per tenant.
  app.get('/export/users', async (request, reply) => {
    const { rows } = await db.query(`
      SELECT u.name, u.email, u.phone, u.email_verified,
             u.google_sub IS NOT NULL AS has_google,
             (SELECT STRING_AGG(DISTINCT ur.role, ', ')
              FROM user_roles ur WHERE ur.user_id = u.id) AS roles,
             (SELECT STRING_AGG(t.name || ' (' || ur.role || ')', '; ' ORDER BY t.name || ' (' || ur.role || ')')
              FROM user_roles ur JOIN tenants t ON t.id = ur.tenant_id
              WHERE ur.user_id = u.id) AS tenants,
             to_char(u.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS created_at
      FROM users u
      ORDER BY u.created_at DESC
    `)
    const csv = toCsv(
      ['Nome', 'E-mail', 'Telefone', 'Papéis', 'Estabelecimentos',
       'E-mail verificado', 'Login Google', 'Criado em'],
      (rows as any[]).map((r) => [
        r.name, r.email, r.phone, r.roles, r.tenants,
        r.email_verified ? 'Sim' : 'Não', r.has_google ? 'Sim' : 'Não', r.created_at,
      ])
    )
    await logAdminAction(auditFromRequest(request, 'export.users', 'csv', `${rows.length} usuários`))
    return sendCsv(reply, 'usuarios', csv)
  })

  // AI cost x revenue per tenant (current month, America/Sao_Paulo) — lets the
  // platform owner spot tenants whose AI cost eats the plan margin.
  app.get('/export/ai-usage', async (request, reply) => {
    const { rows: [cfg] } = await db.query("SELECT value FROM platform_settings WHERE key = 'ai_config'")
    const usdBrl = Number(cfg?.value?.usd_brl_rate ?? 6)

    let rows: any[] = []
    try {
      const res = await db.query(`
        SELECT COALESCE(t.name, '(desconhecido)') AS tenant_name,
               t.plan, t.status,
               SUM(u.cost_usd)::float AS cost_usd,
               SUM(u.input_tokens + u.output_tokens + u.cache_read_tokens + u.cache_write_tokens)::bigint AS tokens,
               COUNT(*)::int AS calls
        FROM ai_usage u
        LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE date_trunc('month', u.created_at AT TIME ZONE 'America/Sao_Paulo')
            = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
        GROUP BY u.tenant_id, t.name, t.plan, t.status
        ORDER BY cost_usd DESC
      `)
      rows = res.rows
    } catch { /* ai_usage table not created yet (migration 014 pending) — empty CSV */ }

    const csv = toCsv(
      ['Estabelecimento', 'Plano', 'Status', 'Receita do plano (R$/mês)',
       'Custo IA (US$)', 'Custo IA (R$)', 'Margem estimada (R$)',
       'Tokens', 'Nº de chamadas IA', 'Câmbio US$→R$'],
      rows.map((r) => {
        const costUsd = Number(r.cost_usd ?? 0)
        const costBrl = costUsd * usdBrl
        const planPrice = PLAN_PRICE[r.plan] ?? 0
        return [
          r.tenant_name, r.plan,
          r.status ? (TENANT_STATUS_PT[r.status] ?? r.status) : null,
          brNumber(planPrice),
          costUsd.toFixed(4).replace('.', ','), brNumber(costBrl), brNumber(planPrice - costBrl),
          Number(r.tokens), r.calls, brNumber(usdBrl),
        ]
      })
    )
    await logAdminAction(auditFromRequest(request, 'export.ai_usage', 'csv', `${rows.length} tenants (mês atual)`))
    return sendCsv(reply, 'uso-ia', csv)
  })

  // ── Comunicados (broadcasts) ────────────────────────────────────────────────
  // Envia um aviso a todos os proprietários ou a todos os usuários, pelos canais
  // escolhidos (aviso no sistema, e-mail e/ou WhatsApp).
  const broadcastSchema = z.object({
    title: z.string().min(1).max(140),
    body: z.string().min(1).max(2000),
    link: z.string().max(500).optional(),
    target: z.enum(['owners', 'all']),
    channels: z.array(z.enum(['inapp', 'push', 'email', 'whatsapp'])).min(1),
  })

  app.post('/broadcasts', async (request, reply) => {
    const { title, body, link, target, channels } = broadcastSchema.parse(request.body)
    const result = await sendBroadcast({
      title, body, link: link || null, target, channels,
      createdBy: request.user.user_id,
    })
    await logAdminAction(auditFromRequest(request, 'broadcast.send', result.broadcastId ?? 'n/a',
      `alvo=${target}, canais=${channels.join('+')}, destinatários=${result.recipients}`))
    return reply.send({ ok: true, recipients: result.recipients, id: result.broadcastId })
  })

  app.get('/broadcasts', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT b.id, b.title, b.body, b.link, b.target, b.channels, b.recipients_count,
              b.created_at, u.name AS created_by_name
       FROM broadcasts b
       LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.created_at DESC LIMIT 50`
    )
    return reply.send(rows)
  })

  // ── Taxonomia de subtipos de despesa (parâmetros da plataforma) ─────────────
  app.get('/expense-subtypes', async (_request, reply) => {
    const { rows } = await db.query('SELECT * FROM expense_subtypes ORDER BY tipo, sort, nome')
    return reply.send(rows)
  })

  const subtypeSchema = z.object({
    tipo: z.enum(['Fixa', 'Variável']),
    nome: z.string().min(1).max(60),
    is_percent: z.boolean().optional(),
    color: z.string().max(9).optional(),
    icon: z.string().max(40).optional(),
    sort: z.number().int().optional(),
    active: z.boolean().optional(),
  })

  app.post('/expense-subtypes', async (request, reply) => {
    const b = subtypeSchema.parse(request.body)
    const { rows: [row] } = await db.query(
      `INSERT INTO expense_subtypes (tipo, nome, is_percent, color, icon, sort, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [b.tipo, b.nome, b.is_percent ?? false, b.color ?? '#6B7280', b.icon ?? null, b.sort ?? 0, b.active ?? true]
    )
    await logAdminAction(auditFromRequest(request, 'expense_subtype.create', row.id, `${b.tipo}/${b.nome}`))
    return reply.status(201).send(row)
  })

  app.patch<{ Params: { id: string } }>('/expense-subtypes/:id', async (request, reply) => {
    const b = subtypeSchema.partial().parse(request.body)
    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1
    for (const [k, v] of Object.entries(b)) { sets.push(`${k} = $${i++}`); vals.push(v) }
    if (sets.length === 0) return reply.status(400).send({ error: 'Nada para atualizar' })
    vals.push(request.params.id)
    const { rows: [row] } = await db.query(`UPDATE expense_subtypes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals)
    if (!row) return reply.status(404).send({ error: 'Subtipo não encontrado' })
    await logAdminAction(auditFromRequest(request, 'expense_subtype.update', request.params.id, `campos: ${Object.keys(b).join(', ')}`))
    return reply.send(row)
  })

  app.delete<{ Params: { id: string } }>('/expense-subtypes/:id', async (request, reply) => {
    await db.query('DELETE FROM expense_subtypes WHERE id = $1', [request.params.id])
    await logAdminAction(auditFromRequest(request, 'expense_subtype.delete', request.params.id, ''))
    return reply.send({ deleted: true })
  })

  // ── Formas de pagamento (parâmetros da plataforma) ──────────────────────────
  app.get('/payment-methods', async (_request, reply) => {
    const { rows } = await db.query('SELECT key, label, active, sort FROM payment_method_types ORDER BY sort, label')
    return reply.send(rows)
  })

  app.post('/payment-methods', async (request, reply) => {
    const b = z.object({ key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/), label: z.string().min(1).max(60), sort: z.number().int().optional() }).parse(request.body)
    const { rows: [row] } = await db.query(
      `INSERT INTO payment_method_types (key, label, sort) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label RETURNING *`,
      [b.key, b.label, b.sort ?? 0]
    )
    await logAdminAction(auditFromRequest(request, 'payment_method.create', b.key, b.label))
    return reply.status(201).send(row)
  })

  app.patch<{ Params: { key: string } }>('/payment-methods/:key', async (request, reply) => {
    const b = z.object({ label: z.string().min(1).max(60).optional(), active: z.boolean().optional(), sort: z.number().int().optional() }).parse(request.body)
    const sets: string[] = []; const vals: unknown[] = []; let i = 1
    for (const [k, v] of Object.entries(b)) { sets.push(`${k} = $${i++}`); vals.push(v) }
    if (sets.length === 0) return reply.status(400).send({ error: 'Nada para atualizar' })
    vals.push(request.params.key)
    const { rows: [row] } = await db.query(`UPDATE payment_method_types SET ${sets.join(', ')} WHERE key = $${i} RETURNING *`, vals)
    if (!row) return reply.status(404).send({ error: 'Forma de pagamento não encontrada' })
    await logAdminAction(auditFromRequest(request, 'payment_method.update', request.params.key, Object.keys(b).join(', ')))
    return reply.send(row)
  })

  app.delete<{ Params: { key: string } }>('/payment-methods/:key', async (request, reply) => {
    await db.query('DELETE FROM payment_method_types WHERE key = $1', [request.params.key])
    await logAdminAction(auditFromRequest(request, 'payment_method.delete', request.params.key, ''))
    return reply.send({ deleted: true })
  })

  // ── Saúde financeira de um tenant (mês atual) para os relatórios do Root ────
  app.get<{ Params: { id: string } }>('/tenants/:id/financeiro', async (request, reply) => {
    const tenantId = request.params.id
    const spNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    const y = spNow.getFullYear(), m = spNow.getMonth() + 1
    const pad = (n: number) => String(n).padStart(2, '0')
    const start = `${y}-${pad(m)}-01`
    const end = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`
    const { rows: [tot] } = await db.query(
      `SELECT COUNT(*) FILTER (WHERE a.status='completed')::int AS n,
              COALESCE(SUM(ROUND(COALESCE(a.price_snapshot, s.price) * (1 - COALESCE(pf.pct,0)/100), 2)) FILTER (WHERE a.status='completed'),0)::float AS receita
       FROM appointments a JOIN services s ON s.id=a.service_id
       LEFT JOIN tenant_payment_fees pf ON pf.tenant_id = a.tenant_id AND pf.method_key = a.payment_method
       WHERE a.tenant_id=$1 AND a.starts_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
         AND a.starts_at < ($3::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
      [tenantId, start, end]
    )
    const receitaVendas = Number(tot.receita), numVendas = Number(tot.n)
    const ticket = numVendas ? receitaVendas / numVendas : 0
    const ex = await computeFinanceExtras(tenantId, y, m, receitaVendas, numVendas, Math.round(ticket))
    return reply.send({
      mes: m, ano: y,
      receita_vendas: receitaVendas,
      num_vendas: numVendas,
      ...ex,
    })
  })
}
