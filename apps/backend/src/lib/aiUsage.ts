import { db } from './db'
import { redis } from './redis'
import { costUsd } from './aiPricing'

// Records AI usage per call (DB row for the dashboard + a Redis monthly counter
// per tenant for the real-time cost cap).

function monthKey(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function recordUsage(tenantId: string | null, model: string, usage: any): Promise<number> {
  const cost = costUsd(model, usage)
  try {
    await db.query(
      `INSERT INTO ai_usage (tenant_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        model,
        usage?.input_tokens ?? 0,
        usage?.output_tokens ?? 0,
        usage?.cache_read_input_tokens ?? 0,
        usage?.cache_creation_input_tokens ?? 0,
        cost,
      ]
    )
    if (tenantId) {
      const key = `ai:cost:${tenantId}:${monthKey()}`
      await redis.incrbyfloat(key, cost)
      await redis.expire(key, 60 * 60 * 24 * 40) // ~40 days
    }
  } catch (err) {
    console.error('recordUsage failed:', err)
  }
  return cost
}

/** Current calendar-month spend (USD) for a tenant, from the Redis counter. */
export async function monthlySpend(tenantId: string): Promise<number> {
  const v = await redis.get(`ai:cost:${tenantId}:${monthKey()}`)
  return v ? Number(v) : 0
}
