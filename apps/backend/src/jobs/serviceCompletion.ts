import { db } from '../lib/db'
import { createNotification, notifyTenantManagers } from '../lib/notifications'

// Ponto 4 — aviso de conclusão de serviço.
//
// Quando o horário de um agendamento PASSA e ele ainda não foi concluído/cancelado,
// avisa o PROFISSIONAL responsável (apenas ele) com o lembrete de "finalizar
// serviço" e link para o calendário (marcar como realizado). Se o profissional
// não tiver usuário vinculado, os gestores recebem para não perder o aviso.
//
// Idempotente: cada agendamento gera no MÁXIMO um aviso, reivindicado via
// notification_log (kind='service_completion') com INSERT ... ON CONFLICT.
// Janela de 2 dias evita disparar em agendamentos antigos ao ligar o job.

const DUE_QUERY = `
  SELECT a.id, a.tenant_id, a.professional_id,
         p.user_id AS professional_user_id, p.name AS professional_name,
         s.name AS service_name, c.name AS customer_name,
         to_char(a.starts_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS when_fmt
  FROM appointments a
  JOIN services s ON s.id = a.service_id
  JOIN professionals p ON p.id = a.professional_id
  JOIN customers c ON c.id = a.customer_id
  WHERE a.status IN ('pending', 'confirmed')
    AND a.ends_at < NOW()
    -- janela curta: o lembrete "finalizar serviço" só faz sentido logo após o
    -- horário; também limita qualquer rajada de backlog na primeira execução.
    AND a.ends_at > NOW() - interval '6 hours'
    AND NOT EXISTS (
      SELECT 1 FROM notification_log nl
      WHERE nl.kind = 'service_completion' AND nl.ref = a.id::text
    )
  ORDER BY a.ends_at ASC
  LIMIT 100
`

export async function runServiceCompletionNotices(): Promise<void> {
  const { rows } = await db.query(DUE_QUERY)
  for (const a of rows) {
    // Reivindica o aviso deste agendamento (exatamente-uma-vez).
    const claim = await db.query(
      `INSERT INTO notification_log (kind, ref) VALUES ('service_completion', $1)
       ON CONFLICT (kind, ref) DO NOTHING RETURNING ref`,
      [a.id]
    )
    if (claim.rowCount === 0) continue // outra execução já reivindicou

    const title = 'Finalizar serviço'
    const body = `O horário de ${a.service_name} (${a.customer_name}) às ${a.when_fmt} já passou. Marque como realizado.`
    const payload = { type: 'service_completion' as const, title, body, link: '/calendar', data: { appointment_id: a.id } }

    try {
      if (a.professional_user_id) {
        // Apenas o profissional que fará o serviço.
        await createNotification({ ...payload, tenantId: a.tenant_id, userId: a.professional_user_id })
      } else {
        // Profissional sem usuário vinculado → gestores recebem para não perder.
        await notifyTenantManagers(a.tenant_id, payload)
      }
    } catch (err) {
      console.error(`[service-completion] falha ao notificar appointment=${a.id}:`, err)
    }
  }
  if (rows.length > 0) {
    console.log(`[service-completion] ${rows.length} agendamento(s) vencido(s) processado(s)`)
  }
}

// Roda logo após o boot e depois a cada 5 min — mesmo padrão dos outros jobs.
export function startServiceCompletionNotifier(): void {
  setTimeout(() => {
    runServiceCompletionNotices().catch((e) => console.error('[service-completion] startup error:', e))
    setInterval(() => {
      runServiceCompletionNotices().catch((e) => console.error('[service-completion] run error:', e))
    }, 5 * 60 * 1000)
  }, 25_000)
}
