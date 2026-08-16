-- 055 — Fila de cancelamentos de assinatura Mercado Pago pendentes.
--
-- Ao excluir a conta, tentamos cancelar a preapproval ativa no MP na hora. Se a
-- chamada ao MP falhar (rede/instabilidade), a exclusão NÃO pode ser bloqueada —
-- então registramos aqui o id da assinatura para um job reprocessar com retry.
-- Tabela independente do tenant (sobrevive ao cascade da exclusão), sem FK.
CREATE TABLE IF NOT EXISTS pending_mp_cancellations (
  id                 BIGSERIAL PRIMARY KEY,
  mp_subscription_id TEXT NOT NULL,
  reason             TEXT,               -- contexto (ex.: 'account_deletion')
  attempts           INT NOT NULL DEFAULT 0,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_mp_cancel_open
  ON pending_mp_cancellations (created_at) WHERE done_at IS NULL;
