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
 * Resolve a professional. If a serviceId is given, candidates are restricted to
 * professionals linked to that service via service_professionals (falling back
 * to ALL active professionals only when the service has no mapping rows, so
 * tenants that never configured the mapping keep working). If a name is given,
 * fuzzy-match it within the candidates. If there is exactly one candidate, use
 * it. Otherwise return { ambiguous: true, options } so the bot can ask which one.
 */
export async function resolveProfessional(
  tenantId: string,
  query?: string,
  serviceId?: string
): Promise<{ professional?: ProfessionalRow; ambiguous?: boolean; options?: ProfessionalRow[] }> {
  let candidates: ProfessionalRow[] | null = null

  if (serviceId) {
    const { rows: mapped } = await db.query(
      `SELECT p.id, p.name FROM professionals p
       JOIN service_professionals sp ON sp.professional_id = p.id
       WHERE sp.service_id = $1 AND p.tenant_id = $2 AND p.active = TRUE
       ORDER BY p.name`,
      [serviceId, tenantId]
    )
    if (mapped.length > 0) candidates = mapped
    // else: service has no mapping rows — fall back to all active professionals below.
  }

  if (!candidates) {
    const { rows: all } = await db.query(
      'SELECT id, name FROM professionals WHERE tenant_id = $1 AND active = TRUE ORDER BY name',
      [tenantId]
    )
    candidates = all
  }

  if (query && query.trim()) {
    const q = query.trim().toLowerCase()
    const match =
      candidates.find((p) => p.name.toLowerCase() === q) ??
      candidates.find((p) => p.name.toLowerCase().includes(q))
    if (match) return { professional: match }
  }

  if (candidates.length === 1) return { professional: candidates[0] }
  if (candidates.length === 0) return { ambiguous: false, options: [] }
  return { ambiguous: true, options: candidates }
}

export type SlotsResult =
  | { ok: true; slots: string[] }
  | { ok: false; reason: 'servico_invalido' | 'dia_bloqueado' | 'sem_horario_config' }
  // Business is closed on the requested weekday but open on others — carries the
  // open weekday names so the bot can tell the customer which days it CAN book.
  | { ok: false; reason: 'dia_fechado'; openDays: string[] }

const WEEKDAY_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** Open weekday names (pt-BR) for this professional (or tenant-wide), sorted. */
export async function getOpenWeekdays(tenantId: string, professionalId: string): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT day_of_week FROM working_hours
     WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
     ORDER BY day_of_week`,
    [tenantId, professionalId]
  )
  return rows.map((r: any) => WEEKDAY_PT[r.day_of_week]).filter(Boolean)
}

/** True when the date is blocked in days_off for this professional (or tenant-wide). */
async function isDayOff(tenantId: string, professionalId: string, date: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM days_off
     WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
       AND date = $3::date
     LIMIT 1`,
    [tenantId, professionalId, date]
  )
  return rows.length > 0
}

/**
 * Free 30-minute-grid start times ("HH:MM") for a professional+service on a date.
 * Considers working hours (per-professional or general), existing appointments,
 * and — when the date is today — the current time.
 * Returns a distinguishable error when the tenant has no working hours configured
 * for that day (instead of an empty list that looks like "fully booked").
 */
export async function findAvailableSlots(
  tenantId: string,
  professionalId: string,
  serviceId: string,
  date: string // YYYY-MM-DD
): Promise<SlotsResult> {
  const [svcRes, hoursRes, apptRes, nowRes, dayOff] = await Promise.all([
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
    isDayOff(tenantId, professionalId, date),
  ])

  const service = svcRes.rows[0]
  if (!service) {
    console.error(`[scheduling] findAvailableSlots FALHOU: serviço ${serviceId} não encontrado (tenant=${tenantId})`)
    return { ok: false, reason: 'servico_invalido' }
  }
  if (dayOff) {
    console.warn(`[scheduling] findAvailableSlots BLOQUEADO: ${date} está em days_off para professional=${professionalId} (tenant=${tenantId})`)
    return { ok: false, reason: 'dia_bloqueado' }
  }
  if (hoursRes.rows.length === 0) {
    // No hours for THIS weekday. Distinguish "closed on this day" (business has
    // hours on other days) from "agenda never configured at all".
    const openDays = await getOpenWeekdays(tenantId, professionalId)
    if (openDays.length > 0) {
      console.warn(`[scheduling] findAvailableSlots: ${date} é dia fechado (tenant=${tenantId}); dias abertos: ${openDays.join(', ')}`)
      return { ok: false, reason: 'dia_fechado', openDays }
    }
    console.error(`[scheduling] findAvailableSlots FALHOU: nenhum working_hours para professional=${professionalId} na data ${date} (tenant=${tenantId}) — agenda não configurada`)
    return { ok: false, reason: 'sem_horario_config' }
  }
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
  return { ok: true, slots }
}

