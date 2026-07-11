import crypto from 'node:crypto'

// AES-256-GCM encryption for secrets at rest (Google/Mercado Pago tokens).
// Format: v1$<ivHex>$<tagHex>$<cipherHex>
// Uses ENCRYPTION_KEY if set (recommended, dedicated key); otherwise derives a
// key from JWT_SECRET so encryption works out of the box. Values not prefixed
// with "v1$" are treated as legacy plaintext and returned as-is on decrypt.

const VERSION = 'v1'

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || ''
  return crypto.createHash('sha256').update(secret).digest() // 32 bytes
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION}$${iv.toString('hex')}$${tag.toString('hex')}$${enc.toString('hex')}`
}

export function decrypt(stored: string | null | undefined): string {
  if (!stored) return ''
  if (!stored.startsWith(`${VERSION}$`)) return stored // legacy plaintext
  const [, ivHex, tagHex, dataHex] = stored.split('$')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}

/** Return a masked version of a secret for display, e.g. "APP_USR-****1234". */
export function maskSecret(token: string | null | undefined): string {
  if (!token) return ''
  const last = token.slice(-4)
  const prefix = token.includes('-') ? token.slice(0, token.indexOf('-') + 1) : ''
  return `${prefix}****${last}`
}
