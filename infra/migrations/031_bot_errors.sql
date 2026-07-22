-- 031: Bot error log — persisted bot/AI failures per tenant, so the Root Admin
-- can diagnose a tenant's bot remotely (tool exceptions, cost-cap hard stops,
-- forced fallback replies). Written best-effort by services/bot.ts.
-- Idempotent (IF NOT EXISTS) — safe to re-run.

CREATE TABLE IF NOT EXISTS bot_errors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID,
  kind            TEXT NOT NULL,
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_errors_tenant_created
  ON bot_errors (tenant_id, created_at DESC);
