import { db } from './db'

// Keeps the `commissions` table in sync with an appointment's lifecycle.
//
// Rules:
// - status = 'completed' + commission_enabled on the (service, professional)
//   link → upsert a commission row, snapshotting price/config at completion.
//   amount = percent → round(price * value / 100, 2) | fixed → value.
//   On conflict (appointment already has a commission) the snapshot is
//   refreshed ONLY while status = 'pending' (SAL-13): a 'paid' row is history —
//   editing the appointment must never rewrite its amount or beneficiary.
// - status = 'cancelled' → delete the commission ONLY while still 'pending'
//   (a paid commission is history and must never disappear).
// - completed but commission not enabled → remove any lingering 'pending' row.
//
// Fire-and-forget safe: never throws — callers can .catch(console.error) but
// a commission hiccup must never fail the request that changed the status.

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export async function syncCommissionForAppointment(appointmentId: string): Promise<void> {
  try {
    const { rows: [appt] } = await db.query(
      `SELECT a.id, a.tenant_id, a.service_id, a.professional_id, a.status,
              s.price,
              sp.commission_enabled, sp.commission_type, sp.commission_value
       FROM appointments a
       LEFT JOIN services s ON s.id = a.service_id
       LEFT JOIN service_professionals sp
         ON sp.service_id = a.service_id AND sp.professional_id = a.professional_id
       WHERE a.id = $1`,
      [appointmentId]
    )
    if (!appt) return

    if (appt.status === 'cancelled') {
      // Never delete a paid commission — only a still-pending one.
      await db.query(
        `DELETE FROM commissions WHERE appointment_id = $1 AND status = 'pending'`,
        [appointmentId]
      )
      return
    }

    if (appt.status !== 'completed') return

    if (!appt.commission_enabled) {
      // Commission was disabled (or link removed) after a previous sync —
      // make sure no pending row lingers. Paid rows stay untouched.
      await db.query(
        `DELETE FROM commissions WHERE appointment_id = $1 AND status = 'pending'`,
        [appointmentId]
      )
      return
    }

    const price = Number(appt.price ?? 0)
    const value = Number(appt.commission_value ?? 0)
    const type: string = appt.commission_type === 'fixed' ? 'fixed' : 'percent'
    const amount = type === 'percent' ? round2((price * value) / 100) : round2(value)

    await db.query(
      `INSERT INTO commissions
         (tenant_id, appointment_id, professional_id, service_id,
          service_price, commission_type, commission_value, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (appointment_id) DO UPDATE SET
         professional_id  = EXCLUDED.professional_id,
         service_id       = EXCLUDED.service_id,
         service_price    = EXCLUDED.service_price,
         commission_type  = EXCLUDED.commission_type,
         commission_value = EXCLUDED.commission_value,
         amount           = EXCLUDED.amount
       WHERE commissions.status = 'pending'`,
      [appt.tenant_id, appointmentId, appt.professional_id, appt.service_id,
       price, type, value, amount]
    )
  } catch (err) {
    // Table may not exist yet (migration 028 pending) or transient DB error —
    // log and swallow; commissions self-heal on the next status change.
    console.error(`[commissions] falha ao sincronizar appointment=${appointmentId}:`, err)
  }
}
