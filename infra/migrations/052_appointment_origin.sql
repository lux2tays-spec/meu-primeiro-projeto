-- 052 — Tag de ORIGEM (IA x App) + selo REMARCADO no agendamento (#1 do lote).
--
-- origin: de onde veio o lead — 'ia' (assistente no WhatsApp) ou 'app' (criado
-- manualmente pelo dono/equipe no app/web). Persiste em qualquer fase do funil
-- (pendente/confirmado/remarcado/cancelado), para filtrar e medir leads da IA.
-- rescheduled: TRUE quando o horário já foi trocado (pela IA ou por edição no
-- app) — é um SELO sobre o status, não substitui o status.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'app'
  CHECK (origin IN ('ia', 'app'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rescheduled BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: agendamentos criados pelo bot (created_by NULL) são origem IA.
UPDATE appointments SET origin = 'ia' WHERE created_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_appt_origin ON appointments (tenant_id, origin);
