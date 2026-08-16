import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { redis } from '../lib/redis'
import { hashPassword } from '../lib/password'
import { bumpTokenVersion } from '../lib/tokenVersion'
import { encrypt, decrypt, maskSecret } from '../lib/crypto'

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  duration_minutes: z.number().int().positive(),
  price: z.number().nonnegative(),
  reminder_days: z.number().int().min(0).nullable().optional(),
  // CFG-16: pausar/reativar o serviço sem excluir (a coluna services.active já
  // existia, mas só o DELETE a usava). false = pausado: some do bot e das
  // listagens padrão, mas o histórico/vínculos ficam intactos.
  active: z.boolean().optional(),
  // Serviço OCULTO (avulso criado no agendamento) — não aparece no catálogo.
  hidden: z.boolean().optional(),
  // Legacy shape (no commission): just the professional ids.
  professional_ids: z.array(z.string().uuid()).optional(),
  // Rich shape (#3): per-professional commission for this service.
  professionals: z.array(z.object({
    id: z.string().uuid(),
    commission_enabled: z.boolean().optional(),
    commission_type: z.enum(['percent', 'fixed']).optional(),
    commission_value: z.number().nonnegative().optional(),
  })).optional(),
})

type ServiceProInput = { id: string; commission_enabled?: boolean; commission_type?: string; commission_value?: number }

const hoursRowSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  enabled: z.boolean(),
}).refine(
  // CFG-5: abertura precisa vir antes do fechamento (comparação lexicográfica
  // funciona para HH:MM). Só valida dias habilitados — dias desligados podem
  // vir com placeholders.
  (r) => !r.enabled || r.start_time < r.end_time,
  { message: 'O horário de abertura deve ser antes do horário de fechamento' }
)

const staffCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'staff']),
})

const staffUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).nullable().optional(),
  role: z.enum(['owner', 'admin', 'staff']).optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nenhum campo para atualizar' })

const birthDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().optional()

const customerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  last_name: z.string().max(120).optional().nullable(),
  phone: z.string().min(8).max(30),
  email: z.string().email().or(z.literal('')).nullable().optional(),
  birth_date: birthDateSchema,
})

// Update: only keys present in the body are applied; empty string CLEARS the
// field (stored as NULL) — unlike COALESCE, which would keep the old value.
// SAL-7: `phone` também é editável (corrigir número digitado errado pelo bot
// ou pelo cadastro manual). É normalizado para só dígitos no handler.
const customerUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  last_name: z.string().max(120).nullable().optional(),
  email: z.string().email().or(z.literal('')).nullable().optional(),
  phone: z.string().min(8).max(30).optional(),
  birth_date: birthDateSchema,
})

// SAL-7: normaliza telefone para o padrão armazenado (só dígitos, como o bot
// grava a partir do JID do WhatsApp: 55 + DDD + número). Retorna null se o
// resultado não tiver um tamanho plausível para número BR (10–13 dígitos).
function normalizePhoneBR(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 13) return null
  return digits
}

const businessSchema = z.object({
  name: z.string().min(1).max(120),
  contact_email: z.string().email().or(z.literal('')).nullable().optional(),
  contact_phone: z.string().max(30).nullable().optional(),
  responsible_name: z.string().max(120).nullable().optional(),
})

