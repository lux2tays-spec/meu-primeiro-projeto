import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import crypto from 'node:crypto'
import { db } from '../lib/db'

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex')
}

const serviceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  duration_minutes: z.number().int().positive(),
  price: z.number().nonnegative(),
  reminder_days: z.number().int().min(0).nullable().optional(),
  professional_ids: z.array(z.string().uuid()).optional(),
})

const hoursRowSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  enabled: z.boolean(),
})

const staffCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'staff']),
})

export const tenantRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)

  // ── Tenant info ──────────────────────────────────────────────────────────

  app.get('/me', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [tenant] } = await db.query(
      'SELECT id, name, slug, plan, status, trial_ends_at, max_agendas, max_users FROM tenants WHERE id = $1',
      [tenant_id]
    )
    return reply.send(tenant)
  })

  // ── Services ─────────────────────────────────────────────────────────────

  app.get('/services', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows } = await db.query(
      `SELECT s.*,
         COALESCE(
           json_agg(json_build_object('id', p.id, 'name', p.name) ORDER BY p.name)
             FILTER (WHERE p.id IS NOT NULL),
           '[]'
         ) AS professionals
       FROM services s
       LEFT JOIN service_professionals sp ON sp.service_id = s.id
       LEFT JOIN professionals p ON p.id = sp.professional_id AND p.active = TRUE
       WHERE s.tenant_id = $1 AND s.active = TRUE
       GROUP BY s.id
       ORDER BY s.name`,
      [tenant_id]
    )
    return reply.send(rows)
  })

  async function syncServiceProfessionals(client: any, serviceId: string, tenantId: string, professionalIds: string[]) {
    await client.query('DELETE FROM service_professionals WHERE service_id = $1', [serviceId])
    for (const pid of professionalIds) {
      const { rows: [pro] } = await client.query(
        'SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2 AND active = TRUE',
        [pid, tenantId]
      )
      if (pro) {
        await client.query(
          'INSERT INTO service_professionals (service_id, professional_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [serviceId, pid]
        )
      }
    }
  }

  app.post('/services', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const body = serviceSchema.parse(request.body)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const { rows: [service] } = await client.query(
        `INSERT INTO services (tenant_id, name, description, duration_minutes, price, reminder_days)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [tenant_id, body.name, body.description ?? null, body.duration_minutes, body.price, body.reminder_days ?? null]
      )
      if (body.professional_ids?.length) {
        await syncServiceProfessionals(client, service.id, tenant_id, body.professional_ids)
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
    const { professional_ids, ...fields } = body

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

      if (professional_ids !== undefined) {
        await syncServiceProfessionals(client, request.params.id, tenant_id, professional_ids)
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

  app.post('/professionals', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { name, phone, bio, user_id } = request.body as any

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
      mp_access_token: tenant?.mp_access_token ? '***' + tenant.mp_access_token.slice(-4) : null,
      mp_public_key: tenant?.mp_public_key ?? null,
      configured: !!tenant?.mp_access_token,
    })
  })

  app.put('/payment-config', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner'].includes(role)) return reply.status(403).send({ error: 'Apenas o proprietário pode alterar configurações de pagamento' })

    const { mp_access_token, mp_public_key } = request.body as any

    const sets: string[] = []
    const values: unknown[] = []
    let i = 1
    if (mp_access_token !== undefined) { sets.push(`mp_access_token = $${i++}`); values.push(mp_access_token || null) }
    if (mp_public_key  !== undefined) { sets.push(`mp_public_key = $${i++}`);  values.push(mp_public_key  || null) }

    if (sets.length === 0) return reply.status(400).send({ error: 'Nenhum campo' })
    values.push(tenant_id)
    await db.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = $${i}`, values)
    return reply.send({ saved: true })
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

    return reply.status(201).send({ id: userId, name: body.name, email: body.email, role: body.role })
  })

  app.delete<{ Params: { id: string } }>('/staff/:id', async (request, reply) => {
    const { tenant_id, role, user_id } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })
    if (request.params.id === user_id) return reply.status(400).send({ error: 'Não pode remover a si mesmo' })

    // Cannot remove owner
    const { rows: [target] } = await db.query(
      'SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
    if (!target) return reply.status(404).send({ error: 'Usuário não encontrado' })
    if (target.role === 'owner') return reply.status(403).send({ error: 'Não pode remover o proprietário' })

    await db.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
      [request.params.id, tenant_id]
    )
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

  // ── Customers ─────────────────────────────────────────────────────────────

  app.get('/customers', async (request, reply) => {
    const { tenant_id } = request.user
    const { search } = request.query as { search?: string }

    const { rows } = await db.query(
      `SELECT c.id, c.name, c.phone, c.email, c.created_at,
         (SELECT COUNT(*) FROM appointments a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id) AS appointment_count,
         (SELECT MAX(a.starts_at) FROM appointments a WHERE a.customer_id = c.id AND a.tenant_id = c.tenant_id) AS last_appointment_at
       FROM customers c
       WHERE c.tenant_id = $1
       ${search ? `AND (LOWER(c.name) LIKE $2 OR c.phone LIKE $2 OR LOWER(c.email) LIKE $2)` : ''}
       ORDER BY c.name LIMIT 200`,
      search ? [tenant_id, `%${search.toLowerCase()}%`] : [tenant_id]
    )
    return reply.send(rows)
  })

  app.get<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    const { tenant_id } = request.user

    const { rows: [customer] } = await db.query(
      `SELECT id, name, phone, email, created_at FROM customers WHERE id = $1 AND tenant_id = $2`,
      [request.params.id, tenant_id]
    )
    if (!customer) return reply.status(404).send({ error: 'Cliente não encontrado' })

    const { rows: appointments } = await db.query(
      `SELECT a.id, a.starts_at, a.ends_at, a.status, a.notes,
         s.name AS service, s.price, s.duration_minutes,
         p.name AS professional
       FROM appointments a
       JOIN services s ON s.id = a.service_id
       JOIN professionals p ON p.id = a.professional_id
       WHERE a.customer_id = $1 AND a.tenant_id = $2
       ORDER BY a.starts_at DESC
       LIMIT 50`,
      [request.params.id, tenant_id]
    )

    return reply.send({ ...customer, appointments })
  })

  app.put<{ Params: { id: string } }>('/customers/:id', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })

    const { name, email } = request.body as any

    const { rows: [customer] } = await db.query(
      `UPDATE customers SET
         name  = COALESCE($1, name),
         email = COALESCE($2, email)
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [name ?? null, email !== undefined ? (email || null) : undefined, request.params.id, tenant_id]
    )
    if (!customer) return reply.status(404).send({ error: 'Cliente não encontrado' })
    return reply.send(customer)
  })

  app.post('/customers', async (request, reply) => {
    const { tenant_id } = request.user
    const { name, phone, email } = request.body as any

    const { rows: [customer] } = await db.query(
      `INSERT INTO customers (tenant_id, name, phone, email)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, phone) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email
       RETURNING *`,
      [tenant_id, name, phone, email ?? null]
    )
    return reply.status(201).send(customer)
  })
}
