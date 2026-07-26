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

// Secret fields (per platform_settings key) that must be encrypted at rest and
// never returned in full to the admin panel.
const SECRET_FIELDS: Record<string, string[]> = {
  payment_config: ['mp_access_token', 'mp_webhook_secret'],
  ai_config: ['api_key', 'transcription_api_key'],
  evolution_config: ['key', 'webhook_secret'],
  smtp_config: ['pass'],
  email_config: ['resend_api_key'],
  google_config: ['client_secret'],
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
          (SELECT COUNT(*) FROM user_roles ur WHERE ur.tenant_id = t.id) as user_count,
          (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = t.id) as appointment_count,
          wi.status as whatsapp_status
        FROM tenants t
        LEFT JOIN user_roles ur2 ON ur2.tenant_id = t.id AND ur2.role = 'owner'
        LEFT JOIN users u ON u.id = ur2.user_id
        LEFT JOIN whatsapp_instances wi ON wi.tenant_id = t.id
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
}
