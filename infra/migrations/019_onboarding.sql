-- 019: onboarding wizard state
-- We track only an explicit "completed" timestamp on the tenant. Per-step
-- progress is COMPUTED from real data (professionals, services, hours, etc.)
-- so the wizard always reflects the true state of the account.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;
