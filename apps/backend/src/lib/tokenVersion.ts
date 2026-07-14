import { db } from './db'
import { redis } from './redis'

// JWT revocation via per-user token version (migration 023).
// Every issued JWT carries a `tv` claim equal to users.token_version at sign
// time. The authenticate plugin compares the claim against the current value
// (cached in Redis to avoid a DB hit per request); a mismatch means the
// session was revoked. Tokens issued before the migration have no `tv` claim
// and are treated as version 0, matching the column default.

export const TOKEN_VERSION_TTL = 60 * 5 // 5 min

// Minimal query surface shared by pg Pool and PoolClient, so bumps can run
// inside an existing transaction.
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }

function cacheKey(userId: string): string {
  return `user:tv:${userId}`
}

/**
 * Current token_version for a user. Redis-cached (TTL 5min); falls back to
 * Postgres on miss or Redis failure. Returns null when the user no longer
 * exists (deleted account → all its tokens are invalid).
 */
export async function getTokenVersion(userId: string): Promise<number | null> {
  try {
    const cached = await redis.get(cacheKey(userId))
    if (cached !== null) return Number(cached)
  } catch (err) {
    console.error('Redis indisponível ao ler token_version; consultando o banco:', err)
  }

  const { rows: [user] } = await db.query(
    'SELECT token_version FROM users WHERE id = $1',
    [userId]
  )
  if (!user) return null

  const version = Number(user.token_version)
  try {
    await redis.set(cacheKey(userId), String(version), 'EX', TOKEN_VERSION_TTL)
  } catch (err) {
    console.error('Falha ao cachear token_version no Redis:', err)
  }
  return version
}

/**
 * Revokes every outstanding JWT of a user by incrementing token_version and
 * clearing the Redis cache. Pass an open transaction client to make the bump
 * atomic with related writes (e.g. password reset).
 */
export async function bumpTokenVersion(userId: string, client: Queryable = db): Promise<void> {
  await client.query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1',
    [userId]
  )
  try {
    await redis.del(cacheKey(userId))
  } catch (err) {
    // Best-effort: the cached value expires within TOKEN_VERSION_TTL anyway.
    console.error('Falha ao limpar cache de token_version no Redis:', err)
  }
}
