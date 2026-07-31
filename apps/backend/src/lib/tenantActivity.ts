import { db } from './db'

// Registra uma atividade no log do tenant (visível ao proprietário). Best-effort:
// nunca deve derrubar a operação principal — falhas são só logadas.
export async function logTenantActivity(params: {
  tenantId: string
  actorId?: string | null
  actorName?: string | null
  action: string
  target?: string | null
  summary?: string | null
  data?: Record<string, unknown> | null
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO tenant_activity_log (tenant_id, actor_id, actor_name, action, target, summary, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.tenantId,
        params.actorId ?? null,
        params.actorName ?? null,
        params.action,
        params.target ?? null,
        params.summary ?? null,
        params.data ? JSON.stringify(params.data) : null,
      ]
    )
  } catch (err) {
    console.error('[tenant-activity] falha ao gravar log:', err)
  }
}
