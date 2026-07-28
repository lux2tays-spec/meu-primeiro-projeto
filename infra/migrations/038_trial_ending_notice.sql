-- 038: Aviso de fim de trial (PAY-8).
-- Marca QUANDO o tenant foi avisado de que o trial está acabando (~2 dias
-- antes), para o job diário (jobs/trialEndingNotifier.ts) nunca duplicar o
-- aviso: o job "reivindica" o aviso com UPDATE ... RETURNING atômico sobre
-- esta coluna. NULL = nunca avisado.
-- Idempotente (IF NOT EXISTS) — seguro re-executar no boot.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_ending_notified_at TIMESTAMPTZ;
