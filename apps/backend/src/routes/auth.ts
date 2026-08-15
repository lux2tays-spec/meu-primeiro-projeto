import { FastifyPluginAsync } from 'fastify'
import { z, ZodError } from 'zod'
import { db } from '../lib/db'
import { sendEmailChangeEmail, sendPasswordResetEmail, sendVerificationEmail } from '../lib/email'
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

const updateMeSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(8).optional(),
})

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
})

const changeEmailSchema = z.object({
  new_email: z.string().email(),
  password: z.string().min(1),
})

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

// ── Normalização de identidade (AUTH-4 / AUTH-8 / AUTH-9) ────────────────────

/** AUTH-4: normalizes an e-mail (trim + lowercase) before any query/insert. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * AUTH-9: normalizes a Brazilian phone to digits only, prefixed with country
 * code 55 — e.g. "(11) 98765-4321" → "5511987654321". Best effort: unusual
 * lengths are kept as bare digits instead of blocking the signup.
 */
export function normalizeBrazilPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  digits = digits.replace(/^0+/, '') // drop trunk zero(s), e.g. "011 98765-4321"
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits // already 55 + DDD + number
  }
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}` // DDD + number without country code
  }
  return digits
}

/** Slug base from a business name: accents stripped, lowercase, hyphenated. */
function slugifyBusinessName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics so 'Ação' → 'acao', not ''
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

type Queryable = { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }

/**
 * AUTH-8: generates a unique tenant slug. On collision, appends a short random
 * suffix and retries (repeated trade names must not block the signup). When the
 * normalized slug comes out empty (name made only of accents/symbols), falls
 * back to a generated one.
 */
export async function generateUniqueSlug(q: Queryable, businessName: string): Promise<string> {
  const base = slugifyBusinessName(businessName) || `negocio-${crypto.randomBytes(3).toString('hex')}`
  let slug = base
  for (let attempt = 0; attempt < 5; attempt++) {
    const { rows } = await q.query('SELECT 1 FROM tenants WHERE slug = $1', [slug])
    if (rows.length === 0) return slug
    slug = `${base}-${crypto.randomBytes(3).toString('hex')}`
  }
  return `${base}-${crypto.randomBytes(6).toString('hex')}`
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
    // AUTH-12: 8/hora com resposta amigável em pt-BR ao estourar o limite
    config: {
      rateLimit: {
        max: 8,
        timeWindow: '1 hour',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error: 'Muitas tentativas de cadastro. Aguarde um pouco e tente novamente mais tarde.',
        }),
      },
    },
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

    const email = normalizeEmail(body.email)
    const phone = normalizeBrazilPhone(body.phone)
    const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const slug = await generateUniqueSlug(client, body.business_name)

      const { rows: [tenant] } = await client.query(
        `INSERT INTO tenants (name, slug, plan, status, trial_ends_at, max_agendas, max_users)
         VALUES ($1, $2, 'free', 'trial', $3, 1, 1) RETURNING id`,
        [body.business_name, slug, trialEndsAt]
      )

      const { rows: [user] } = await client.query(
        `INSERT INTO users (name, email, phone, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.name, email, phone, hashPassword(body.password)]
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
        await sendVerificationEmail(email, body.name, verificationToken)
      } catch (emailErr) {
        console.error('Falha ao enviar e-mail de verificação:', emailErr)
      }

      return reply.status(201).send({ needs_verification: true })
    } catch (err: any) {
      await client.query('ROLLBACK')
      if (err.constraint === 'users_email_key' || err.constraint === 'users_email_lower_key') {
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

  // AUTH-6: idempotent — e-mail scanners (Outlook SafeLinks etc.) pre-fetch the
  // GET before the user's real click, so a re-click must still succeed.
  app.get('/verify-email', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) return reply.status(400).send({ error: 'Link inválido' })

    const { rows: [record] } = await db.query(
      `SELECT ev.user_id, ev.expires_at, u.email_verified, u.token_version
         FROM email_verifications ev
         JOIN users u ON u.id = ev.user_id
        WHERE ev.token = $1`,
      [token]
    )

    if (!record) {
      return reply.status(400).send({
        error: 'Link inválido ou já utilizado. Se você já confirmou seu e-mail, é só fazer login normalmente.',
      })
    }

    const expired = new Date(record.expires_at) < new Date()
    if (expired && !record.email_verified) {
      return reply.status(400).send({ error: 'Link expirado. Solicite um novo e-mail de verificação.' })
    }

    let tokenVersion = record.token_version ?? 0
    if (!record.email_verified) {
      const { rows: [verifiedUser] } = await db.query(
        'UPDATE users SET email_verified = TRUE WHERE id = $1 RETURNING token_version',
        [record.user_id]
      )
      tokenVersion = verifiedUser?.token_version ?? tokenVersion
      // Instead of deleting the token, keep it alive for a short re-click
      // window: the second access (the user's real click) also succeeds above.
      await db.query(
        `UPDATE email_verifications
            SET expires_at = LEAST(expires_at, NOW() + INTERVAL '10 minutes')
          WHERE token = $1`,
        [token]
      )
    } else if (expired) {
      // Already verified + stale link: succeed once more and retire the link.
      await db.query('DELETE FROM email_verifications WHERE token = $1', [token])
    }

    // AUTH-7: the membership/tenant may have been removed meanwhile — fall back
    // like /login does instead of crashing with a 500.
    const { rows: [userRole] } = await db.query(
      'SELECT ur.tenant_id, ur.role FROM user_roles ur WHERE ur.user_id = $1 LIMIT 1',
      [record.user_id]
    )

    const jwtToken = app.jwt.sign(
      { user_id: record.user_id, tenant_id: userRole?.tenant_id ?? null, role: userRole?.role ?? 'staff', tv: tokenVersion },
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
      'SELECT id, password_hash, email_verified, token_version FROM users WHERE LOWER(email) = $1',
      [normalizeEmail(body.email)]
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

    // #11: registra o último login do tenant (fire-and-forget).
    if (userRole?.tenant_id) {
      db.query('UPDATE tenants SET last_login_at = NOW(), last_seen_at = NOW() WHERE id = $1', [userRole.tenant_id])
        .catch(() => { /* best-effort */ })
    }

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
      'SELECT id, name, email FROM users WHERE LOWER(email) = $1',
      [normalizeEmail(body.email)]
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
      'SELECT id, name, email, email_verified FROM users WHERE LOWER(email) = $1',
      [normalizeEmail(body.email)]
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
      'SELECT id, name, email, phone, email_verified FROM users WHERE id = $1',
      [user_id]
    )
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const { rows: [membership] } = await db.query(
      `SELECT ur.role, t.name AS business_name
         FROM user_roles ur
         JOIN tenants t ON t.id = ur.tenant_id
        WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
      [user_id, tenant_id]
    )

    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: membership?.role ?? role,
      email_verified: !!user.email_verified,
      business_name: membership?.business_name ?? null,
    })
  })

  // ── Handoff app → web ────────────────────────────────────────────────────────
  // Emite um token de CURTA duração (5 min) para o app abrir a web já autenticado
  // — ex.: concluir/gerenciar a assinatura no navegador sem novo login (reduz o
  // abandono). Reusa as claims do usuário já autenticado; TTL curto limita o risco
  // de o token vazar pela URL. A web consome em /entrar e limpa a URL na hora.
  app.post('/web-handoff', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { user_id, tenant_id, role, tv } = request.user as any
    const token = app.jwt.sign(
      { user_id, tenant_id, role, tv: tv ?? 0 },
      { expiresIn: '5m' }
    )
    return reply.send({ token })
  })

  // ── Update own profile (name/phone only — e-mail has its own verified flow) ──
  app.patch('/me', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    let body: z.infer<typeof updateMeSchema>
    try {
      body = updateMeSchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.status(400).send({ error: zodErrorMessage(err) })
      }
      throw err
    }

    if (body.name === undefined && body.phone === undefined) {
      return reply.status(400).send({ error: 'Nada para atualizar' })
    }

    const { rows: [user] } = await db.query(
      `UPDATE users
          SET name = COALESCE($1, name),
              phone = COALESCE($2, phone)
        WHERE id = $3
        RETURNING id, name, email, phone`,
      [body.name?.trim() ?? null, body.phone?.trim() ?? null, request.user.user_id]
    )
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    // Equipe = Profissionais: se mudou o nome, mantém o profissional vinculado em
    // sincronia (senão a agenda/serviços seguem com o nome antigo — ex.: renomeou
    // no Perfil e o profissional continuava "Jack fpadrao").
    if (body.name !== undefined) {
      await db.query(
        'UPDATE professionals SET name = $1 WHERE user_id = $2 AND active = TRUE',
        [body.name.trim(), request.user.user_id]
      ).catch((e) => console.error('[auth/me] falha ao sincronizar nome do profissional:', e))
    }

    return reply.send({ id: user.id, name: user.name, email: user.email, phone: user.phone })
  })

  // ── Change own password (keeps the current session valid) ────────────────────
  app.post('/change-password', {
    preHandler: [(app as any).authenticate],
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    let body: z.infer<typeof changePasswordSchema>
    try {
      body = changePasswordSchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0]
        const msg = first.path[0] === 'new_password'
          ? 'A nova senha deve ter pelo menos 8 caracteres'
          : 'Informe sua senha atual'
        return reply.status(400).send({ error: msg })
      }
      throw err
    }

    const { rows: [user] } = await db.query(
      'SELECT id, password_hash, google_sub FROM users WHERE id = $1',
      [request.user.user_id]
    )
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const check = verifyPassword(body.current_password, user.password_hash)
    if (!check.valid) {
      // Google-only accounts have a random placeholder hash the user never saw.
      if (user.google_sub) {
        return reply.status(400).send({
          error: 'Sua conta entra com o Google e não tem senha própria. Use "Esqueci minha senha" na tela de login para criar uma.',
        })
      }
      return reply.status(400).send({ error: 'Senha atual incorreta' })
    }

    // Deliberately does NOT bump token_version: the user stays logged in on this
    // device. Password *reset* (forgot-password) is the flow that revokes sessions.
    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hashPassword(body.new_password), user.id]
    )

    return reply.send({ message: 'Senha alterada com sucesso.' })
  })

  // ── Change own e-mail: step 1 — request + confirmation link to the NEW e-mail ─
  // users.email only changes after the link is clicked (GET /confirm-email-change).
  app.post('/change-email', {
    preHandler: [(app as any).authenticate],
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    let body: z.infer<typeof changeEmailSchema>
    try {
      body = changeEmailSchema.parse(request.body)
    } catch (err) {
      if (err instanceof ZodError) {
        const first = err.issues[0]
        const msg = first.path[0] === 'new_email' ? 'Informe um e-mail válido' : 'Informe sua senha'
        return reply.status(400).send({ error: msg })
      }
      throw err
    }

    const newEmail = normalizeEmail(body.new_email)

    const { rows: [user] } = await db.query(
      'SELECT id, name, email, password_hash, google_sub FROM users WHERE id = $1',
      [request.user.user_id]
    )
    if (!user) return reply.status(404).send({ error: 'Usuário não encontrado' })

    const check = verifyPassword(body.password, user.password_hash)
    if (!check.valid) {
      if (user.google_sub) {
        return reply.status(400).send({
          error: 'Sua conta entra com o Google e não tem senha própria. Use "Esqueci minha senha" na tela de login para criar uma antes de trocar o e-mail.',
        })
      }
      return reply.status(400).send({ error: 'Senha incorreta' })
    }

    if (newEmail === normalizeEmail(user.email ?? '')) {
      return reply.status(400).send({ error: 'O novo e-mail é igual ao atual' })
    }

    const { rows: [taken] } = await db.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [newEmail])
    if (taken) {
      return reply.status(409).send({ error: 'Este e-mail já está em uso por outra conta' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      // Only one pending request per user — a new request replaces the old one
      await client.query('DELETE FROM email_change_requests WHERE user_id = $1', [user.id])
      await client.query(
        'INSERT INTO email_change_requests (user_id, new_email, token, expires_at) VALUES ($1, $2, $3, $4)',
        [user.id, newEmail, token, expiresAt]
      )
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    try {
      await sendEmailChangeEmail(newEmail, user.name, token)
    } catch (emailErr) {
      console.error('Falha ao enviar e-mail de confirmação de troca:', emailErr)
      return reply.send({
        sent: false,
        message: 'Não foi possível enviar o e-mail de confirmação agora. Tente novamente em alguns minutos.',
      })
    }

    return reply.send({
      sent: true,
      message: 'Enviamos um link de confirmação para o novo e-mail. A troca só acontece após a confirmação.',
    })
  })

  // ── Change own e-mail: step 2 — confirm via the link sent to the new address ──
  app.get('/confirm-email-change', async (request, reply) => {
    const { token } = request.query as { token?: string }
    if (!token) return reply.status(400).send({ error: 'Link inválido' })

    const { rows: [record] } = await db.query(
      'SELECT id, user_id, new_email, expires_at FROM email_change_requests WHERE token = $1',
      [token]
    )
    if (!record) return reply.status(400).send({ error: 'Link inválido ou já utilizado' })
    if (new Date(record.expires_at) < new Date()) {
      return reply.status(400).send({ error: 'Link expirado. Solicite a troca de e-mail novamente.' })
    }

    try {
      // The link proves the user controls the new inbox — mark it verified too
      await db.query(
        'UPDATE users SET email = $1, email_verified = TRUE WHERE id = $2',
        [record.new_email, record.user_id]
      )
    } catch (err: any) {
      if (err.constraint === 'users_email_key' || err.constraint === 'users_email_lower_key') {
        return reply.status(409).send({ error: 'Este e-mail já está em uso por outra conta' })
      }
      throw err
    }
    await db.query('DELETE FROM email_change_requests WHERE user_id = $1', [record.user_id])

    return reply.send({ message: 'E-mail alterado com sucesso. Use o novo e-mail no próximo login.' })
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
