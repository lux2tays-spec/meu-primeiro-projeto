import { db } from '../lib/db'
import { redis } from '../lib/redis'
import { evolutionConnectionState } from '../services/evolution'

// Reconciles our DB WhatsApp status with Evolution's REAL connection state.
// This is the production-safe way to finalize a connection when the owner
// unlinked WhatsApp on their phone WITHOUT clicking "Desconectar" — we don't
// rely on the connection.update webhook (which may be missed): we poll the
// authoritative state and mark the instance disconnected when it is no longer
// "open" (session closed, or the instance was removed from Evolution).
//
// Safety: a transient Evolution error (timeout / 5xx) is IGNORED — we only
// finalize on a definitive non-open state or a genuine "instance not found".

export async function reconcileWhatsappConnections(): Promise<void> {
  const { rows } = await db.query(
    "SELECT tenant_id, instance_name, status FROM whatsapp_instances WHERE status IN ('connected', 'qr_pending')"
  )

  for (const inst of rows) {
    const res = await evolutionConnectionState(inst.instance_name)

    let finalize = false
    let reason = ''

    if (res.ok) {
      if (res.state === 'open') {
        if (inst.status !== 'connected') {
          await db.query("UPDATE whatsapp_instances SET status = 'connected' WHERE tenant_id = $1", [inst.tenant_id])
        }
        continue
      }
      // A successful response with a non-open state = the session really ended.
      finalize = true
      reason = `state=${res.state}`
    } else if (res.notFound) {
      finalize = true
      reason = 'instância não existe mais na Evolution'
    } else {
      continue // transient Evolution error — leave the status untouched
    }

    if (finalize) {
      await db.query(
        "UPDATE whatsapp_instances SET status = 'disconnected', phone_number = NULL WHERE tenant_id = $1",
        [inst.tenant_id]
      )
      await redis.del(`whatsapp:qr:${inst.tenant_id}`)
      console.log(`[whatsapp] ${inst.instance_name}: conexão finalizada automaticamente (${reason})`)
    }
  }
}

// Runs shortly after boot, then every 2 minutes.
export function startWhatsappReconciler(): void {
  setTimeout(() => {
    reconcileWhatsappConnections().catch((e) => console.error('[whatsapp] reconcile startup error:', e))
    setInterval(() => {
      reconcileWhatsappConnections().catch((e) => console.error('[whatsapp] reconcile run error:', e))
    }, 2 * 60 * 1000)
  }, 20_000)
}
