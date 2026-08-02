-- 046 — Cobrança anual dos planos + histórico de pagamentos da assinatura.
--
-- #4: desconto anual configurável POR PLANO no Root Admin. O preço anual é
-- derivado: price_cents * 12 * (1 - annual_discount_pct/100). 0 = sem opção
-- anual com desconto (ainda pode assinar anual pelo preço cheio se quiser, mas
-- a UI só destaca a economia quando há desconto).
ALTER TABLE platform_plans
  ADD COLUMN IF NOT EXISTS annual_discount_pct INT NOT NULL DEFAULT 0;

-- Período de cobrança da assinatura (mensal x anual). Default 'monthly' para as
-- assinaturas existentes.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly', 'annual'));

-- Histórico de cobranças da assinatura (preenchido pelo webhook de pagamento do
-- Mercado Pago). Serve para exibir "histórico de cobranças" no App e na Web.
CREATE TABLE IF NOT EXISTS subscription_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mp_payment_id TEXT UNIQUE,
  plan          TEXT,
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  status        TEXT,            -- approved | rejected | pending | refunded ...
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sub_payments_tenant ON subscription_payments(tenant_id, paid_at DESC);
