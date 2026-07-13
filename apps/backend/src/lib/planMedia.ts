import { db } from './db'
import { redis } from './redis'

// Whether the tenant's current plan allows the bot to handle incoming audio and
// image messages. Cached briefly in Redis — checked on every media webhook.

const TTL = 300 // 5 min

export async function tenantMediaEnabled(tenantId: string): Promise<boolean> {
  const cacheKey = `tenant:media:${tenantId}`
  const cached = await redis.get(cacheKey)
  if (cached !== null) return cached === '1'

  const { rows: [row] } = await db.query(
    `SELECT COALESCE(pp.media_enabled, FALSE) AS media_enabled
     FROM tenants t
     LEFT JOIN platform_plans pp ON pp.slug = t.plan
     WHERE t.id = $1`,
    [tenantId]
  )
  const enabled = !!row?.media_enabled
  await redis.set(cacheKey, enabled ? '1' : '0', 'EX', TTL)
  return enabled
}
