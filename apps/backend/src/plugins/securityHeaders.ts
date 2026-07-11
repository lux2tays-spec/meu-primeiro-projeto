import fp from 'fastify-plugin'

// Security headers without an external dependency (equivalent to a minimal
// helmet). Applied to every response via onSend.

const securityHeadersPlugin = fp(async (app) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-DNS-Prefetch-Control', 'off')
    reply.header('Cross-Origin-Opener-Policy', 'same-origin')
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    return payload
  })
})

export { securityHeadersPlugin }
