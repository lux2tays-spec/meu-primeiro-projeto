import { db } from './db'

// Records a Root Admin action for governance. NEVER pass raw secrets in `summary`
// — the caller masks/hashes them first. Fire-and-forget: a logging failure must
// never block the actual operation.

export interface AuditEntry {
  actorId?: string | null
  actorEmail?: string | null
  action: string          // 'settings.update' | 'plan.update' | 'tenant.update' | ...
  target?: string | null  // config key, plan slug, tenant id
  summary?: string | null // human-readable, already masked
  ip?: string | null
}

export async function logAdminAction(e: AuditEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (actor_id, actor_email, action, target, summary, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [e.actorId ?? null, e.actorEmail ?? null, e.action, e.target ?? null, e.summary ?? null, e.ip ?? null]
    )
  } catch (err) {
    console.error('[audit] falha ao registrar ação:', err)
  }
}

/** Helper for routes: pulls actor + ip from the Fastify request. */
export function auditFromRequest(request: any, action: string, target?: string, summary?: string): AuditEntry {
  return {
    actorId: request.user?.user_id ?? null,
    actorEmail: request.user?.email ?? null,
    action,
    target: target ?? null,
    summary: summary ?? null,
    ip: (request.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip || null,
  }
}
