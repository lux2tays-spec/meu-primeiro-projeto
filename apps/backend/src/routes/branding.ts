import { FastifyPluginAsync } from 'fastify'
import { db } from '../lib/db'
import { getBrandConfig } from '../lib/brandConfig'
import { getSupportBotConfig } from '../lib/supportBotConfig'

// Public branding — consumed by mobile + tenant-web at runtime so the platform
// owner can rebrand (name, colors, logo, favicon) WITHOUT a redeploy. Everything
// here is public and non-secret; the apps always ship bundled defaults as a
// fallback when this endpoint is unreachable.

export const THEME_DEFAULTS = {
  primary: '#2CB86E',
  primary_dark: '#1C9DAA',
  accent: '#1D62B5',
  sidebar: '#1E3C66',
}

export const ASSET_SLOTS = ['logo', 'logo_dark', 'logo_transparent', 'favicon', 'icon'] as const

export const brandingRoutes: FastifyPluginAsync = async (app) => {
  // Aggregate branding (name, tagline, colors, asset URLs).
  app.get('/branding', async (_request, reply) => {
    const brand = await getBrandConfig()
    const { rows: themeRows } = await db.query(
      "SELECT value FROM platform_settings WHERE key = 'branding_theme'"
    )
    const colors = { ...THEME_DEFAULTS, ...(themeRows[0]?.value ?? {}) }

    // Which asset slots actually exist (+ cache-busting version = mtime epoch).
    const { rows: slots } = await db.query(
      'SELECT slot, EXTRACT(EPOCH FROM updated_at)::bigint AS v FROM branding_assets'
    )
    const assets: Record<string, string> = {}
    for (const s of slots as any[]) assets[s.slot] = `/branding/asset/${s.slot}?v=${s.v}`

    reply.header('Cache-Control', 'public, max-age=60')
    return reply.send({
      app_name: brand.app_name,
      tagline: brand.tagline,
      support_email: brand.support_email,
      support_whatsapp: brand.support_whatsapp,
      privacy_url: brand.privacy_url,
      terms_url: brand.terms_url,
      colors,
      assets,
    })
  })

  // Public support-bot presence — the landing page shows a floating WhatsApp
  // button ONLY when the system bot is enabled AND connected (so it never links
  // to a dead number). Exposes just the digits-only phone; nothing secret.
  app.get('/support-bot/public', async (_request, reply) => {
    const cfg = await getSupportBotConfig()
    const active = cfg.enabled && cfg.status === 'connected' && !!cfg.phone_number
    reply.header('Cache-Control', 'public, max-age=30')
    return reply.send({
      active,
      phone_number: active ? cfg.phone_number : null,
    })
  })

  // Serve a single asset with its content-type (bytea → binary).
  app.get<{ Params: { slot: string } }>('/branding/asset/:slot', async (request, reply) => {
    const { rows: [a] } = await db.query(
      'SELECT content_type, data FROM branding_assets WHERE slot = $1', [request.params.slot]
    )
    if (!a) return reply.status(404).send({ error: 'not found' })
    reply.header('Content-Type', a.content_type)
    reply.header('Cache-Control', 'public, max-age=300')
    return reply.send(a.data)
  })
}
