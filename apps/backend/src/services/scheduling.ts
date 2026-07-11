import { db } from '../lib/db'
import { syncAppointmentToCalendar, deleteCalendarEvent } from './google-calendar'

// Deterministic scheduling logic used by the bot. Everything works in the
// America/Sao_Paulo timezone regardless of the server's TZ.

const TZ = 'America/Sao_Paulo'

export type ServiceRow = { id: string; name: string; duration_minutes: number; price: string }
export type ProfessionalRow = { id: string; name: string }

/** Fuzzy-resolve a service by name within the tenant. Returns null if no match. */
export async function resolveService(tenantId: string, query: string): Promise<ServiceRow | null> {
  const { rows } = await db.query(
    `SELECT id, name, duration_minutes, price FROM services
     WHERE tenant_id = $1 AND active = TRUE
       AND (LOWER(name) = LOWER($2) OR LOWER(name) LIKE '%' || LOWER($2) || '%')
     ORDER BY (LOWER(name) = LOWER($2)) DESC, length(name) ASC
     LIMIT 1`,
    [tenantId, query.trim()]
  )
  return rows[0] ?? null
}

/**
 * Resolve a professional. If a name is given, fuzzy-match it. If not and the
 * tenant has exactly one active professional, use it. Otherwise return
 * { ambiguous: true, options } so the bot can ask which one.
 */
export async function resolveProfessional(
  tenantId: string,
  query?: string
): Promise<{ professional?: ProfessionalRow; ambiguous?: boolean; options?: ProfessionalRow[] }> {
  if (query && query.trim()) {
    const { rows } = await db.query(
      `SELECT id, name FROM professionals
       WHERE tenant_id = $1 AND active = TRUE
         AND (LOWER(name) = LOWER($2) OR LOWER(name) LIKE '%' || LOWER($2) || '%')
       ORDER BY (LOWER(name) = LOWER($2)) DESC LIMIT 1`,
      [tenantId, query.trim()]
    )
    if (rows[0]) return { professional: rows[0] }
  }
  const { rows: all } = await db.query(
    'SELECT id, name FROM professionals WHERE tenant_id = $1 AND active = TRUE ORDER BY name',
    [tenantId]
  )
  if (all.length === 1) return { professional: all[0] }
  if (all.length === 0) return { ambiguous: false, options: [] }
  return { ambiguous: true, options: all }
}

/**
 * Free 30-minute-grid start times ("HH:MM") for a professional+service on a date.
 * Considers working hours (per-professional or general), existing appointments,
 * and — when the date is today — the current time.
 */
export async function findAvailableSlots(
  tenantId: string,
  professionalId: string,
  serviceId: string,
  date: string // YYYY-MM-DD
): Promise<string[]> {
  const [svcRes, hoursRes, apptRes, nowRes] = await Promise.all([
    db.query('SELECT duration_minutes FROM services WHERE id = $1 AND tenant_id = $2', [serviceId, tenantId]),
    db.query(
      `SELECT to_char(start_time, 'HH24:MI') AS start_hm, to_char(end_time, 'HH24:MI') AS end_hm
       FROM working_hours
       WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
         AND day_of_week = EXTRACT(DOW FROM $3::date)
       ORDER BY start_time`,
      [tenantId, professionalId, date]
    ),
    db.query(
      `SELECT to_char(starts_at AT TIME ZONE $4, 'HH24:MI') AS start_hm,
              to_char(ends_at   AT TIME ZONE $4, 'HH24:MI') AS end_hm
       FROM appointments
       WHERE tenant_id = $1 AND professional_id = $2 AND status <> 'cancelled'
         AND (starts_at AT TIME ZONE $4)::date = $3::date`,
      [tenantId, professionalId, date, TZ]
    ),
    db.query(
      `SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD') AS today,
              to_char(now() AT TIME ZONE $1, 'HH24:MI') AS now_hm`,
      [TZ]
    ),
  ])

  const service = svcRes.rows[0]
  if (!service || hoursRes.rows.length === 0) return []
  const duration = service.duration_minutes as number

  const toMin = (hm: string) => {
    const [h, m] = hm.split(':').map(Number)
    return h * 60 + m
  }
  const busy = apptRes.rows.map((r: any) => ({ start: toMin(r.start_hm), end: toMin(r.end_hm) }))
  const isToday = nowRes.rows[0].today === date
  const nowMin = toMin(nowRes.rows[0].now_hm)

  const slots: string[] = []
  for (const window of hoursRes.rows) {
    let cur = toMin(window.start_hm)
    const end = toMin(window.end_hm)
    while (cur + duration <= end) {
      const slotEnd = cur + duration
      const overlaps = busy.some((b) => cur < b.end && slotEnd > b.start)
      const inPast = isToday && cur <= nowMin
      if (!overlaps && !inPast) {
        slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`)
      }
      cur += 30
    }
  }
  return slots
}

/** Build a São Paulo timestamptz string from date + time. */
function saoPauloTimestamp(date: string, time: string): string {
  return `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00-03:00`
}

export type BookResult =
  | { ok: true; appointmentId: string; startsAt: string }
  | { ok: false; reason: 'unavailable' | 'invalid' }

/** Create an appointment for the bot (created_by = NULL). Rechecks conflicts. */
export async function bookAppointment(params: {
  tenantId: string
  customerId: string
  serviceId: string
  professionalId: string
  date: string
  time: string
}): Promise<BookResult> {
  const { tenantId, customerId, serviceId, professionalId, date, time } = params

  const { rows: [service] } = await db.query(
    'SELECT duration_minutes FROM services WHERE id = $1 AND tenant_id = $2',
    [serviceId, tenantId]
  )
  if (!service) return { ok: false, reason: 'invalid' }

  const startsAt = new Date(saoPauloTimestamp(date, time))
  if (isNaN(startsAt.getTime())) return { ok: false, reason: 'invalid' }
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000)

  const { rows: conflicts } = await db.query(
    `SELECT id FROM appointments
     WHERE professional_id = $1 AND tenant_id = $2 AND status <> 'cancelled'
       AND tsrange(starts_at, ends_at) && tsrange($3::timestamptz, $4::timestamptz)`,
    [professionalId, tenantId, startsAt.toISOString(), endsAt.toISOString()]
  )
  if (conflicts.length > 0) return { ok: false, reason: 'unavailable' }

  const { rows: [appt] } = await db.query(
    `INSERT INTO appointments (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NULL) RETURNING id`,
    [tenantId, customerId, professionalId, serviceId, startsAt.toISOString(), endsAt.toISOString()]
  )

  syncAppointmentToCalendar(appt.id).catch(console.error)
  return { ok: true, appointmentId: appt.id, startsAt: startsAt.toISOString() }
}

/** Cancel the customer's next upcoming (non-cancelled) appointment. */
export async function cancelUpcomingAppointment(
  tenantId: string,
  customerId: string
): Promise<{ ok: boolean; when?: string }> {
  const { rows: [appt] } = await db.query(
    `SELECT id, to_char(starts_at AT TIME ZONE $3, 'DD/MM HH24:MI') AS when_fmt
     FROM appointments
     WHERE tenant_id = $1 AND customer_id = $2 AND status <> 'cancelled' AND starts_at >= now()
     ORDER BY starts_at ASC LIMIT 1`,
    [tenantId, customerId, TZ]
  )
  if (!appt) return { ok: false }
  await db.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [appt.id])
  deleteCalendarEvent(appt.id).catch(console.error)
  return { ok: true, when: appt.when_fmt }
}