/** Build a São Paulo timestamptz string from date + time.
 *
 * BOT-17 — PREMISSA DOCUMENTADA (não alterar sem revisar): o offset -03:00 é
 * fixado no código porque o Brasil NÃO tem horário de verão desde 2019 —
 * America/Sao_Paulo é -03:00 o ano inteiro, então o valor está sempre correto
 * hoje. RISCO: se o horário de verão voltar (decreto federal), este offset fica
 * ERRADO durante o DST (-02:00) e todo agendamento criado no período ficaria
 * deslocado em 1h. Nesse caso, trocar a montagem da string por uma conversão
 * real de wall-clock via IANA "America/Sao_Paulo" (ex.: Intl/date-fns-tz), e
 * revisar os demais usos de "-03:00"/AT TIME ZONE no backend. O mesmo offset
 * fixo é usado em routes/appointments.ts (GET /slots). */
function saoPauloTimestamp(date: string, time: string): string {
  return `${date}T${time.length === 5 ? time : time.slice(0, 5)}:00-03:00`
}

export type BookResult =
  | { ok: true; appointmentId: string; startsAt: string }
  | { ok: false; reason: 'unavailable' | 'invalid' | 'sem_horario_config' | 'dia_bloqueado' | 'horario_no_passado' | 'fora_do_expediente' }
  | { ok: false; reason: 'dia_fechado'; openDays: string[] }

/**
 * Create an appointment for the bot (created_by = NULL). Rechecks conflicts.
 * When `rescheduleId` is given, MOVES that existing appointment in place (same row,
 * same id) instead of inserting a new one — a remarcação passa a mover o serviço
 * para a nova data confirmada, sem deixar uma cópia "cancelada" na data antiga.
 */
