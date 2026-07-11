import '@fastify/jwt'

// Type of `request.user` after jwtVerify() — augment @fastify/jwt's FastifyJWT
// (this is what drives FastifyRequest.user when @fastify/jwt is registered).
declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      user_id: string
      tenant_id: string | null
      role: 'root' | 'owner' | 'admin' | 'staff'
      iat: number
      exp: number
    }
  }
}
