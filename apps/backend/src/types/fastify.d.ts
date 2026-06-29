declare module 'fastify' {
  interface FastifyRequest {
    user: {
      user_id: string
      tenant_id: string | null
      role: 'root' | 'owner' | 'admin' | 'staff'
      iat: number
      exp: number
    }
  }
}
