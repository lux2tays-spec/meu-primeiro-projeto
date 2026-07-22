-- 028: Commissions per professional per service + customer last name
-- Idempotent style (IF NOT EXISTS / guarded DO blocks) — safe to re-run.

-- Commission config lives on the service ↔ professional link
ALTER TABLE service_professionals
  ADD COLUMN IF NOT EXISTS commission_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS commission_type    TEXT    NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS commission_value   NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Guarded CHECK: commission_type ∈ ('percent','fixed')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_professionals_commission_type_check'
  ) THEN
    ALTER TABLE service_professionals
      ADD CONSTRAINT service_professionals_commission_type_check
      CHECK (commission_type IN ('percent', 'fixed'));
  END IF;
END $$;

-- Customer surname (bot now captures nome + sobrenome)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Generated commissions — one per completed appointment (snapshot of config at completion)
CREATE TABLE IF NOT EXISTS commissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id   UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  professional_id  UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id       UUID REFERENCES services(id) ON DELETE SET NULL,
  service_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_type  TEXT NOT NULL,
  commission_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount           NUMERIC(10,2) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commissions_tenant_prof_status
  ON commissions (tenant_id, professional_id, status);
CREATE INDEX IF NOT EXISTS idx_commissions_tenant_status
  ON commissions (tenant_id, status);
