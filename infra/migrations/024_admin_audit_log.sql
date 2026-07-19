-- 024: audit log for Root Admin actions (governance).
-- Records WHO changed WHAT and WHEN. Secret values are never stored — only a
-- short hash of before/after so a change is provable without leaking the secret.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action      TEXT NOT NULL,           -- e.g. 'settings.update', 'plan.update', 'tenant.update'
  target      TEXT,                    -- e.g. 'payment_config', plan slug, tenant id
  summary     TEXT,                    -- human-readable, secrets already masked/hashed
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_log(actor_id);
