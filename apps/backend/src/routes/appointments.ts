import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { syncAppointmentToCalendar, deleteCalendarEvent } from '../services/google-calendar'
import { findAvailableSlots } from '../services/scheduling'
import { syncCommissionForAppointment } from '../lib/commissions'
import { evolutionSend } from '../services/evolution'

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
    const { date, from, to, search, professional_id, service_id } =
      request.query as { date?: string; from?: string; to?: string; search?: string; professional_id?: string; service_id?: string }

    let query = `
      SELECT a.*, c.name as customer_name, c.last_name as customer_last_name, c.phone as customer_phone,
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

    // Single-day filter (agenda "dia") — kept for backward compatibility.
    // Expressed as a half-open instant range for that São Paulo day so the
    // planner can use idx_appointments_tenant_starts (sargable on starts_at).
    if (date) {
      query += ` AND a.starts_at >= ($${paramIdx}::date::timestamp AT TIME ZONE 'America/Sao_Paulo')`
      query += ` AND a.starts_at < (($${paramIdx}::date + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')`
      params.push(date)
      paramIdx++
    }

    // Date range (agenda "semana"/"mês" — the calendar fetches a window). Inclusive
    // from, exclusive to; both are ISO instants.
    if (from) { query += ` AND a.starts_at >= $${paramIdx}`; params.push(from); paramIdx++ }
    if (to)   { query += ` AND a.starts_at < $${paramIdx}`;  params.push(to);   paramIdx++ }

    // Search by customer name / last name / phone (#4).
    if (search) {
      query += ` AND (c.name ILIKE $${paramIdx} OR c.last_name ILIKE $${paramIdx} OR c.phone ILIKE $${paramIdx})`
      params.push(`%${search}%`)
      paramIdx++
    }

    // Filters by professional / service (#4).
    if (professional_id) { query += ` AND a.professional_id = $${paramIdx}`; params.push(professional_id); paramIdx++ }
    if (service_id)      { query += ` AND a.service_id = $${paramIdx}`;      params.push(service_id);      paramIdx++ }

    query += ` ORDER BY a.starts_at ASC`

    const { rows } = await db.query(query, params)
    return reply.send(rows)
  })

  // ── Get single ──────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { tenant_id, user_id, role } = request.user
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
    // Staff only see their own appointments (creator or assigned professional) —
    // same rule as the list handler. 404 (not 403) to avoid confirming existence.
    if (role === 'staff' && appt.created_by !== user_id && appt.professional_user_id !== user_id) {
      return reply.status(404).send({ error: 'Not found' })
    }
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

    // Status changed → keep the professional's commission in sync (fire-and-forget)
    if (body.status !== undefined) {
      syncCommissionForAppointment(appointmentId).catch(console.error)
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

    // Keep the professional's commission in sync with the new status
    syncCommissionForAppointment(request.params.id).catch(console.error)

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

  // ── Bulk reschedule (#5a) ────────────────────────────────────────────────────
  // Urgency tool: for every active appointment in a period (optionally of one
  // professional), cancel it (freeing the slot) and message the customer via
  // WhatsApp asking to reschedule — the bot then handles the rebooking naturally.
  // Owner/admin only.
  const bulkRescheduleSchema = z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    professional_id: z.string().uuid().optional(),
    message: z.string().max(1000).optional(), // may contain {quando} placeholder
  })

  const BULK_MAX_WINDOW_DAYS = 31
  const BULK_MAX_APPOINTMENTS = 200
  const BULK_NOTIFY_CONCURRENCY = 5

  app.post('/bulk-reschedule', async (request, reply) => {
    const { tenant_id, role } = request.user
    if (!['owner', 'admin', 'root'].includes(role)) return reply.status(403).send({ error: 'Sem permissão' })
    const body = bulkRescheduleSchema.parse(request.body)

    // Bound the window — an accidental "from 2020 to 2030" must never mass-cancel.
    const windowMs = new Date(body.to).getTime() - new Date(body.from).getTime()
    if (windowMs <= 0) {
      return reply.status(400).send({ error: 'Período inválido: a data final deve ser depois da inicial.' })
    }
    if (windowMs > BULK_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      return reply.status(400).send({ error: `Período muito longo: escolha um intervalo de até ${BULK_MAX_WINDOW_DAYS} dias.` })
    }

    // WhatsApp must be connected to notify anyone.
    const { rows: [inst] } = await db.query(
      `SELECT instance_name, status FROM whatsapp_instances WHERE tenant_id = $1`, [tenant_id]
    )
    if (!inst || inst.status !== 'connected') {
      return reply.status(400).send({ error: 'WhatsApp não está conectado — conecte antes de avisar os clientes.' })
    }

    const scopeWhere = `
      a.tenant_id = $1 AND a.status IN ('pending','confirmed')
        AND a.starts_at >= $2 AND a.starts_at < $3` +
      (body.professional_id ? ` AND a.professional_id = $4` : '')
    const params: unknown[] = [tenant_id, body.from, body.to]
    if (body.professional_id) params.push(body.professional_id)

    // Hard ceiling on scope — refuse instead of silently truncating.
    const { rows: [{ total }] } = await db.query(
      `SELECT COUNT(*)::int AS total FROM appointments a WHERE ${scopeWhere}`, params
    )
    if (total > BULK_MAX_APPOINTMENTS) {
      return reply.status(400).send({
        error: `São ${total} agendamentos no período (máximo ${BULK_MAX_APPOINTMENTS}). Reduza o período ou filtre por profissional.`,
      })
    }

    const { rows: appts } = await db.query(
      `SELECT a.id, c.phone, c.name AS customer_name,
              to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM às HH24:MI') AS quando
       FROM appointments a JOIN customers c ON c.id = a.customer_id
       WHERE ${scopeWhere}
       ORDER BY a.starts_at
       LIMIT ${BULK_MAX_APPOINTMENTS}`,
      params
    )
    if (appts.length === 0) return reply.send({ affected: 0, notified: 0 })

    // Cancel everything FIRST in one idempotent statement — slots are freed even
    // if notifications fail halfway, and a retry never double-cancels.
    const ids = appts.map((a) => a.id)
    await db.query(
      `UPDATE appointments SET status = 'cancelled' WHERE id = ANY($1::uuid[]) AND tenant_id = $2`,
      [ids, tenant_id]
    )

    // Then notify, in small chunks with limited concurrency — a serial-but-instant
    // burst of hundreds of messages is a WhatsApp ban risk.
    let notified = 0
    for (let i = 0; i < appts.length; i += BULK_NOTIFY_CONCURRENCY) {
      const chunk = appts.slice(i, i + BULK_NOTIFY_CONCURRENCY)
      await Promise.all(chunk.map(async (a) => {
        deleteCalendarEvent(a.id).catch(() => {})           // remove from Google Calendar
        syncCommissionForAppointment(a.id).catch(() => {})  // void any pending commission
        const text = (body.message?.trim()
          ? body.message.trim()
          : `Oi! Tivemos um imprevisto e precisaremos remarcar seu horário de {quando}. 🙏 Quando fica melhor pra você? Me diga um dia e horário que eu já reagendo 😊`
        ).replace(/\{quando\}/g, a.quando)
        try {
          await evolutionSend(inst.instance_name, a.phone, text)
          notified++
        } catch (err) {
          request.log.error({ err, appt: a.id }, 'bulk-reschedule: falha ao avisar cliente')
        }
      }))
    }

    return reply.send({ affected: appts.length, notified })
  })
}
