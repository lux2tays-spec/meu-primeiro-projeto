-- 045 — Itens de serviço por venda (vendas com múltiplos serviços).
--
-- Uma venda continua sendo UM agendamento (1 venda, 1 receita = price_snapshot),
-- mas pode conter vários serviços. Guardamos cada serviço da venda aqui para o
-- relatório "Serviços mais vendidos" contar cada serviço (+1) e ratear o valor.
--
-- Agendamentos normais da agenda e vendas de 1 serviço NÃO precisam de linhas
-- aqui: o relatório cai no service_id do próprio agendamento (COALESCE). Só as
-- vendas com 2+ serviços gravam linhas nesta tabela.

CREATE TABLE IF NOT EXISTS appointment_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT,                       -- snapshot do nome (histórico/avulso)
  price_snapshot NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appt_services_appt ON appointment_services(appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_services_service ON appointment_services(service_id);
