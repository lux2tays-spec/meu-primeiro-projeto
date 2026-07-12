import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { syncAppointmentToCalendar, deleteCalendarEvent } from '../services/google-calendar'
import { findAvailableSlots } from '../services/scheduling'

const createSchema = z.object({
  customer_id: z.string().uuid(),
  professional_id: z.string().uuid(),
  service_id: z.string().uuid(),
  starts_at: z.string().datetime(),
  notes: z.string().optional(),
})

const updateSchema = z.object({
  professional_id: z.string().uuid().optional(),
  service_id: z.string().uuid().optional(),
  starts_at: z.string().datetime().optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']).optional(),
})

async function canEditAppointment(
  userId: string,
  tenantId: string,
  role: string,
  appointmentId: string
): Promise<boolean> {
  if (role === 'root' || role === 'owner' || role === 'admin') return true

  // Staff: can edit if they created it OR if they are the assigned professional
  const { rows: [appt] } = await db.query(
    `SELECT a.created_by, p.user_id as professional_user_id
     FROM appointments a
     JOIN professionals p ON p.id = a.professional_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [appointmentId, tenantId]
  )
  if (!appt) return false

  return appt.created_by === userId || appt.professional_user_id === userId
}

export const appointmentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', (app as any).authenticate)
  app.addHook('preHandler', (app as any).planGuard)

  // ── List ────────────────────────────────────────────────────────────────────
  app.get('/', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
    const { date } = request.query as { date?: string }

    let query = `
      SELECT a.*, c.name as customer_name, c.phone as customer_phone,
             p.name as professional_name, s.name as service_name,
             s.duration_minutes, s.price,
             u.name as created_by_name
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      JOIN professionals p ON p.id = a.professional_id
      JOIN services s ON s.id = a.service_id
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.tenant_id = $1
    `
    const params: unknown[] = [tenant_id]
    let paramIdx = 2

    // Staff only see their own appointments (where they're the professional or creator)
    if (role === 'staff') {
      query += ` AND (a.created_by = $${paramIdx} OR p.user_id = $${paramIdx})`
      params.push(user_id)
      paramIdx++
    }

    if (date) {
      query += ` AND DATE(a.starts_at AT TIME ZONE 'America/Sao_Paulo') = $${paramIdx}`
      params.push(date)
      paramIdx++
    }

    query += ` ORDER BY a.starts_at ASC`

    const { rows } = await db.query(query, params)
    return reply.send(rows)
  })

  // ── Get single ──────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { tenant_id } = request.user
    const { rows: [appt] } = await db.query(
      `SELECT a.*, c.name as customer_name, c.phone as customer_phone,
              p.name as professional_name, p.user_id as professional_user_id,
              s.name as service_name, s.duration_minutes, s.price
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       JOIN professionals p ON p.id = a.professional_id
       JOIN services s ON s.id = a.service_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [request.params.id, tenant_id]
    )
    if (!appt) return reply.status(404).send({ error: 'Not found' })
    return reply.send(appt)
  })

  // ── Create ──────────────────────────────────────────────────────────────────
  app.post('/', async (request, reply) => {
    const { tenant_id, user_id } = request.user
    const body = createSchema.parse(request.body)

    const { rows: [service] } = await db.query(
      'SELECT duration_minutes FROM services WHERE id = $1 AND tenant_id = $2',
      [body.service_id, tenant_id]
    )
    if (!service) return reply.status(404).send({ error: 'Service not found' })

    // Ensure customer and professional belong to this tenant
    const { rows: [customer] } = await db.query(
      'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2',
      [body.customer_id, tenant_id]
    )
    if (!customer) return reply.status(404).send({ error: 'Customer not found' })

    const { rows: [professional] } = await db.query(
      'SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2',
      [body.professional_id, tenant_id]
    )
    if (!professional) return reply.status(404).send({ error: 'Professional not found' })

    const startsAt = new Date(body.starts_at)
    const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000)

    const { rows: conflicts } = await db.query(
      `SELECT id FROM appointments
       WHERE professional_id = $1 AND tenant_id = $2 AND status NOT IN ('cancelled')
       AND tstzrange(starts_at, ends_at) && tstzrange($3::timestamptz, $4::timestamptz)`,
      [body.professional_id, tenant_id, startsAt.toISOString(), endsAt.toISOString()]
    )
    if (conflicts.length > 0) {
      return reply.status(409).send({ error: 'Time slot not available' })
    }

    const { rows: [appt] } = await db.query(
      `INSERT INTO appointments (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tenant_id, body.customer_id, body.professional_id, body.service_id,
       startsAt.toISOString(), endsAt.toISOString(), body.notes ?? null, user_id]
    )

    // Sync to Google Calendar in background
    syncAppointmentToCalendar(appt.id).catch(console.error)

    return reply.status(201).send(appt)
  })

  // ── Update (full edit with permission check) ────────────────────────────────
  app.put<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
    const appointmentId = request.params.id

    const allowed = await canEditAppointment(user_id, tenant_id!, role, appointmentId)
    if (!allowed) return reply.status(403).send({ error: 'Sem permissão para editar este agendamento' })

    const body = updateSchema.parse(request.body)

    // Ensure any referenced professional/service belongs to this tenant (prevent cross-tenant references)
    if (body.professional_id) {
      const { rows: [prof] } = await db.query(
        'SELECT id FROM professionals WHERE id = $1 AND tenant_id = $2',
        [body.professional_id, tenant_id]
      )
      if (!prof) return reply.status(404).send({ error: 'Professional not found' })
    }
    if (body.service_id) {
      const { rows: [svc] } = await db.query(
        'SELECT id FROM services WHERE id = $1 AND tenant_id = $2',
        [body.service_id, tenant_id]
      )
      if (!svc) return reply.status(404).send({ error: 'Service not found' })
    }

    // If changing time/service, recompute ends_at and check conflicts
    let endsAt: string | undefined
    if (body.starts_at) {
      const serviceId = body.service_id ?? (
        await db.query('SELECT service_id FROM appointments WHERE id = $1 AND tenant_id = $2', [appointmentId, tenant_id])
      ).rows[0]?.service_id

      const { rows: [service] } = await db.query(
        'SELECT duration_minutes FROM services WHERE id = $1 AND tenant_id = $2', [serviceId, tenant_id]
      )
      if (service) {
        const startsAt = new Date(body.starts_at)
        endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000).toISOString()

        const { rows: [appt] } = await db.query(
          'SELECT professional_id FROM appointments WHERE id=$1 AND tenant_id=$2', [appointmentId, tenant_id]
        )
        const professionalId = body.professional_id ?? appt?.professional_id

        const { rows: conflicts } = await db.query(
          `SELECT id FROM appointments
           WHERE professional_id = $1 AND tenant_id = $2 AND status NOT IN ('cancelled') AND id != $3
           AND tstzrange(starts_at, ends_at) && tstzrange($4::timestamptz, $5::timestamptz)`,
          [professionalId, tenant_id, appointmentId, body.starts_at, endsAt]
        )
        if (conflicts.length > 0) {
          return reply.status(409).send({ error: 'Time slot not available' })
        }
      }
    }

    const sets: string[] = []
    const values: unknown[] = []
    let i = 1

    if (body.professional_id !== undefined) { sets.push(`professional_id = $${i++}`); values.push(body.professional_id) }
    if (body.service_id !== undefined)      { sets.push(`service_id = $${i++}`); values.push(body.service_id) }
    if (body.starts_at !== undefined)       { sets.push(`starts_at = $${i++}`); values.push(body.starts_at) }
    if (endsAt !== undefined)               { sets.push(`ends_at = $${i++}`); values.push(endsAt) }
    if (body.notes !== undefined)           { sets.push(`notes = $${i++}`); values.push(body.notes) }
    if (body.status !== undefined)          { sets.push(`status = $${i++}`); values.push(body.status) }

    if (sets.length === 0) return reply.status(400).send({ error: 'No fields to update' })

    values.push(appointmentId, tenant_id)
    const { rows: [updated] } = await db.query(
      `UPDATE appointments SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
      values
    )

    if (!updated) return reply.status(404).send({ error: 'Not found' })

    // If cancelled, remove from calendars; otherwise sync
    if (body.status === 'cancelled') {
      deleteCalendarEvent(appointmentId).catch(console.error)
    } else {
      syncAppointmentToCalendar(appointmentId).catch(console.error)
    }

    return reply.send(updated)
  })

  // ── Status shortcut (kept for bot use) ─────────────────────────────────────
  app.patch<{ Params: { id: string } }>('/:id/status', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
    const { status } = z.object({
      status: z.enum(['pending', 'confirmed', 'completed', 'cancelled']),
    }).parse(request.body)

    const allowed = await canEditAppointment(user_id, tenant_id!, role, request.params.id)
    if (!allowed) return reply.status(403).send({ error: 'Sem permissão' })

    const { rows: [appt] } = await db.query(
      `UPDATE appointments SET status = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, request.params.id, tenant_id]
    )
    if (!appt) return reply.status(404).send({ error: 'Not found' })

    if (status === 'cancelled') deleteCalendarEvent(request.params.id).catch(console.error)
    else syncAppointmentToCalendar(request.params.id).catch(console.error)

    return reply.send(appt)
  })

  // ── Available slots for a professional+service+date ─────────────────────────
  // Delegates to findAvailableSlots (scheduling.ts) — the SAME engine the bot
  // uses — so general working hours (professional_id IS NULL), multiple windows,
  // São Paulo timezone, past-time filtering and days_off are all honored here too.
  app.get('/slots', async (request, reply) => {
    const { professional_id, service_id, date } = z.object({
      professional_id: z.string().uuid(),
      service_id: z.string().uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(request.query)
    const { tenant_id } = request.user

    const result = await findAvailableSlots(tenant_id!, professional_id, service_id, date)
    if (!result.ok) return reply.send([])

    // Frontend expects `${date}T${HH}:${MM}:00` strings.
    return reply.send(result.slots.map((hm) => `${date}T${hm}:00`))
  })
}