export const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)

  // ── Tenant info ──────────────────────────────────────────────────────────

  app.get('/me', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [tenant] } = await db.query(
      `SELECT id, name, slug, plan, status, trial_ends_at, max_agendas, max_users,
              contact_email, contact_phone, responsible_name
       FROM tenants WHERE id = $1`,
      [tenant_id]
    )
    return reply.send(tenant)
  })

  app.put('/business', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = businessSchema.parse(request.body)
    const { rows: [tenant] } = await db.query(
      `UPDATE tenants SET
         name = $1,
         contact_email = $2,
         contact_phone = $3,
         responsible_name = $4
       WHERE id = $5
       RETURNING id, name, slug, plan, status, contact_email, contact_phone, responsible_name`,
      [
        body.name,
        body.contact_email || null,
        body.contact_phone || null,
        body.responsible_name || null,
        tenant_id,
      ]
    )
    if (!tenant) return reply.status(404).send({ error: 'Negócio não encontrado' })
    return reply.send(tenant)
  })

  // ── Services ─────────────────────────────────────────────────────────────

  app.get('/services', async (request, reply) => {
    const { tenant_id } = request.user
    // CFG-16: as telas de gestão pedem também os inativos (?include_inactive=1)
    // para permitir reativar; os demais consumidores seguem vendo só os ativos.
    const { include_inactive } = request.query as { include_inactive?: string }
    const includeInactive = include_inactive === '1' || include_inactive === 'true'
    const { rows } = await db.query(
      `SELECT s.*,
         COALESCE(
           json_agg(json_build_object(
             'id', p.id, 'name', p.name,
             'commission_enabled', sp.commission_enabled,
             'commission_type', sp.commission_type,
             'commission_value', sp.commission_value
           ) ORDER BY p.name)
             FILTER (WHERE p.id IS NOT NULL),
           '[]'
         ) AS professionals
       FROM services s
       LEFT JOIN service_professionals sp ON sp.service_id = s.id
       LEFT JOIN professionals p ON p.id = sp.professional_id AND p.active = TRUE
       WHERE s.tenant_id = $1 AND s.hidden = FALSE ${includeInactive ? '' : 'AND s.active = TRUE'}
       GROUP BY s.id
       ORDER BY s.active DESC, s.name`,
      [tenant_id]
    )
    return reply.send(rows)
  })

  async function syncServiceProfessionals(client: any, serviceId: string, tenantId: string, pros: ServiceProInput[]) {
    await client.query('DELETE FROM service_professionals WHERE service_id = $1', [serviceId])
    for (const p of pros) {
      const { rows: [pro] } = await client.query(
        'SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2 AND active = TRUE',
        [p.id, tenantId]
      )
      if (pro) {
        await client.query(
          `INSERT INTO service_professionals (service_id, professional_id, commission_enabled, commission_type, commission_value)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (service_id, professional_id) DO UPDATE SET
             commission_enabled = EXCLUDED.commission_enabled,
             commission_type = EXCLUDED.commission_type,
             commission_value = EXCLUDED.commission_value`,
          [serviceId, p.id, p.commission_enabled ?? false, p.commission_type ?? 'percent', p.commission_value ?? 0]
        )
      }
    }
  }

  // Accept either the rich `professionals` array (with commission) or the legacy
  // `professional_ids`. Returns the normalized list, or undefined if neither given.
  function normalizePros(body: { professionals?: ServiceProInput[]; professional_ids?: string[] }): ServiceProInput[] | undefined {
    if (body.professionals !== undefined) return body.professionals
    if (body.professional_ids !== undefined) return body.professional_ids.map((id) => ({ id }))
    return undefined
  }

  app.post('/services', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = serviceSchema.parse(request.body)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const { rows: [service] } = await client.query(
        `INSERT INTO services (tenant_id, name, description, duration_minutes, price, reminder_days, active, hidden)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [tenant_id, body.name, body.description ?? null, body.duration_minutes, body.price, body.reminder_days ?? null, body.active ?? true, body.hidden ?? false]
      )
      const pros = normalizePros(body)
      if (pros?.length) {
        await syncServiceProfessionals(client, service.id, tenant_id!, pros)
      }
      await client.query('COMMIT')
      return reply.status(201).send(service)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.put<{ Params: { id: string } }>('/services/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = serviceSchema.partial().parse(request.body)
    const { professional_ids, professionals, ...fields } = body

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const sets: string[] = []
      const values: unknown[] = []
      let i = 1
      for (const [key, val] of Object.entries(fields)) {
        if (val !== undefined) { sets.push(`${key} = $${i++}`); values.push(val) }
      }

      let service: any
      if (sets.length > 0) {
        values.push(request.params.id, tenant_id)
        const { rows: [s] } = await client.query(
          `UPDATE services SET ${sets.join(', ')}, updated_at = NOW()
           WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
          values
        )
        if (!s) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Serviço não encontrado' }) }
        service = s
      } else {
        const { rows: [s] } = await client.query('SELECT * FROM services WHERE id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
        service = s
      }

      const pros = normalizePros({ professionals, professional_ids })
      if (pros !== undefined) {
        await syncServiceProfessionals(client, request.params.id, tenant_id!, pros)
      }

      await client.query('COMMIT')
      return reply.send(service)
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.delete<{ Params: { id: string } }>('/services/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    await db.query(
      'UPDATE services SET active = false WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    return reply.send({ deleted: true })
  })

  // ── Professionals ─────────────────────────────────────────────────────────

  app.get('/professionals', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows } = await db.query(
      `SELECT p.*, u.name AS user_name
       FROM professionals p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.tenant_id = $1 AND p.active = TRUE ORDER BY p.name`,
      [tenant_id]
    )
    return reply.send(rows)
  })

  // CFG-7: `user_id` é OPCIONAL por design — profissional SEM conta de acesso
  // ao app (não consome max_users do plano; o limite de usuários vale só para
  // user_roles, em POST /staff). A UI pode criar "profissional sem acesso"
  // simplesmente omitindo user_id.
  const professionalCreateSchema = z.object({
    name: z.string().min(1).max(120),
    phone: z.string().max(30).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(),
    user_id: z.string().uuid().nullable().optional(),
  })

  const professionalUpdateSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    phone: z.string().max(30).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(),
  }).refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nenhum campo para atualizar' })

  app.post('/professionals', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { name, phone, bio, user_id } = professionalCreateSchema.parse(request.body)

    // If user_id provided, validate it belongs to this tenant
    if (user_id) {
      const { rows: [ur] } = await db.query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
        [user_id, tenant_id]
      )
      if (!ur) return reply.status(400).send({ error: 'Usuário não pertence a este negócio' })

      // Check if already linked as professional
      const { rows: [existing] } = await db.query(
        'SELECT id FROM professionals WHERE user_id = $1 AND tenant_id = $2 AND active = TRUE',
        [user_id, tenant_id]
      )
      if (existing) return reply.status(409).send({ error: 'Usuário já está cadastrado como profissional' })
    }

    const { rows: [pro] } = await db.query(
      `INSERT INTO professionals (tenant_id, name, phone, bio, user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenant_id, name, phone ?? null, bio ?? null, user_id ?? null]
    )
    return reply.status(201).send(pro)
  })

  // CFG-7: editar profissional (corrigir nome órfão, telefone, bio) — antes só
  // era possível excluir e recriar, o que perdia vínculos de serviço/comissão.
  app.patch<{ Params: { id: string } }>('/professionals/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = professionalUpdateSchema.parse(request.body ?? {})

    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    if (body.name !== undefined)  { sets.push(`name = $${i++}`);  values.push(body.name) }
    if (body.phone !== undefined) { sets.push(`phone = $${i++}`); values.push(body.phone || null) }
    if (body.bio !== undefined)   { sets.push(`bio = $${i++}`);   values.push(body.bio || null) }

    values.push(request.params.id, tenant_id)
    const { rows: [pro] } = await db.query(
      `UPDATE professionals SET ${sets.join(', ')}
       WHERE id = $${i} AND tenant_id = $${i + 1} AND active = TRUE
       RETURNING *`,
      values
    )
    if (!pro) return reply.status(404).send({ error: 'Profissional não encontrado' })
    return reply.send(pro)
  })

  app.delete<{ Params: { id: string } }>('/professionals/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    await db.query(
      'UPDATE professionals SET active = FALSE WHERE id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    return reply.send({ deleted: true })
  })

  // ── Payment config (Mercado Pago) ─────────────────────────────────────────

  app.get('/payment-config', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [tenant] } = await db.query(
      'SELECT mp_access_token, mp_public_key FROM tenants WHERE id = $1',
      [tenant_id]
    )
    return reply.send({
      mp_access_token: tenant?.mp_access_token ? maskSecret(decrypt(tenant.mp_access_token)) : null,
      mp_public_key: tenant?.mp_public_key ?? null,
      configured: !!tenant?.mp_access_token,
    })
  })

  app.put('/payment-config', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner'].includes(role)) return reply.status(403).send({ error: 'Apenas o proprietário pode alterar configurações de pagamento' })

    const { mp_access_token, mp_public_key } = z.object({
      mp_access_token: z.string().min(10).optional().or(z.literal('')),
      mp_public_key: z.string().min(10).optional().or(z.literal('')),
    }).parse(request.body)

    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    let mpAccount: string | null = null

    // Access token: '****' = valor mascarado (não alterado) → não sobrescreve.
    // Token real novo → VALIDA no Mercado Pago antes de salvar, para o erro
    // aparecer AGORA (na config) e não depois, na frente do cliente pagando.
    if (mp_access_token !== undefined && !mp_access_token.includes('****')) {
      if (mp_access_token) {
        try {
          const res = await fetch('https://api.mercadopago.com/users/me', {
            headers: { Authorization: `Bearer ${mp_access_token}` },
            signal: AbortSignal.timeout(10_000),
          })
          if (res.status === 401) {
            return reply.status(400).send({ error: 'Access Token inválido — confira se copiou o token de PRODUÇÃO completo do Mercado Pago.' })
          }
          if (!res.ok) {
            return reply.status(400).send({ error: 'Não foi possível validar o token no Mercado Pago agora. Tente novamente em instantes.' })
          }
          const data: any = await res.json().catch(() => ({}))
          mpAccount = data?.nickname || data?.email || null
        } catch {
          return reply.status(400).send({ error: 'Não foi possível conectar ao Mercado Pago para validar o token. Verifique sua conexão e tente de novo.' })
        }
      }
      sets.push(`mp_access_token = $${i++}`); values.push(mp_access_token ? encrypt(mp_access_token) : null)
    }
    if (mp_public_key !== undefined && !mp_public_key.includes('****')) {
      sets.push(`mp_public_key = $${i++}`); values.push(mp_public_key || null)
    }

    if (sets.length === 0) return reply.status(400).send({ error: 'Nenhum campo' })
    values.push(tenant_id)
    await db.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i}`, values)
    return reply.send({ saved: true, mp_account: mpAccount })
  })

  // ── Staff / Users ─────────────────────────────────────────────────────────

  app.get('/staff', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, ur.role
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.tenant_id = $1 ORDER BY ur.role, u.name`,
      [tenant_id]
    )
    return reply.send(rows)
  })

  app.post('/staff', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = staffCreateSchema.parse(request.body)

    // Check plan limit
    const { rows: [tenant] } = await db.query('SELECT max_users FROM tenants WHERE id = $1', [tenant_id])
    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*) FROM user_roles WHERE tenant_id = $1', [tenant_id]
    )
    if (Number(count) >= (tenant?.max_users ?? 1)) {
      return reply.status(402).send({ error: 'Limite de usuários atingido para seu plano' })
    }

    const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [body.email])
    let userId: string

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id
    } else {
      const hash = hashPassword(body.password)
      const { rows: [user] } = await db.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [body.name, body.email, hash]
      )
      userId = user.id
    }

    await db.query(
      'INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, tenant_id, body.role]
    )

    // Equipe = Profissionais: todo membro é agendável. Cria o profissional
    // vinculado (se ainda não houver), para aparecer na agenda/serviços.
    await db.query(
      `INSERT INTO professionals (tenant_id, name, user_id)
       SELECT $1, $2, $3
       WHERE NOT EXISTS (
         SELECT 1 FROM professionals WHERE user_id = $3 AND tenant_id = $1 AND active = TRUE
       )`,
      [tenant_id, body.name, userId]
    )

    return reply.status(201).send({ id: userId, name: body.name, email: body.email, role: body.role })
  })

  async function countOwners(tenantId: string): Promise<number> {
    const { rows: [{ count }] } = await db.query(
      "SELECT COUNT(*) FROM user_roles WHERE tenant_id = $1 AND role = 'owner'",
      [tenantId]
    )
    return Number(count)
  }

  app.patch<{ Params: { id: string } }>('/staff/:id', async (request, reply) => {
    const { tenant_id, role, user_id } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = staffUpdateSchema.parse(request.body)
    const targetId = request.params.id

    // Target must belong to this tenant
    const { rows: [target] } = await db.query(
      'SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
      [targetId, tenant_id]
    )
    if (!target) return reply.status(404).send({ error: 'Usuário não encontrado' })

    // Only an owner (or root) can edit another owner or promote someone to owner
    if (target.role === 'owner' && targetId !== user_id && !['owner', 'root'].includes(role)) {
      return reply.status(403).send({ error: 'Apenas o proprietário pode editar outro proprietário' })
    }
    if (body.role === 'owner' && target.role !== 'owner' && !['owner', 'root'].includes(role)) {
      return reply.status(403).send({ error: 'Apenas o proprietário pode promover a proprietário' })
    }

    // Last-owner guard: never demote the tenant's only owner (including yourself)
    if (body.role && body.role !== 'owner' && target.role === 'owner') {
      const owners = await countOwners(tenant_id!)
      if (owners <= 1) {
        return reply.status(403).send({ error: 'Não é possível remover o último proprietário' })
      }
    }

    // E-mail must stay unique across the platform
    if (body.email) {
      const { rows: [taken] } = await db.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [body.email, targetId]
      )
      if (taken) return reply.status(409).send({ error: 'E-mail já está em uso por outro usuário' })
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const sets: string[] = []
      const values: unknown[] = []
      let i = 1
      if (body.name !== undefined) { sets.push(`name = $${i++}`); values.push(body.name) }
      if (body.email !== undefined) { sets.push(`email = $${i++}`); values.push(body.email) }
      if (body.phone !== undefined) { sets.push(`phone = $${i++}`); values.push(body.phone || null) }
      if (sets.length > 0) {
        values.push(targetId)
        await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i}`, values)
      }

      // Equipe = Profissionais: mantém o nome do profissional em sincronia com o
      // do membro (senão a agenda/serviços continuam mostrando o nome antigo).
      // Se o membro ainda não for profissional, cria (todo membro é agendável).
      if (body.name !== undefined) {
        const upd = await client.query(
          'UPDATE professionals SET name = $1 WHERE user_id = $2 AND tenant_id = $3 AND active = TRUE',
          [body.name, targetId, tenant_id]
        )
        if (upd.rowCount === 0) {
          await client.query(
            'INSERT INTO professionals (tenant_id, name, user_id) VALUES ($1, $2, $3)',
            [tenant_id, body.name, targetId]
          )
        }
      }

      const roleChanged = body.role !== undefined && body.role !== target.role
      if (roleChanged) {
        await client.query(
          'UPDATE user_roles SET role = $1 WHERE user_id = $2 AND tenant_id = $3',
          [body.role, targetId, tenant_id]
        )
        // Revoke existing sessions: old JWTs carry the old role in their claims
        await bumpTokenVersion(targetId, client)
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const { rows: [updated] } = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, ur.role
       FROM users u JOIN user_roles ur ON ur.user_id = u.id
       WHERE u.id = $1 AND ur.tenant_id = $2`,
      [targetId, tenant_id]
    )
    return reply.send(updated)
  })

  app.delete<{ Params: { id: string } }>('/staff/:id', async (request, reply) => {
    const { tenant_id, role, user_id } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })
    if (request.params.id === user_id) return reply.status(400).send({ error: 'Não pode remover a si mesmo' })

    const { rows: [target] } = await db.query(
      'SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    if (!target) return reply.status(404).send({ error: 'Usuário não encontrado' })

    if (target.role === 'owner') {
      // Only an owner (or root) can remove another owner, and never the last one
      if (!['owner', 'root'].includes(role)) {
        return reply.status(403).send({ error: 'Apenas o proprietário pode remover outro proprietário' })
      }
      const owners = await countOwners(tenant_id!)
      if (owners <= 1) {
        return reply.status(403).send({ error: 'Não é possível remover o último proprietário' })
      }
    }

    await db.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    // Equipe = Profissionais: ao remover o membro, desativa o profissional
    // vinculado (some da agenda/serviços; histórico de agendamentos é preservado).
    await db.query(
      'UPDATE professionals SET active = FALSE WHERE user_id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    // Revoke existing sessions: the removed collaborator loses access immediately
    await bumpTokenVersion(request.params.id)

    return reply.send({ removed: true })
  })

  // ── Working hours ─────────────────────────────────────────────────────────

  app.get('/hours', async (request, reply) => {
    const { tenant_id } = request.user
    const { professional_id } = request.query as { professional_id?: string }

    const { rows } = await db.query(
      `SELECT * FROM working_hours WHERE tenant_id = $1
       ${professional_id ? 'AND professional_id = $2' : ''}
       ORDER BY day_of_week`,
      professional_id ? [tenant_id, professional_id] : [tenant_id]
    )
    return reply.send(rows)
  })

  app.post('/hours', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { rows: body_rows, professional_id } = request.body as any
    const rows = z.array(hoursRowSchema).parse(body_rows)

    // Ensure the professional belongs to this tenant (prevent polluting another tenant's grid)
    if (professional_id) {
      const { rows: [prof] } = await db.query(
        'SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2',
        [professional_id, tenant_id]
      )
      if (!prof) return reply.status(404).send({ error: 'Profissional não encontrado' })
    }

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      if (professional_id) {
        await client.query(
          'DELETE FROM working_hours WHERE tenant_id = $1 AND professional_id = $2',
          [tenant_id, professional_id]
        )
      } else {
        await client.query(
          'DELETE FROM working_hours WHERE tenant_id = $1 AND professional_id IS NULL',
          [tenant_id]
        )
      }

      const enabled = rows.filter((r) => r.enabled)
      for (const r of enabled) {
        await client.query(
          `INSERT INTO working_hours (tenant_id, professional_id, day_of_week, start_time, end_time)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenant_id, professional_id ?? null, r.day_of_week, r.start_time, r.end_time]
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return reply.send({ saved: true })
  })

  // ── Days off (folgas e bloqueios) ─────────────────────────────────────────

  const dayOffSchema = z.object({
    professional_id: z.string().uuid().nullable().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().max(300).nullable().optional(),
  })

  app.get('/days-off', async (request, reply) => {
    const { tenant_id } = request.user
    const { professional_id } = request.query as { professional_id?: string }

    const { rows } = await db.query(
      `SELECT d.id, d.professional_id, to_char(d.date, 'YYYY-MM-DD') AS date, d.reason,
              p.name AS professional_name
       FROM days_off d
       LEFT JOIN professionals p ON p.id = d.professional_id
       WHERE d.tenant_id = $1
         AND d.date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
         ${professional_id ? 'AND d.professional_id = $2' : ''}
       ORDER BY d.date, p.name NULLS FIRST`,
      professional_id ? [tenant_id, professional_id] : [tenant_id]
    )
    return reply.send(rows)
  })

  app.post('/days-off', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = dayOffSchema.parse(request.body)

    // Ensure the professional belongs to this tenant (same guard as /hours)
    if (body.professional_id) {
      const { rows: [prof] } = await db.query(
        'SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2',
        [body.professional_id, tenant_id]
      )
      if (!prof) return reply.status(404).send({ error: 'Profissional não encontrado' })
    }

    const { rows: [dayOff] } = await db.query(
      `INSERT INTO days_off (tenant_id, professional_id, date, reason)
       VALUES ($1, $2, $3, $4) RETURNING id, professional_id, to_char(date, 'YYYY-MM-DD') AS date, reason`,
      [tenant_id, body.professional_id ?? null, body.date, body.reason ?? null]
    )
    return reply.status(201).send(dayOff)
  })

  app.delete<{ Params: { id: string } }>('/days-off/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { rows } = await db.query(
      'DELETE FROM days_off WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [request.params.id, tenant_id]
    )
    if (rows.length === 0) return reply.status(404).send({ error: 'Folga não encontrada' })
    return reply.send({ deleted: true })
  })

  // ── Customers ─────────────────────────────────────────────────────────────

  // SAL-6: busca (nome/telefone/e-mail) e paginação no SERVIDOR. Sem
  // page/limit na query mantém o formato legado (array, até 200) para não
  // quebrar clientes antigos; com page/limit responde { data, total, page,
  // limit } para o app paginar a base inteira.
  app.get('/customers', async (request, reply) => {
    const { tenant_id } = request.user
    const { search, page, limit } = request.query as { search?: string; page?: string; limit?: string }

    const conds = ['c.tenant_id = $1', 'c.deleted_at IS NULL']
    const params: unknown[] = [tenant_id]
    let i = 2

    const term = search?.trim()
    if (term) {
      const like = `%${term.toLowerCase()}%`
      const digits = term.replace(/\D/g, '')
      if (digits.length >= 3) {
        // Busca por telefone ignora máscara: "(11) 9999" encontra "11999998888"
        conds.push(`(LOWER(c.name) LIKE $${i} OR LOWER(c.last_name) LIKE $${i} OR LOWER(c.email) LIKE $${i}
                     OR regexp_replace(c.phone, '\\D', '', 'g') LIKE $${i + 1})`)
        params.push(like, `%${digits}%`)
        i += 2
      } else {
        conds.push(`(LOWER(c.name) LIKE $${i} OR LOWER(c.last_name) LIKE $${i} OR c.phone LIKE $${i} OR LOWER(c.email) LIKE $${i})`)
        params.push(like)
        i += 1
      }
    }
    const where = conds.join(' AND ')

    const paginated = page !== undefined || limit !== undefined
    const lim = paginated ? Math.min(Math.max(Number(limit) || 50, 1), 200) : 200
    const pg = Math.max(Number(page) || 1, 1)
    const offset = paginated ? (pg - 1) * lim : 0

    const dataPromise = db.query(
      `SELECT c.id, c.name, c.last_name, c.phone, c.email, to_char(c.birth_date, 'YYYY-MM-DD') AS birth_date, c.created_at,
         (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id) AS appointment_count,
         (SELECT MAX(a.starts_at) FROM appointments a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id) AS last_appointment_at
       FROM customers c
       WHERE ${where}
       ORDER BY c.name LIMIT $${i} OFFSET $${i + 1}`,
      [...params, lim, offset]
    )

    if (!paginated) {
      const { rows } = await dataPromise
      return reply.send(rows)
    }

    const [dataRes, countRes] = await Promise.all([
      dataPromise,
      db.query(`SELECT COUNT(*)::int AS total FROM customers c WHERE ${where}`, params),
    ])
    return reply.send({
      data: dataRes.rows,
      total: Number(countRes.rows[0].total),
      page: pg,
      limit: lim,
    })
  })

  app.get<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    const { tenant_id } = request.user

    const { rows: [customer] } = await db.query(
      `SELECT id, name, last_name, phone, email, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, created_at FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [request.params.id, tenant_id]
    )
    if (!customer) return reply.status(404).send({ error: 'Cliente não encontrado' })

    // interested_services/last_interest_at come from migration 013 — tolerate their absence
    let interest: { interested_services: string | null; last_interest_at: string | null } =
      { interested_services: null, last_interest_at: null }
    try {
      const { rows: [row] } = await db.query(
        `SELECT interested_services,
                to_char(last_interest_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS last_interest_at
         FROM customers WHERE id = $1 AND tenant_id = $2`,
        [request.params.id, tenant_id]
      )
      if (row) interest = row
    } catch { /* columns not present until migration 013 is applied */ }

    const { rows: appointments } = await db.query(
      `SELECT a.id,
         to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS date,
         to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS time,
         a.status, a.notes,
         s.name AS service_name, s.price, s.duration_minutes,
         p.name AS professional_name
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id
       WHERE a.customer_id = $1 AND a.tenant_id = $2
       ORDER BY a.starts_at DESC
       LIMIT 50`,
      [request.params.id, tenant_id]
    )

    return reply.send({ ...customer, ...interest, appointments })
  })

  app.put<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) {
      // Staff pode editar os dados básicos (nome/sobrenome/e-mail) de um cliente
      // que atende: precisa existir um agendamento desse cliente criado por ele
      // OU em que ele é o profissional designado — a mesma regra usada em
      // canEditAppointment (routes/appointments.ts).
      const { rows: [rel] } = await db.query(
        `SELECT 1
         FROM appointments a
         JOIN professionals p ON p.id = a.professional_id
         WHERE a.customer_id = $1 AND a.tenant_id = $2
           AND (a.created_by = $3 OR p.user_id = $3)
         LIMIT 1`,
        [request.params.id, tenant_id, user_id]
      )
      if (!rel) return reply.status(403).send({ error: 'Sem permissão' })
    }

    const body = customerUpdateSchema.parse(request.body ?? {})

    // SAL-7: telefone é normalizado para só dígitos (padrão BR com DDD).
    let normalizedPhone: string | undefined
    if (body.phone !== undefined) {
      const digits = normalizePhoneBR(body.phone)
      if (!digits) {
        return reply.status(400).send({ error: 'Telefone inválido. Informe o número com DDD, por exemplo: (11) 99999-8888.' })
      }
      normalizedPhone = digits
    }

    // Dynamic SET with only the keys present in the body (like the staff PATCH):
    // sending last_name/email as '' clears the field instead of keeping it.
    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    if (body.name !== undefined)          { sets.push(`name = $${i++}`);      values.push(body.name) }
    if (body.last_name !== undefined)     { sets.push(`last_name = $${i++}`); values.push(body.last_name || null) }
    if (body.email !== undefined)         { sets.push(`email = $${i++}`);     values.push(body.email || null) }
    if (normalizedPhone !== undefined)    { sets.push(`phone = $${i++}`);     values.push(normalizedPhone) }
    if (body.birth_date !== undefined)    { sets.push(`birth_date = $${i++}`); values.push(body.birth_date || null) }
    if (sets.length === 0) return reply.status(400).send({ error: 'Nenhum campo para atualizar' })

    values.push(request.params.id, tenant_id)
    try {
      const { rows: [customer] } = await db.query(
        `UPDATE customers SET ${sets.join(', ')}
         WHERE id = $${i} AND tenant_id = $${i + 1} AND deleted_at IS NULL
         RETURNING *`,
        values
      )
      if (!customer) return reply.status(404).send({ error: 'Cliente não encontrado' })
      return reply.send(customer)
    } catch (err: any) {
      // UNIQUE (tenant_id, phone) — mesmo tratamento do POST /customers
      if (err?.code === '23505') {
        return reply.status(409).send({ error: 'Já existe outro cliente com esse telefone' })
      }
      throw err
    }
  })

  // Delete a customer (Admin/Owner only). Comissão paga e venda concluída são
  // HISTÓRICO: se o cliente tiver qualquer appointment 'completed' ou comissão
  // 'paid', o cadastro é anonimizado (soft-delete via deleted_at, migration 034)
  // preservando esses registros. Hard-delete só quando não há histórico
  // financeiro. Conversas/mensagens (dados pessoais) são removidas nos dois casos.
  app.delete<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const { rows: [exists] } = await client.query(
        'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [request.params.id, tenant_id]
      )
      if (!exists) { await client.query('ROLLBACK'); return reply.status(404).send({ error: 'Cliente não encontrado' }) }

      const { rows: [{ has_history }] } = await client.query(
        `SELECT
           EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.customer_id = $1 AND a.tenant_id = $2 AND a.status = 'completed'
           ) OR EXISTS (
             SELECT 1 FROM commissions co
             JOIN appointments a ON a.id = co.appointment_id
             WHERE a.customer_id = $1 AND a.tenant_id = $2 AND co.status = 'paid'
           ) AS has_history`,
        [request.params.id, tenant_id]
      )

      await client.query(
        `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE customer_id = $1 AND tenant_id = $2)`,
        [request.params.id, tenant_id]
      )
      await client.query('DELETE FROM conversations WHERE customer_id = $1 AND tenant_id = $2', [request.params.id, tenant_id])

      if (has_history) {
        // Remove só o que NÃO tem valor financeiro: comissões pendentes de
        // agendamentos não concluídos e os próprios agendamentos não concluídos
        // (sem comissão paga). Appointments 'completed' e comissões 'paid' ficam.
        await client.query(
          `DELETE FROM commissions co
           USING appointments a
           WHERE co.appointment_id = a.id AND co.status = 'pending'
             AND a.customer_id = $1 AND a.tenant_id = $2 AND a.status <> 'completed'`,
          [request.params.id, tenant_id]
        )
        await client.query(
          `DELETE FROM appointments a
           WHERE a.customer_id = $1 AND a.tenant_id = $2 AND a.status <> 'completed'
             AND NOT EXISTS (SELECT 1 FROM commissions co WHERE co.appointment_id = a.id AND co.status = 'paid')`,
          [request.params.id, tenant_id]
        )
        // Anonimiza o cadastro (o placeholder de phone mantém o UNIQUE tenant+phone).
        await client.query(
          `UPDATE customers SET
             name = 'Cliente removido',
             last_name = NULL,
             email = NULL,
             phone = 'removido-' || id::text,
             deleted_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [request.params.id, tenant_id]
        )
        await client.query('COMMIT')
        return reply.send({
          deleted: true,
          anonymized: true,
          message: 'Cliente removido. As vendas concluídas e comissões pagas foram preservadas no histórico de forma anônima.',
        })
      }

      // Sem histórico financeiro — exclusão definitiva (comissões pendentes
      // são apagadas explicitamente: a FK agora é ON DELETE SET NULL).
      await client.query(
        `DELETE FROM commissions WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id = $1 AND tenant_id = $2)`,
        [request.params.id, tenant_id]
      )
      await client.query('DELETE FROM appointments WHERE customer_id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
      await client.query('DELETE FROM customers WHERE id = $1 AND tenant_id = $2', [request.params.id, tenant_id])
      await client.query('COMMIT')
      return reply.send({ deleted: true, message: 'Cliente excluído com sucesso.' })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  app.post('/customers', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = customerCreateSchema.parse(request.body)

    try {
      const { rows: [customer] } = await db.query(
        `INSERT INTO customers (tenant_id, name, last_name, phone, email, birth_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, last_name, phone, email, to_char(birth_date, 'YYYY-MM-DD') AS birth_date, created_at`,
        [tenant_id, body.name.trim(), body.last_name?.trim() || null, body.phone.trim(), body.email || null, body.birth_date || null]
      )
      return reply.status(201).send(customer)
    } catch (err: any) {
      // UNIQUE (tenant_id, phone) from 001_init.sql
      if (err?.code === '23505') {
        return reply.status(409).send({ error: 'Já existe um cliente com esse telefone' })
      }
      throw err
    }
  })

  // ── Onboarding ─────────────────────────────────────────────────────────────
  // Per-step completion is computed from real data so the wizard never lies
  // about the account state. `completed` reflects the explicit finish/skip flag.
  app.get('/onboarding', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [row] } = await db.query(
      `SELECT
         t.onboarding_completed_at,
         t.mp_access_token,
         COALESCE(ac.business_type, '')  AS business_type,
         COALESCE(ac.business_info, '')  AS business_info,
         EXISTS (SELECT 1 FROM professionals p WHERE p.tenant_id = t.id AND p.active = TRUE)       AS has_professional,
         EXISTS (SELECT 1 FROM services s WHERE s.tenant_id = t.id)                                AS has_service,
         EXISTS (SELECT 1 FROM working_hours w WHERE w.tenant_id = t.id)                           AS has_hours,
         EXISTS (SELECT 1 FROM whatsapp_instances wi WHERE wi.tenant_id = t.id AND wi.status = 'connected') AS whatsapp_connected
       FROM tenants t
       LEFT JOIN agent_config ac ON ac.tenant_id = t.id
       WHERE t.id = $1`,
      [tenant_id]
    )
    if (!row) return reply.status(404).send({ error: 'Tenant não encontrado' })

    const steps = [
      { key: 'negocio',    done: row.business_type.trim().length > 0 },
      { key: 'equipe',     done: row.has_professional },
      { key: 'servicos',   done: row.has_service },
      { key: 'horarios',   done: row.has_hours },
      { key: 'agente',     done: row.business_info.trim().length > 0 },
      { key: 'pagamentos', done: !!row.mp_access_token },
      { key: 'whatsapp',   done: row.whatsapp_connected },
    ]
    const doneCount = steps.filter((s) => s.done).length

    return reply.send({
      completed: !!row.onboarding_completed_at,
      steps,
      progress: { done: doneCount, total: steps.length },
    })
  })

  app.post('/onboarding/complete', async (request, reply) => {
    const { tenant_id } = request.user
    await db.query(
      `UPDATE tenants SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW()) WHERE id = $1`,
      [tenant_id]
    )
    return reply.send({ completed: true })
  })

  // Business-type templates (read-only for tenants) — powers the "Negócio" step
  // dropdown. The full CRUD lives under the root admin routes.
  app.get('/business-type-templates', async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT business_type, display_name FROM business_type_templates ORDER BY display_name`
    )
    return reply.send(rows)
  })

  // Apply a business-type template to this tenant's agent_config. Sets the
  // business_type always; only overwrites the prompt/tone/instructions when the
  // agent hasn't been customized yet, so we never clobber a user's own wording.
  app.post('/apply-business-template', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { business_type } = z.object({ business_type: z.string().min(1) }).parse(request.body)

    const { rows: [tpl] } = await db.query(
      `SELECT system_prompt, custom_instructions, tone FROM business_type_templates WHERE business_type = $1`,
      [business_type]
    )
    if (!tpl) return reply.status(404).send({ error: 'Tipo de negócio não encontrado' })

    const { rows: [current] } = await db.query(
      `SELECT COALESCE(system_prompt, '') AS system_prompt FROM agent_config WHERE tenant_id = $1`,
      [tenant_id]
    )
    const alreadyCustomized = (current?.system_prompt ?? '').trim().length > 0

    const { rows: [updated] } = await db.query(
      `UPDATE agent_config SET
         business_type       = $1,
         system_prompt       = CASE WHEN $2 THEN system_prompt       ELSE $3 END,
         custom_instructions = CASE WHEN $2 THEN custom_instructions ELSE $4 END,
         tone                = CASE WHEN $2 THEN tone                ELSE $5 END,
         updated_at = NOW()
       WHERE tenant_id = $6
       RETURNING business_type`,
      [business_type, alreadyCustomized, tpl.system_prompt, tpl.custom_instructions, tpl.tone, tenant_id]
    )
    if (!updated) return reply.status(404).send({ error: 'Configuração do agente não encontrada' })

    await redis.del(`tenant:config:${tenant_id}`)
    return reply.send({ business_type: updated.business_type, applied_template: !alreadyCustomized })
  })
}
