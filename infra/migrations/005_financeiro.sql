-- Payment config per tenant (Mercado Pago)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mp_access_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS mp_public_key TEXT;

-- Service ↔ Professional mapping
CREATE TABLE IF NOT EXISTS service_professionals (
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, professional_id)
);

-- Payment links created by tenant
CREATE TABLE IF NOT EXISTS payment_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  amount      NUMERIC(10,2) NOT NULL,
  mp_id       TEXT,
  mp_url      TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
