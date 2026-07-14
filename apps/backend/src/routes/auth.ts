import { FastifyPluginAsync } from 'fastify'
import { z, ZodError } from 'zod'
import { db } from '../lib/db'
import { sendPasswordResetEmail, sendVerificationEmail } from '../lib/email'
import { hashPassword, verifyPassword } from '../lib/password'
import { bumpTokenVersion } from '../lib/tokenVersion'
import crypto from 'node:crypto'

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().min(8),
  business_name: z.string().min(2),
  referral_code: z.string().optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const emailOnlySchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
})

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function zodErrorMessage(err: ZodError): string {
  const fieldMessages: Record<string, string> = {
    password: 'A senha deve ter pelo menos 8 caracteres',
    email: 'E-mail inválido',
    name: 'Nome deve ter pelo menos 2 caracteres',
    business_name: 'Nome do negócio deve ter pelo menos 2 caracteres',
    phone: 'Telefone inválido',
  }
  const first = err.issues[0]
  return fieldMessages[String(first.path[0])] ?? first.message
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', {
    config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    let body: z.infer<typeof registerSchema>
    try {
      body = registerSchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: zodErrorMessage(err) })
      }
      throw err
    }

    const slug = body.business_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const { rows: [tenant] } = await client.query(
        `INSERT INTO tenants (name, slug, plan, status, trial_ends_at, max_agendas, max_users)
         VALUES ($1, $2, 'free', 'trial', $3, 1, 1) RETURNING id`,
        [body.business_name, slug, trialEndsAt]
      )

      const { rows: [user] } = await client.query(
        `INSERT INTO users (name, email, phone, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.name, body.email, body.phone, hashPassword(body.password)]
      )

      await client.query(
        'INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)',
        [user.id, tenant.id, 'owner']
      )

      await client.query('INSERT INTO agent_config (tenant_id) VALUES ($1)', [tenant.id])

      const verificationToken = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await client.query(
        'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, verificationToken, expiresAt]
      )

      if (body.referral_code) {
        const { rows: [affiliate] } = await client.query(
          'SELECT id FROM affiliates WHERE referral_code = $1',
          [body.referral_code]
        )
        if (affiliate) {
          await client.query(
            'INSERT INTO affiliate_referrals (affiliate_id, tenant_id) VALUES ($1, $2)',
            [affiliate.id, tenant.id]
          )
        }
      }

      await client.query('COMMIT')

      try {
        await sendVerificationEmail(body.email, body.name, verificationToken)
      } catch (emailErr) {
        console.error('Falha ao enviar e-mail de verificação:', emailErr)
      }

      return reply.status(201).send({ needs_verification: true })
    } catch (err: any) {
      await client.query('ROLLBACK')
      if (err.constraint === 'users_email_key') {
        return reply.status(409).send({ error: 'Este e-mail já está cadastrado' })
      }
      if (err.constraint === 'tenants_slug_key') {
        return reply.status(409).send({ error: 'Nome do negócio já cadastrado. Tente uma variação.' })
      }
      throw err
    } finally {
      client.release()
    }
  })

  app.get('/verify-email', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) return reply.status(400).send({ error: 'Token inválido' })

    const { rows: [record] } = await db.query(
      'SELECT user_id, expires_at FROM email_verifications WHERE token = $1',
      [token]
    )

    if (!record) return reply.status(400).send({ error: 'Link inválido ou já utilizado' })
    if (new Date(record.expires_at) < new Date()) {
      return reply.status(400).send({ error: 'Link expirado. Solicite um novo e-mail de verificação.' })
    }

    const { rows: [verifiedUser] } = await db.query(
      'UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING token_version',
      [record.user_id]
    )
    await db.query('DELETE FROM email_verifications WHERE token = $1', [token])

    const { rows: [userRole] } = await db.query(
      'SELECT ur.tenant_id, ur.role FROM user_roles ur WHERE ur.user_id = $1 LIMIT 1',
      [record.user_id]
    )

    const jwtToken = app.jwt.sign(
      { user_id: record.user_id, tenant_id: userRole.tenant_id, role: userRole.role, tv: verifiedUser?.token_version ?? 0 },
      { expiresIn: '7d' }
    )

    return reply.send({ token: jwtToken, verified: true })
  })

  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    let body: z.infer<typeof loginSchema>
    try {
      body = loginSchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: 'E-mail ou senha inválidos' })
      }
      throw err
    }

    const { rows: [user] } = await db.query(
      'SELECT id, password_hash, email_verified, token_version FROM users WHERE email = $1',
      [body.email]
    )

    const check = user
      ? verifyPassword(body.password, user.password_hash)
      : { valid: false, needsRehash: false }
    if (!user || !check.valid) {
      return reply.status(401).send({ error: 'E-mail ou senha incorretos' })
    }

    // Transparently upgrade legacy sha256 hashes to scrypt on successful login
    if (check.needsRehash) {
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(body.password), user.id])
    }

    if (!user.email_verified) {
      return reply.status(401).send({ error: 'email_not_verified' })
    }

    const { rows: [userRole] } = await db.query(
      'SELECT tenant_id, role FROM user_roles WHERE user_id = $1 LIMIT 1',
      [user.id]
    )

    const token = app.jwt.sign(
      { user_id: user.id, tenant_id: userRole?.tenant_id ?? null, role: userRole?.role ?? 'staff', tv: user.token_version ?? 0 },
      { expiresIn: '7d' }
    )

    return reply.send({ token })
  })

  // ── Password reset: request ──────────────────────────────────────────────────
  // Anti-enumeration: always responds 200 with the same generic message,
  // whether or not the e-mail exists. Only the sha256 hash of the token is
  // stored; the raw token goes out by e-mail and expires in 1 hour.
  app.post('/forgot-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const genericResponse = {
      message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir sua senha.',
    }

    let body: z.infer<typeof emailOnlySchema>
    try {
      body = emailOnlySchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: 'E-mail inválido' })
      }
      throw err
    }

    const { rows: [user] } = await db.query(
      'SELECT id, name, email FROM users WHERE email = $1',
      [body.email]
    )
    if (!user) return reply.send(genericResponse)

    const rawToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, sha256Hex(rawToken), expiresAt]
    )

    const baseUrl = process.env.TENANT_WEB_URL ?? 'http://localhost:3002'
    const link = `${baseUrl}/redefinir-senha?token=${rawToken}`
    try {
      await sendPasswordResetEmail(user.email, user.name, link)
    } catch (emailErr) {
      console.error('Falha ao enviar e-mail de redefinição de senha:', emailErr)
    }

    return reply.send(genericResponse)
  })

  // ── Password reset: confirm ──────────────────────────────────────────────────
  app.post('/reset-password', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    let body: z.infer<typeof resetPasswordSchema>
    try {
      body = resetPasswordSchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0]
        const msg = first.path[0] === 'password'
          ? 'A senha deve ter pelo menos 8 caracteres'
          : 'Token inválido'
        return reply.status(400).send({ error: msg })
      }
      throw err
    }

    const tokenHash = sha256Hex(body.token)
    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const { rows: [record] } = await client.query(
        `SELECT id, user_id, expires_at, used_at
           FROM password_reset_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash]
      )

      if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
        await client.query('ROLLBACK')
        return reply.status(400).send({ error: 'Link inválido ou expirado. Solicite uma nova redefinição de senha.' })
      }

      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [hashPassword(body.password), record.user_id]
      )
      await client.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
        [record.id]
      )
      // Invalidate any other outstanding reset tokens for this user
      await client.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [record.user_id]
      )

      // Revoke every existing session: old JWTs die together with the old password
      await bumpTokenVersion(record.user_id, client)

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return reply.send({ message: 'Senha redefinida com sucesso. Faça login com a nova senha.' })
  })

  // ── Resend verification e-mail ───────────────────────────────────────────────
  // Anti-enumeration: always responds 200 with the same generic message.
  app.post('/resend-verification', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const genericResponse = {
      message: 'Se o e-mail estiver cadastrado e ainda não confirmado, você receberá um novo link de confirmação.',
    }

    let body: z.infer<typeof emailOnlySchema>
    try {
      body = emailOnlySchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: 'E-mail inválido' })
      }
      throw err
    }

    const { rows: [user] } = await db.query(
      'SELECT id, name, email, email_verified FROM users WHERE email = $1',
      [body.email]
    )
    if (!user || user.email_verified) return reply.send(genericResponse)

    const verificationToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query('DELETE FROM email_verifications WHERE user_id = $1', [user.id])
      await client.query(
        'INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)',
        [user.id, verificationToken, expiresAt]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    try {
      await sendVerificationEmail(user.email, user.name, verificationToken)
    } catch (emailErr) {
      console.error('Falha ao reenviar e-mail de verificação:', emailErr)
    }

    return reply.send(genericResponse)
  })

  // ── Current user profile ─────────────────────────────────────────────────────
  // The JWT only carries user_id/tenant_id/role; clients call this to display the
  // logged-in user's name/email. Authenticated (unlike the other routes here).
  app.get('/me', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { user_id, tenant_id, role } = request.user

    const { rows: [user] } = await db.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [user_id]
    )
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const { rows: [userRole] } = await db.query(
      'SELECT role FROM user_roles WHERE user_id = $1 AND tenant_id = $2',
      [user_id, tenant_id]
    )

    return reply.send({ id: user.id, name: user.name, email: user.email, role: userRole?.role ?? role })
  })

  // ── Account deletion (required by Apple 5.1.1(v) and Google Play) ────────────
  // Owner deletes the whole business (cascades customers, appointments, messages,
  // conversations, WhatsApp instance, tokens, subscription). Staff removes only
  // their own membership + user record.
  app.delete('/account', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { user_id, tenant_id, role } = request.user

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      if ((role === 'owner' || role === 'root') && tenant_id) {
        // Deleting the tenant cascades all tenant-scoped data via FK ON DELETE CASCADE
        await client.query('DELETE FROM tenants WHERE id = $1', [tenant_id])
      } else {
        // Non-owner: just remove this user's membership in the tenant
        await client.query('DELETE FROM user_roles WHERE user_id = $1 AND tenant_id = $2', [user_id, tenant_id])
      }

      // Remove the user account itself if it no longer belongs to any tenant
      const { rows: remaining } = await client.query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 LIMIT 1', [user_id]
      )
      if (remaining.length === 0) {
        await client.query('DELETE FROM users WHERE id = $1', [user_id])
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // NOTE: any active Mercado Pago subscription must be cancelled out-of-band
    // (MP has no auto-cancel on our side). Tracked as a follow-up.
    return reply.send({ deleted: true })
  })
}
