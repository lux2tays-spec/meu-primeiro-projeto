/** @type {import('next').NextConfig} */

// Content-Security-Policy compatible with Next.js (needs inline/eval for its
// runtime). Tighten script-src further once nonces are wired if desired.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

const isProd = process.env.NODE_ENV === 'production'

const securityHeaders = [
  // CSP apenas em produção — em dev a CSP estrita bloquearia o HMR (ws://) e as
  // chamadas à API em http://localhost:3000.
  ...(isProd ? [{ key: 'Content-Security-Policy', value: csp }] : []),
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig = {
  transpilePackages: ['@agendabot/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
module.exports = nextConfig
