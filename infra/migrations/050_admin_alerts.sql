-- 050 — Alertas para o Root Admin + dedup do aviso de limite de mensagens.
--
-- admin_alerts: caixa de avisos da PLATAFORMA (Root Admin) — ex.: um tenant
-- estourou o limite de mensagens do plano. Diferente de `notifications`, que é
-- por-usuário do tenant.
CREATE TABLE IF NOT EXISTS admin_alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT NOT NULL,                 -- ex.: 'plan_limit'
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  data       JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_created ON admin_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_alerts_unread  ON admin_alerts (created_at DESC) WHERE read_at IS NULL;

-- Dedup: no máximo 1 aviso de limite por tenant por dia ("fique avisando" = diário).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_limit_warned_on DATE;
