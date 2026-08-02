import { db } from './db'

// Cria um alerta para o Root Admin (caixa da plataforma). Best-effort: uma falha
// aqui nunca deve derrubar o fluxo que a gerou.
export async function createAdminAlert(params: {
  type: string
  tenantId?: string | null
  message: string
  data?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO admin_alerts (type, tenant_id, message, data) VALUES ($1, $2, $3, $4)`,
      [params.type, params.tenantId ?? null, params.message, params.data ? JSON.stringify(params.data) : null]
    )
  } catch (err) {
    console.error('[adminAlerts] falha ao criar alerta:', err)
  }
}
