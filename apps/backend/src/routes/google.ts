import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { db } from '../lib/db'
import { verifyGoogleIdToken, exchangeCodeForTokens } from '../services/google-calendar'
import crypto from 'node:crypto'

function hashPassword(password: string) {
  return crypto.createHash('sha256').update(password + process.env.JWT_SECRET).digest('hex')
}

export const googleRoutes: FastifyPluginAsync = async (app) => {
  // ── Auth: login/register via Google ID token ────────────────────────────────
  app.post('/auth/google', async (request, reply) => {
    const { id_token, business_name, phone, referral_code } = request.body as {
      id_token: string
      business_name?: string
      phone?: string
      referral_code?: string
    }

    const googleUser = await verifyGoogleIdToken(id_token)
    const { sub: googleSub, email, name } = googleUser

    // Find existing user by google_sub or email
    const { rows: [existing] } = await db.query(
      'SELECT id FROM users WHERE google_sub = $1 OR email = $2 LIMIT 1',
      [googleSub, email]
    )

    if (existing) {
      // Update google_sub if not set (user registered via email first, now using Google)
      await db.query(
        'UPDATE users SET google_sub = $1 WHERE id = $2 AND google_sub IS NULL',
        [googleSub, existing.id]
      )

      const { rows: [userRole] } = await db.query(
        'SELECT tenant_id, role FROM user_roles WHERE user_id = $1 LIMIT 1',
        [existing.id]
      )

      const token = app.jwt.sign(
        { user_id: existing.id, tenant_id: userRole?.tenant_id ?? null, role: userRole?.role ?? 'staff' },
        { expiresIn: '7d' }
      )
      return reply.send({ token, is_new: false })
    }

    // New user — requires business_name for first registration
    if (!business_name) {
      return reply.status(422).send({ error: 'business_name_required', message: 'Informe o nome do seu estabelecimento' })
    }

    const slug = business_name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()

    const client = await db.connect()
    try {
      await client.query('BEGIN')

      const { rows: [tenant] } = await client.query(
        `INSERT INTO tenants (name, slug, plan, status, trial_ends_at, max_agendas, max_users)
         VALUES ($1, $2, 'free', 'trial', $3, 1, 1) RETURNING id`,
        [business_name, slug, trialEndsAt]
      )

      const { rows: [user] } = await client.query(
        `INSERT INTO users (name, email, phone, password_hash, google_sub, email_verified)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
        [name, email, phone ?? null, hashPassword(crypto.randomBytes(16).toString('hex')), googleSub]
      )

      await client.query(
        'INSERT INTO user_roles (user_id, tenant_id, role) VALUES ($1, $2, $3)',
        [user.id, tenant.id, 'owner']
      )

      await client.query('INSERT INTO agent_config (tenant_id) VALUES ($1)', [tenant.id])

      if (referral_code) {
        const { rows: [affiliate] } = await client.query(
          'SELECT id FROM affiliates WHERE referral_code = $1', [referral_code]
        )
        if (affiliate) {
          await client.query(
            'INSERT INTO affiliate_referrals (affiliate_id, tenant_id) VALUES ($1, $2)',
            [affiliate.id, tenant.id]
          )
        }
      }

      await client.query('COMMIT')

      const jwtToken = app.jwt.sign(
        { user_id: user.id, tenant_id: tenant.id, role: 'owner' },
        { expiresIn: '7d' }
      )

      return reply.status(201).send({ token: jwtToken, is_new: true, tenant_id: tenant.id })
    } catch (err: any) {
      await client.query('ROLLBACK')
      if (err.constraint === 'users_email_key') {
        return reply.status(409).send({ error: 'Email already in use' })
      }
      throw err
    } finally {
      client.release()
    }
  })

  // ── Google Calendar: exchange auth code for tokens ──────────────────────────
  app.post('/google-calendar/connect', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { code, redirect_uri } = request.body as { code: string; redirect_uri: string }
    const { user_id, tenant_id } = request.user

    const tokens = await exchangeCodeForTokens(code, redirect_uri)
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    await db.query(
      `INSERT INTO google_calendar_tokens (user_id, tenant_id, access_token, refresh_token, token_expiry, sync_enabled)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token = $3, refresh_token = $4, token_expiry = $5, sync_enabled = TRUE, updated_at = NOW()`,
      [user_id, tenant_id, tokens.access_token, tokens.refresh_token, expiry]
    )

    return reply.send({ connected: true })
  })

  // ── Google Calendar: get connection status ──────────────────────────────────
  app.get('/google-calendar/status', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { user_id } = request.user
    const { rows: [token] } = await db.query(
      'SELECT sync_enabled, calendar_id, updated_at FROM google_calendar_tokens WHERE user_id = $1',
      [user_id]
    )
    return reply.send({ connected: !!token, sync_enabled: token?.sync_enabled ?? false, calendar_id: token?.calendar_id })
  })

  // ── Google Calendar: toggle sync ────────────────────────────────────────────
  app.patch('/google-calendar/settings', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { sync_enabled } = request.body as { sync_enabled: boolean }
    const { user_id } = request.user

    await db.query(
      'UPDATE google_calendar_tokens SET sync_enabled = $1, updated_at = NOW() WHERE user_id = $2',
      [sync_enabled, user_id]
    )
    return reply.send({ sync_enabled })
  })

  // ── Google Calendar: disconnect ─────────────────────────────────────────────
  app.delete('/google-calendar/disconnect', {
    preHandler: [(app as any).authenticate],
  }, async (request, reply) => {
    const { user_id } = request.user
    await db.query('DELETE FROM google_calendar_tokens WHERE user_id = $1', [user_id])
    return reply.send({ disconnected: true })
  })
}
