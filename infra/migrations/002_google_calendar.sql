-- Link system user to a professional record
ALTER TABLE professionals ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Track who created each appointment
ALTER TABLE appointments ADD COLUMN created_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Google OAuth tokens per user (for Calendar sync)
CREATE TABLE google_calendar_tokens (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_token  TEXT,
  refresh_token TEXT NOT NULL,
  token_expiry  TIMESTAMPTZ,
  calendar_id   TEXT NOT NULL DEFAULT 'primary',
  sync_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Map appointments → Google Calendar event IDs (one per user who synced)
CREATE TABLE google_calendar_events (
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  PRIMARY KEY (appointment_id, user_id)
);

-- Store google_sub so we can match returning Google users
ALTER TABLE users ADD COLUMN google_sub TEXT UNIQUE;

CREATE INDEX idx_google_calendar_tokens_tenant ON google_calendar_tokens(tenant_id);
