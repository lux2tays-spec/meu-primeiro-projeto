import { db } from '../lib/db'

// Exclusão DEFINITIVA de contas que passaram da janela de reativação (soft-delete
// via deletion_requested_at — migration 056). Honra a LGPD: 30 dias após o pedido
// de exclusão, os dados do tenant são apagados de vez (cascade). Quem logou nesse
// período teve deletion_requested_at limpo no /login (reativação) e não é afetado.
const GRACE_DAYS = 30

export async function runTenantPurge(): Promise<void> {
  const { rows } = await db.query(
    `SELECT id FROM tenants
      WHERE deletion_requested_at IS NOT NULL
        AND deletion_requested_at < NOW() - INTERVAL '${GRACE_DAYS} days'
      LIMIT 100`
  )
  for (const t of rows) {
    try {
      // Cascade FK apaga todos os dados do tenant.
      await db.query('DELETE FROM tenants WHERE id = $1', [t.id])
      // Remove usuários órfãos (sem nenhum vínculo restante).
      await db.query(
        `DELETE FROM users u
          WHERE NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)`
      )
      console.log(`[tenant-purge] tenant ${t.id} excluído definitivamente (janela de ${GRACE_DAYS} dias vencida)`)
    } catch (err) {
      console.error(`[tenant-purge] falha ao excluir tenant ${t.id}:`, err)
    }
  }
}

export function startTenantPurge(): void {
  setTimeout(() => {
    runTenantPurge().catch((e) => console.error('[tenant-purge] startup error:', e))
    setInterval(() => {
      runTenantPurge().catch((e) => console.error('[tenant-purge] run error:', e))
    }, 12 * 60 * 60 * 1000) // 2x/dia
  }, 60_000)
}
