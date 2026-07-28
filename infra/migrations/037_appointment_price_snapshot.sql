-- 037: Snapshot do preço na conclusão do agendamento (SAL-14).
-- A receita do financeiro era calculada com o preço ATUAL do serviço
-- (JOIN services s ... SUM(s.price)): reajustar um preço mudava o faturamento
-- de meses passados retroativamente. Agora, ao marcar um agendamento como
-- 'completed', o preço vigente é congelado em appointments.price_snapshot
-- (routes/appointments.ts) e o financeiro usa COALESCE(price_snapshot, s.price)
-- — agendamentos concluídos antes desta migration (snapshot NULL) continuam
-- usando o preço atual, como antes.
-- Idempotente (IF NOT EXISTS) — seguro re-executar no boot.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS price_snapshot NUMERIC(10,2);
