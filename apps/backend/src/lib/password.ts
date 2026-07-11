import crypto from 'node:crypto'

// Password hashing using Node's built-in scrypt (no external dependency).
// Format: scrypt$<N>$<saltHex>$<hashHex>
// Legacy hashes (plain sha256 hex, 64 chars, no '$') are still verified and
// transparently re-hashed to scrypt on the next successful login.

const PREFIX = 'scrypt'
const KEYLEN = 64
const N = 16384 // CPU/memory cost
const r = 8
const p = 1

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(password, salt, KEYLEN, { N, r, p })
  return `${PREFIX}$${N}$${salt.toString('hex')}$${derived.toString('hex')}`
}

function legacyHash(password: string): string {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex')
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Verify a password against a stored hash.
 * Returns { valid, needsRehash } — when the stored hash is a legacy sha256,
 * needsRehash is true so the caller can upgrade it to scrypt.
 */
export function verifyPassword(password: string, stored: string): { valid: boolean; needsRehash: boolean } {
  if (!stored) return { valid: false, needsRehash: false }

  if (stored.startsWith(`${PREFIX}$`)) {
    const [, nStr, saltHex, hashHex] = stored.split('$')
    const expected = Buffer.from(hashHex, 'hex')
    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: Number(nStr), r, p })
    return { valid: safeEqual(expected, derived), needsRehash: false }
  }

  // Legacy sha256(password + JWT_SECRET)
  const valid = safeEqual(Buffer.from(stored), Buffer.from(legacyHash(password)))
  return { valid, needsRehash: valid }
}
