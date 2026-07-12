import { db } from '../lib/db'
import { redis } from '../lib/redis'
import { evolutionDeleteInstance } from '../services/evolution'

// Disconnects the WhatsApp instance of any tenant whose access has lapsed
// (trial expired, or subscription suspended/cancelled). The bot is already
// blocked in real time by planGuard/webhook; this tears down the live WhatsApp
// session so the UI clearly shows "Desconectado" and the owner is nudged to
// subscribe. On re-subscription they reconnect with a fresh QR.

export async function disconnectExpiredTenants(): Promise<void> {
  const { rows } = await db.query(
    `SELECT wi.tenant_id, wi.instance_name
     FROM whatsapp_instances wi
     JOIN tenants t ON t.id = wi.tenant_id
     WHERE wi.status IN ('connected', 'qr_pending')
       AND (
         t.status IN ('suspended', 'cancelled')
         OR (t.status = 'trial' AND t.trial_ends_at IS NOT NULL AND t.trial_ends_at < now())
       )`
  )

  for (const r of rows) {
    try {
      await evolutionDeleteInstance(r.instance_name)
      await db.query(
        `UPDATE whatsapp_instances SET status = 'disconnected', phone_number = NULL WHERE tenant_id = $1`,
        [r.tenant_id]
      )
      await redis.del(`whatsapp:qr:${r.tenant_id}`)
      console.log(`[subscription] WhatsApp desconectado para tenant inativo ${r.tenant_id}`)
    } catch (err) {
      console.error(`[subscription] falha ao desconectar tenant ${r.tenant_id}:`, err)
    }
  }
}

// Runs shortly after boot, then hourly.
export function startSubscriptionEnforcer(): void {
  setTimeout(() => {
    disconnectExpiredTenants().catch((e) => console.error('[subscription] startup error:', e))
    setInterval(() => {
      disconnectExpiredTenants().catch((e) => console.error('[subscription] run error:', e))
    }, 60 * 60 * 1000)
  }, 15_000)
}