export async function bookAppointment(params: {
  tenantId: string
  customerId: string
  serviceId: string
  professionalId: string
  date: string
  time: string
  rescheduleId?: string
}): Promise<BookResult> {
  const { tenantId, customerId, serviceId, professionalId, date, time, rescheduleId } = params

  const { rows: [service] } = await db.query(
    'SELECT duration_minutes FROM services WHERE id = $1 AND tenant_id = $2',
    [serviceId, tenantId]
  )
  if (!service) {
    console.error(`[scheduling] bookAppointment FALHOU: serviço ${serviceId} não encontrado (tenant=${tenantId})`)
    return { ok: false, reason: 'invalid' }
  }

  const startsAt = new Date(saoPauloTimestamp(date, time))
  if (isNaN(startsAt.getTime())) {
    console.error(`[scheduling] bookAppointment FALHOU: data/hora inválida "${date} ${time}" (tenant=${tenantId})`)
    return { ok: false, reason: 'invalid' }
  }
  const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000)

  // Guard: never book in the past. startsAt is an absolute instant (built with the
  // São Paulo offset), so comparing against the server clock is timezone-safe.
  if (startsAt.getTime() <= Date.now()) {
    console.error(`[scheduling] bookAppointment FALHOU: ${date} ${time} está no passado (tenant=${tenantId})`)
    return { ok: false, reason: 'horario_no_passado' }
  }

  // Guard: the tenant must have working hours configured for that weekday —
  // otherwise the "agenda" simply doesn't exist and the bot must not pretend it does.
  // Same query shape findAvailableSlots uses, so the window check below can reuse the rows.
  const { rows: hours } = await db.query(
    `SELECT to_char(start_time, 'HH24:MI') AS start_hm, to_char(end_time, 'HH24:MI') AS end_hm
     FROM working_hours
     WHERE tenant_id = $1 AND (professional_id = $2 OR professional_id IS NULL)
       AND day_of_week = EXTRACT(DOW FROM $3::date)
     ORDER BY start_time`,
    [tenantId, professionalId, date]
  )
  if (hours.length === 0) {
    const openDays = await getOpenWeekdays(tenantId, professionalId)
    if (openDays.length > 0) {
      console.warn(`[scheduling] bookAppointment: ${date} é dia fechado (tenant=${tenantId}); dias abertos: ${openDays.join(', ')}`)
      return { ok: false, reason: 'dia_fechado', openDays }
    }
    console.error(`[scheduling] bookAppointment FALHOU: nenhum working_hours para professional=${professionalId} em ${date} (tenant=${tenantId}) — horários de atendimento não configurados`)
    return { ok: false, reason: 'sem_horario_config' }
  }

  // Guard: the date must not be blocked in days_off (professional-specific or tenant-wide).
  if (await isDayOff(tenantId, professionalId, date)) {
    console.error(`[scheduling] bookAppointment FALHOU: ${date} está em days_off para professional=${professionalId} (tenant=${tenantId}) — dia bloqueado/folga`)
    return { ok: false, reason: 'dia_bloqueado' }
  }

  // Guard: the requested window [time, time + duration] must be fully contained in
  // one of the day's working-hour windows — the same containment rule
  // findAvailableSlots applies when generating slots (cur + duration <= end).
  const toMin = (hm: string) => {
    const [h, m] = hm.split(':').map(Number)
    return h * 60 + m
  }
  const startMin = toMin(time.length === 5 ? time : time.slice(0, 5))
  const endMin = startMin + service.duration_minutes
  const insideWorkingHours = hours.some(
    (w: any) => startMin >= toMin(w.start_hm) && endMin <= toMin(w.end_hm)
  )
  if (!insideWorkingHours) {
    console.error(`[scheduling] bookAppointment FALHOU: ${date} ${time} (+${service.duration_minutes}min) está fora do expediente de professional=${professionalId} (tenant=${tenantId})`)
    return { ok: false, reason: 'fora_do_expediente' }
  }

  try {
    // BUGFIX: columns are TIMESTAMPTZ — tsrange() only accepts timestamp WITHOUT
    // time zone, so the old tsrange(starts_at, ends_at) threw "function does not
    // exist" on EVERY booking, the error was swallowed upstream, and the bot
    // fabricated a confirmation. tstzrange() is the correct range type here.
    // Conflito de horário — ao remarcar (mover no lugar), o próprio agendamento
    // não pode conflitar consigo mesmo, então é excluído da checagem.
    const conflictParams: unknown[] = [professionalId, tenantId, startsAt.toISOString(), endsAt.toISOString()]
    let conflictExcludeSelf = ''
    if (rescheduleId) {
      conflictExcludeSelf = ' AND id <> $5'
      conflictParams.push(rescheduleId)
    }
    const { rows: conflicts } = await db.query(
      `SELECT id FROM appointments
       WHERE professional_id = $1 AND tenant_id = $2 AND status <> 'cancelled'
         AND tstzrange(starts_at, ends_at) && tstzrange($3::timestamptz, $4::timestamptz)${conflictExcludeSelf}`,
      conflictParams
    )
    if (conflicts.length > 0) {
      console.error(`[scheduling] bookAppointment FALHOU: conflito de horário em ${date} ${time} para professional=${professionalId} (tenant=${tenantId})`)
      return { ok: false, reason: 'unavailable' }
    }

    let apptId: string
    if (rescheduleId) {
      // Remarcação: move a MESMA linha para a nova data/serviço/profissional e
      // garante status 'confirmed'. Sem INSERT novo, sem cancelar a antiga.
      const { rows: [appt] } = await db.query(
        `UPDATE appointments
           SET professional_id = $1, service_id = $2, starts_at = $3, ends_at = $4, status = 'confirmed',
               rescheduled = TRUE
         WHERE id = $5 AND tenant_id = $6 RETURNING id`,
        [professionalId, serviceId, startsAt.toISOString(), endsAt.toISOString(), rescheduleId, tenantId]
      )
      if (!appt) {
        console.error(`[scheduling] bookAppointment (reschedule) FALHOU: agendamento ${rescheduleId} não encontrado (tenant=${tenantId})`)
        return { ok: false, reason: 'invalid' }
      }
      apptId = appt.id
      console.log(`[scheduling] bookAppointment OK (remarcado in-place): appointment=${apptId} → ${date} ${time} customer=${customerId} professional=${professionalId} (tenant=${tenantId})`)
    } else {
      const { rows: [appt] } = await db.query(
        `INSERT INTO appointments (tenant_id, customer_id, professional_id, service_id, starts_at, ends_at, status, created_by, origin)
         VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', NULL, 'ia') RETURNING id`,
        [tenantId, customerId, professionalId, serviceId, startsAt.toISOString(), endsAt.toISOString()]
      )
      apptId = appt.id
      console.log(`[scheduling] bookAppointment OK: appointment=${apptId} ${date} ${time} customer=${customerId} professional=${professionalId} (tenant=${tenantId})`)
    }

    syncAppointmentToCalendar(apptId).catch(console.error)
    return { ok: true, appointmentId: apptId, startsAt: startsAt.toISOString() }
  } catch (err) {
    // Corrida de double-booking: duas reservas simultâneas passaram pela checagem
    // de conflito acima, mas a EXCLUDE constraint appointments_no_overlap
    // (migration 036) barrou a segunda no banco. Código Postgres 23P01
    // (exclusion_violation) → tratar como "horário indisponível", não como 500.
    if (isOverlapViolation(err)) {
      console.warn(`[scheduling] bookAppointment: corrida de double-booking barrada pela constraint em ${date} ${time} para professional=${professionalId} (tenant=${tenantId})`)
      return { ok: false, reason: 'unavailable' }
    }
    console.error(`[scheduling] bookAppointment FALHOU (erro de banco) tenant=${tenantId} customer=${customerId} ${date} ${time}:`, err)
    throw err
  }
}

