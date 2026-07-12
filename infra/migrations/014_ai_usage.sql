-- Per-message AI usage & cost telemetry (tokens + USD), for the Root Admin panel.
CREATE TABLE IF NOT EXISTS ai_usage (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          UUID REFERENCES tenants(id) ON DELETE SET NULL,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant  ON ai_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_model   ON ai_usage(model);
