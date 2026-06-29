import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL!)

export const BOT_CONTEXT_TTL = 60 * 30       // 30 min
export const TENANT_CONFIG_TTL = 60 * 5      // 5 min
export const QR_CODE_TTL = 60                 // 60 sec
