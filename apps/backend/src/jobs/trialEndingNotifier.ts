import { db } from '../lib/db'

// PAY-8: aviso de trial acabando — recuperação de conversão.
//
// Job diário que encontra tenants em trial cujo período termina em ~2 dias e
// registra o aviso. O "envio" hoje é o registro persistido + log — a coluna
// tenants.trial_ending_notified_at (migration 038) fica visível ao Root Admin
// e serve de gatilho para o canal de notificação quando existir.
// TODO: enviar push (mobile) / e-mail ao dono quando houver mecanismo de
// notificação ativa — hoje o registro abaixo é o aviso persistido.
//
// Sem duplicar: o UPDATE ... RETURNING "reivindica" o aviso atomicamente na
// própria coluna — execuções repetidas (ou instâncias concorrentes) não
// selecionam de novo um tenant já avisado. Se o Root Admin estender o trial
// (novo trial_ends_at bem à frente), o aviso antigo fica FORA da janela do novo
// trial e o tenant é avisado de novo perto do novo vencimento — comportamento
// desejado.

export async function notifyTrialsEndingSoon(): Promise<void> {
  const { rows } = await db.query(
    `UPDATE tenants
     SET trial_ending_notified_at = NOW()
     WHERE status = 'trial'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at > NOW()
       AND trial_ends_at <= NOW() + interval '2 days'
       AND (
         trial_ending_notified_at IS NULL
         -- aviso registrado antes da janela DESTE trial (ex.: trial estendido) → avisa de novo
         OR trial_ending_notified_at < trial_ends_at - interval '3 days'
       )
     RETURNING id, name,
       to_char(trial_ends_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS ends_fmt`
  )

  for (const t of rows) {
    console.log(
      `[trial-notice] tenant=${t.id} "${t.name}": trial termina em ${t.ends_fmt} — aviso registrado (trial_ending_notified_at). TODO: push/e-mail.`
    )
  }
  if (rows.length > 0) {
    console.log(`[trial-notice] ${rows.length} aviso(s) de fim de trial registrado(s)`)
  }
}

// Runs shortly after boot, then daily — same pattern as the other jobs.
export function startTrialEndingNotifier(): void {
  setTimeout(() => {
    notifyTrialsEndingSoon().catch((e) => console.error('[trial-notice] startup error:', e))
    setInterval(() => {
      notifyTrialsEndingSoon().catch((e) => console.error('[trial-notice] run error:', e))
    }, 24 * 60 * 60 * 1000)
  }, 20_000)
}
