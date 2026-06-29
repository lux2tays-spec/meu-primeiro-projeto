import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { syncAppointmentToCalendar, deleteCalendarEvent } from '../services/google-calendar'

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

    const startsAt = new Date(body.starts_at)
    const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000)

    const { rows: conflicts } = await db.query(
      `SELECT id FROM appointments
       WHERE professional_id = $1 AND status NOT IN ('cancelled')
       AND tsrange(starts_at, ends_at) && tsrange($2::timestamptz, $3::timestamptz)`,
      [body.professional_id, startsAt.toISOString(), endsAt.toISOString()]
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

    // If changing time/service, recompute ends_at and check conflicts
    let endsAt: string | undefined
    if (body.starts_at) {
      const serviceId = body.service_id ?? (
        await db.query('SELECT service_id FROM appointments WHERE id = $1', [appointmentId])
      ).rows[0]?.service_id

      const { rows: [service] } = await db.query('SELECT duration_minutes FROM services WHERE id = $1', [serviceId])
      if (service) {
        const startsAt = new Date(body.starts_at)
        endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000).toISOString()

        const { rows: [appt] } = await db.query('SELECT professional_id FROM appointments WHERE id=$1', [appointmentId])
        const professionalId = body.professional_id ?? appt?.professional_id

        const { rows: conflicts } = await db.query(
          `SELECT id FROM appointments
           WHERE professional_id = $1 AND status NOT IN ('cancelled') AND id != $2
           AND tsrange(starts_at, ends_at) && tsrange($3::timestamptz, $4::timestamptz)`,
          [professionalId, appointmentId, body.starts_at, endsAt]
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
    const { status } = request.body as { status: string }

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
  app.get('/slots', async (request, reply) => {
    const { professional_id, service_id, date } = request.query as Record<string, string>
    const { tenant_id } = request.user

    const [serviceRes, hoursRes, apptRes] = await Promise.all([
      db.query('SELECT duration_minutes FROM services WHERE id=$1 AND tenant_id=$2', [service_id, tenant_id]),
      db.query(
        `SELECT start_time, end_time FROM working_hours
         WHERE professional_id=$1 AND day_of_week=EXTRACT(DOW FROM $2::date)`,
        [professional_id, date]
      ),
      db.query(
        `SELECT starts_at, ends_at FROM appointments
         WHERE professional_id=$1 AND status NOT IN ('cancelled') AND DATE(starts_at)=$2`,
        [professional_id, date]
      ),
    ])

    const service = serviceRes.rows[0]
    const hours = hoursRes.rows[0]
    if (!service || !hours) return reply.send([])

    const duration = service.duration_minutes
    const slots: string[] = []

    const [sh, sm] = (hours.start_time as string).split(':').map(Number)
    const [eh, em] = (hours.end_time as string).split(':').map(Number)

    let current = sh * 60 + sm
    const endMinutes = eh * 60 + em

    const busySlots = apptRes.rows.map((r: any) => ({
      start: new Date(r.starts_at).getHours() * 60 + new Date(r.starts_at).getMinutes(),
      end: new Date(r.ends_at).getHours() * 60 + new Date(r.ends_at).getMinutes(),
    }))

    while (current + duration <= endMinutes) {
      const slotEnd = current + duration
      const isBusy = busySlots.some((b) => current < b.end && slotEnd > b.start)
      if (!isBusy) {
        const hh = String(Math.floor(current / 60)).padStart(2, '0')
        const mm = String(current % 60).padStart(2, '0')
        slots.push(`${date}T${hh}:${mm}:00`)
      }
      current += 30 // 30-min grid
    }

    return reply.send(slots)
  })
}
