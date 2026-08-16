-- 056 — Exclusão de conta com JANELA DE REATIVAÇÃO (soft-delete).
--
-- Ao excluir a conta, em vez de apagar tudo na hora, marcamos deletion_requested_at.
-- Durante a janela (30 dias) o dono pode REATIVAR simplesmente logando de novo (o
-- login limpa o campo). Passada a janela, um job apaga em definitivo (LGPD: a
-- exclusão de fato acontece). Também reduz "excluí sem querer" -> ticket.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenants_pending_deletion
  ON tenants (deletion_requested_at) WHERE deletion_requested_at IS NOT NULL;
