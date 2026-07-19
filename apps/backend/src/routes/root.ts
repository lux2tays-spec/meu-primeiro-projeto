import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { db } from '../lib/db'
import { hashPassword } from '../lib/password'
import { invalidateAiConfig } from '../lib/botConfig'
import { redis } from '../lib/redis'
import { encrypt, decrypt, maskSecret } from '../lib/crypto'
import { logAdminAction, auditFromRequest } from '../lib/auditLog'

// Secret fields (per platform_settings key) that must be encrypted at rest and
// never returned in full to the admin panel.
const SECRET_FIELDS: Record<string, string[]> = {
  payment_config: ['mp_access_token', 'mp_webhook_secret'],
  ai_config: ['api_key', 'transcription_api_key'],
  evolution_config: ['key', 'webhook_secret'],
  smtp_config: ['pass'],
  google_config: ['client_secret'],
}
import { invalidatePaymentConfig } from '../lib/paymentConfig'
import {
  invalidateEvolutionConfig,
  invalidateSmtpConfig,
  invalidateGoogleConfig,
} from '../lib/integrationConfig'

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
    const { plan, status, max_agendas, max_users, trial_ends_at } = tenantPatchSchema.parse(request.body ?? {})
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
    return reply.send(tenant)
  })

  // Tenant staff: add
  app.post<{ Params: { id: string } }>('/tenants/:id/staff', async (request, reply) => {
    const { user_id, role } = request.body as any
    await db.query(
      `INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
      [user_id, request.params.id, role]
    )
    return reply.status(201).send({ ok: true })
  })

  // Tenant staff: edit user info + role
  app.patch<{ Params: { id: string; userId: string } }>('/tenants/:id/staff/:userId', async (request, reply) => {
    const { name, email, phone, role } = request.body as any
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
    return reply.send({ ok: true })
  })

  // Tenant staff: remove
  app.delete<{ Params: { id: string; userId: string } }>('/tenants/:id/staff/:userId', async (request, reply) => {
    await db.query(
      `DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role != 'owner'`,
      [request.params.id, request.params.userId]
    )
    return reply.send({ ok: true })
  })

  // Extend tenant trial
  app.post<{ Params: { id: string } }>('/tenants/:id/extend-trial', async (request, reply) => {
    const { days = 7 } = request.body as any
    await db.query(
      `UPDATE tenants SET trial_ends_at = COALESCE(trial_ends_at, NOW()) + ($1 || ' days')::interval, status = 'trial' WHERE id = $2`,
      [days, request.params.id]
    )
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
      return reply.send(user)
    } catch (e: any) {
      if (e.code === '23505') return reply.status(409).send({ error: 'E-mail já cadastrado' })
      throw e
    }
  })

  // Delete user
  app.delete<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
    const { rows: [user] } = await db.query(`SELECT id FROM users WHERE id = $1`, [request.params.id])
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })
    await db.query(`DELETE FROM users WHERE id = $1`, [request.params.id])
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
    if (key === 'payment_config') await invalidatePaymentConfig()
    if (key === 'evolution_config') await invalidateEvolutionConfig()
    if (key === 'smtp_config') await invalidateSmtpConfig()
    if (key === 'google_config') await invalidateGoogleConfig()
    // Governance: record WHO changed the config (secret values never logged).
    const changed = body && typeof body === 'object' ? Object.keys(body).join(', ') : ''
    await logAdminAction(auditFromRequest(request, 'settings.update', key, `campos: ${changed}`))
    return reply.send({ ok: true })
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
    await redis.keys('tenant:media:*').then((keys) => keys.length && redis.del(...keys)).catch(() => {})
    return reply.send(plan)
  })

  app.delete<{ Params: { id: string } }>('/plans/:id', async (request, reply) => {
    const { rows: [plan] } = await db.query(`SELECT slug FROM platform_plans WHERE id = $1`, [request.params.id])
    if (!plan) return reply.status(404).send({ error: 'Plano não encontrado' })
    if (['free', 'basico', 'premium', 'profissional'].includes(plan.slug)) {
      return reply.status(400).send({ error: 'Planos padrão não podem ser excluídos' })
    }
    await db.query(`DELETE FROM platform_plans WHERE id = $1`, [request.params.id])
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
    return reply.send(t)
  })

  app.delete<{ Params: { id: string } }>('/business-type-templates/:id', async (request, reply) => {
    await db.query(`DELETE FROM business_type_templates WHERE id = $1`, [request.params.id])
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
    await db.query(`UPDATE affiliate_referrals SET paid_at = NOW() WHERE affiliate_id = $1 AND paid_at IS NULL`, [request.params.id])
    await db.query(`UPDATE affiliates SET paid_earnings = paid_earnings + pending_earnings, pending_earnings = 0 WHERE id = $1`, [request.params.id])
    return reply.send({ ok: true })
  })
}
