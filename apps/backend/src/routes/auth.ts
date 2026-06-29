import { FastifyPluginAsync } from 'fastify'
import { z, ZodError } from 'zod'
import { db } from '../lib/db'
import { sendVerificationEmail } from '../lib/email'
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

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex')
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
  app.post('/register', async (request, reply) => {
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

    await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [record.user_id])
    await db.query('DELETE FROM email_verifications WHERE token = $1', [token])

    const { rows: [userRole] } = await db.query(
      'SELECT ur.tenant_id, ur.role FROM user_roles ur WHERE ur.user_id = $1 LIMIT 1',
      [record.user_id]
    )

    const jwtToken = app.jwt.sign(
      { user_id: record.user_id, tenant_id: userRole.tenant_id, role: userRole.role },
      { expiresIn: '7d' }
    )

    return reply.send({ token: jwtToken, verified: true })
  })

  app.post('/login', async (request, reply) => {
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
      'SELECT id, password_hash, email_verified FROM users WHERE email = $1',
      [body.email]
    )

    if (!user || user.password_hash !== hashPassword(body.password)) {
      return reply.status(401).send({ error: 'E-mail ou senha incorretos' })
    }

    if (!user.email_verified) {
      return reply.status(403).send({ error: 'email_not_verified' })
    }

    const { rows: [userRole] } = await db.query(
      'SELECT tenant_id, role FROM user_roles WHERE user_id = $1 LIMIT 1',
      [user.id]
    )

    const token = app.jwt.sign(
      { user_id: user.id, tenant_id: userRole?.tenant_id ?? null, role: userRole?.role ?? 'staff' },
      { expiresIn: '7d' }
    )

    return reply.send({ token })
  })
}