/**
 * True when the error is a violation of the appointments_no_overlap EXCLUDE
 * constraint (migration 036) — Postgres error 23P01 (exclusion_violation).
 * Callers must map it to "horário indisponível"/409, never to a 500.
 */
export function isOverlapViolation(err: unknown): boolean {
  return (err as any)?.code === '23P01'
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

/** The customer's next upcoming (non-cancelled) appointment with service/professional. */
export async function getUpcomingAppointment(
  tenantId: string,
  customerId: string
): Promise<{ id: string; serviceId: string; serviceName: string; professionalId: string; professionalName: string | null; when: string } | null> {
  const { rows: [a] } = await db.query(
    `SELECT a.id, a.service_id, s.name AS service_name,
            a.professional_id, p.name AS professional_name,
            to_char(a.starts_at AT TIME ZONE $3, 'DD/MM HH24:MI') AS when_fmt
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN professionals p ON p.id = a.professional_id
     WHERE a.tenant_id = $1 AND a.customer_id = $2 AND a.status <> 'cancelled' AND a.starts_at >= now()
     ORDER BY a.starts_at ASC LIMIT 1`,
    [tenantId, customerId, TZ]
  )
  if (!a) return null
  return { id: a.id, serviceId: a.service_id, serviceName: a.service_name, professionalId: a.professional_id, professionalName: a.professional_name, when: a.when_fmt }
}

export type UpcomingAppointment = {
  id: string
  serviceId: string
  serviceName: string
  professionalId: string
  professionalName: string | null
  date: string  // YYYY-MM-DD (São Paulo)
  time: string  // HH:MM (São Paulo)
  when: string  // DD/MM HH24:MI (São Paulo) — human-friendly
}

/**
 * ALL upcoming (non-cancelled) appointments of a customer, soonest first.
 * Used by the bot to (a) tell the customer when their appointments are and
 * (b) disambiguate cancel/reschedule when the customer has more than one —
 * never operate blindly on "the next one" (BOT-12).
 */
export async function listUpcomingAppointments(
  tenantId: string,
  customerId: string
): Promise<UpcomingAppointment[]> {
  const { rows } = await db.query(
    `SELECT a.id, a.service_id, s.name AS service_name,
            a.professional_id, p.name AS professional_name,
            to_char(a.starts_at AT TIME ZONE $3, 'YYYY-MM-DD') AS date_fmt,
            to_char(a.starts_at AT TIME ZONE $3, 'HH24:MI') AS time_fmt,
            to_char(a.starts_at AT TIME ZONE $3, 'DD/MM HH24:MI') AS when_fmt
     FROM appointments a
     JOIN services s ON s.id = a.service_id
     LEFT JOIN professionals p ON p.id = a.professional_id
     WHERE a.tenant_id = $1 AND a.customer_id = $2 AND a.status <> 'cancelled' AND a.starts_at >= now()
     ORDER BY a.starts_at ASC LIMIT 10`,
    [tenantId, customerId, TZ]
  )
  return rows.map((a: any) => ({
    id: a.id, serviceId: a.service_id, serviceName: a.service_name,
    professionalId: a.professional_id, professionalName: a.professional_name,
    date: a.date_fmt, time: a.time_fmt, when: a.when_fmt,
  }))
}

/** Cancel one specific appointment by id (used by reschedule after the new slot is booked). */
export async function cancelAppointmentById(tenantId: string, appointmentId: string): Promise<void> {
  await db.query(
    `UPDATE appointments SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2`,
    [appointmentId, tenantId]
  )
  deleteCalendarEvent(appointmentId).catch(console.error)
}
