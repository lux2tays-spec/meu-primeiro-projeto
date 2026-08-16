import { db } from '../lib/db'
import { getPaymentConfig } from '../lib/paymentConfig'
import { cancelPreapproval } from '../services/mercadopago'

// Reprocessa cancelamentos de assinatura Mercado Pago que falharam na hora da
// exclusão da conta (fila pending_mp_cancellations — migration 055). Garante que
// nenhum ex-cliente continue sendo cobrado por instabilidade momentânea do MP.
// Desiste após muitas tentativas para não repetir para sempre um id inválido.
const MAX_ATTEMPTS = 8

export async function runMpCancellationRetry(): Promise<void> {
  const { rows } = await db.query(
    `SELECT id, mp_subscription_id, attempts FROM pending_mp_cancellations
      WHERE done_at IS NULL AND attempts < $1
      ORDER BY created_at ASC LIMIT 50`,
    [MAX_ATTEMPTS]
  )
  if (rows.length === 0) return

  const cfg = await getPaymentConfig().catch(() => null)
  if (!cfg) return // sem config de pagamento da plataforma não há como cancelar

  for (const row of rows) {
    try {
      const result = await cancelPreapproval(cfg, row.mp_subscription_id)
      // 404 = a preapproval não existe mais no MP → considerar resolvido.
      const gone = !result.ok && /_404$|not.?found/i.test(result.reason)
      if (result.ok || gone) {
        await db.query('UPDATE pending_mp_cancellations SET done_at = NOW() WHERE id = $1', [row.id])
      } else {
        throw new Error(result.reason || 'mp_cancel_failed')
      }
    } catch (err: any) {
      await db.query(
        'UPDATE pending_mp_cancellations SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
        [row.id, String(err?.message ?? 'unknown').slice(0, 500)]
      )
    }
  }
  console.log(`[mp-cancel-retry] processou ${rows.length} pendência(s)`)
}

export function startMpCancellationRetry(): void {
  setTimeout(() => {
    runMpCancellationRetry().catch((e) => console.error('[mp-cancel-retry] startup error:', e))
    setInterval(() => {
      runMpCancellationRetry().catch((e) => console.error('[mp-cancel-retry] run error:', e))
    }, 30 * 60 * 1000) // a cada 30 min
  }, 40_000)
}
