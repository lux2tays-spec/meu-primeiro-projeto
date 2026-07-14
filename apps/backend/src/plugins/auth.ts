import { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'
import { getTokenVersion } from '../lib/tokenVersion'

const authPlugin = fp(async (app) => {
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    // Revocation check: the token's `tv` claim must match the user's current
    // token_version (Redis-cached). Tokens issued before migration 023 have no
    // `tv` claim and are treated as version 0 (the column default), so existing
    // sessions keep working until they expire or a bump revokes them. Applies
    // to every user, including root (tenant_id null).
    const tokenVersion = typeof request.user?.tv === 'number' ? request.user.tv : 0
    const currentVersion = await getTokenVersion(request.user.user_id)
    if (currentVersion === null || tokenVersion !== currentVersion) {
      return reply.status(401).send({ error: 'Sessão invalidada. Faça login novamente.' })
    }
  })

  app.decorate('requireRoot', async (request: any, reply: any) => {
    await (app as any).authenticate(request, reply)
    if (request.user?.role !== 'root') {
      reply.status(403).send({ error: 'Forbidden' })
    }
  })
})

export { authPlugin }
