-- 043: log de atividades por tenant, visível ao PROPRIETÁRIO no painel dele.
-- Registro durável (não é notificação que some) de ações sensíveis feitas pela
-- equipe — a primeira é a exclusão de vendas (item pedido pelo usuário). Escopo
-- por tenant; só gestores (owner/admin/root) leem.
CREATE TABLE IF NOT EXISTS tenant_activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_name  TEXT,
  action      TEXT NOT NULL,          -- ex.: sale.delete
  target      TEXT,                   -- ex.: appointment id
  summary     TEXT,                   -- texto legível (ex.: "Venda de R$ 135 - Fabio excluída")
  data        JSONB,                  -- payload extra (valores, cliente, etc.)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenant_activity_tenant_created
  ON tenant_activity_log (tenant_id, created_at DESC);
