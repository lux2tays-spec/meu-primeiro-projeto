-- 051 — Venda com link de pagamento (#3): status de pagamento por venda.
--
-- Uma venda com "Link de pagamento" fica PENDENTE (status='pending' + intervalo
-- vazio, source='quick_sale') e NÃO entra na receita até o cliente pagar. Ao
-- pagar (confirmado pelo Mercado Pago), vira status='completed' + payment_status='paid'.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status   TEXT
  CHECK (payment_status IN ('pending', 'paid', 'failed'));
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS mp_preference_id TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS mp_payment_url   TEXT;

-- Consulta rápida das vendas com pagamento pendente (dashboard #4).
CREATE INDEX IF NOT EXISTS idx_appt_payment_pending
  ON appointments (tenant_id) WHERE payment_status = 'pending';
