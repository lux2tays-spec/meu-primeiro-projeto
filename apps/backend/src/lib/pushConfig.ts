import { db } from './db'
import { redis } from './redis'
import { decrypt } from './crypto'

// Configuração de Push (Notificações) — editável pelo Root Admin, guardada em
// platform_settings 'push_config', cacheada no Redis e invalidada ao salvar.
//
//  eas_project_id     — id do projeto EAS/Expo (o app usa para gerar o push token).
//  expo_access_token  — token de acesso da Expo (opcional): quando presente, o
//                       backend envia os pushes autenticado (mais seguro). Secret.
//
// Todos os campos caem no env legado quando vazios, para um deploy sem o painel
// preenchido continuar funcionando.

const CACHE_TTL = 60
const CACHE_KEY = 'integration:push:config'

export type PushConfig = {
  eas_project_id: string
  expo_access_token: string
}

const DEFAULTS: PushConfig = { eas_project_id: '', expo_access_token: '' }

export async function getPushConfig(): Promise<PushConfig> {
  const cached = await redis.get(CACHE_KEY)
  if (cached) return JSON.parse(cached)
  const { rows: [row] } = await db.query('SELECT value FROM platform_settings WHERE key = $1', ['push_config'])
  const cfg: PushConfig = { ...DEFAULTS, ...(row?.value ?? {}) }
  cfg.expo_access_token = decrypt(cfg.expo_access_token)
  if (!cfg.eas_project_id) cfg.eas_project_id = process.env.EAS_PROJECT_ID ?? ''
  if (!cfg.expo_access_token) cfg.expo_access_token = process.env.EXPO_ACCESS_TOKEN ?? ''
  await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(cfg))
  return cfg
}

export async function invalidatePushConfig(): Promise<void> {
  await redis.del(CACHE_KEY)
}
