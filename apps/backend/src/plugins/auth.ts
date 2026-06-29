import { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

const authPlugin = fp(async (app) => {
  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch {
      reply.status(401).send({ error: 'Unauthorized' })
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
