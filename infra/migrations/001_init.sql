-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tenants (one per business account)
CREATE TABLE tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','basico','premium','profissional')),
  status          TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','cancelled')),
  trial_ends_at   TIMESTAMPTZ,
  max_agendas     INT NOT NULL DEFAULT 1,
  max_users       INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform users (owners + staff)
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Role per user per tenant
CREATE TABLE user_roles (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','admin','staff')),
  PRIMARY KEY (user_id, tenant_id)
);

-- Professionals (bookable staff, may differ from system users)
CREATE TABLE professionals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT,
  bio         TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Services offered by each business
CREATE TABLE services (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  duration_minutes    INT NOT NULL,
  price               NUMERIC(10,2) NOT NULL,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Weekly working hours per professional
CREATE TABLE working_hours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time      TIME NOT NULL,
  end_time        TIME NOT NULL
);

-- Specific days off per professional
CREATE TABLE days_off (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  reason          TEXT
);

-- End-customers (WhatsApp contacts) per tenant
CREATE TABLE customers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,  -- WhatsApp number in E.164
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, phone)
);

-- Appointments
CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id),
  professional_id UUID NOT NULL REFERENCES professionals(id),
  service_id      UUID NOT NULL REFERENCES services(id),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WhatsApp instance per tenant (Evolution API)
CREATE TABLE whatsapp_instances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_name   TEXT UNIQUE NOT NULL,
  phone_number    TEXT,
  status          TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected','qr_pending','connected')),
  api_key_enc     TEXT,  -- encrypted Evolution API key
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI agent configuration per tenant
CREATE TABLE agent_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  system_prompt   TEXT NOT NULL DEFAULT '',
  tone            TEXT NOT NULL DEFAULT 'friendly' CHECK (tone IN ('formal','friendly','casual')),
  language        TEXT NOT NULL DEFAULT 'pt-BR',
  business_info   TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversations (WhatsApp thread per customer per tenant)
CREATE TABLE conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  archived_at     TIMESTAMPTZ,   -- set when moved to S3
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscriptions (Mercado Pago)
CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mp_subscription_id  TEXT UNIQUE NOT NULL,
  plan                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('authorized','paused','cancelled','pending')),
  next_billing_date   DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Affiliates
CREATE TABLE affiliates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code   TEXT UNIQUE NOT NULL,
  pending_earnings BIGINT NOT NULL DEFAULT 0,  -- BRL cents
  paid_earnings    BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Referrals
CREATE TABLE affiliate_referrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id    UUID NOT NULL REFERENCES affiliates(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  commission_brl  BIGINT NOT NULL DEFAULT 0,  -- BRL cents
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_appointments_tenant_starts ON appointments(tenant_id, starts_at);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_tenant_archived ON messages(tenant_id, archived_at) WHERE archived_at IS NULL;
CREATE INDEX idx_customers_tenant_phone ON customers(tenant_id, phone);
