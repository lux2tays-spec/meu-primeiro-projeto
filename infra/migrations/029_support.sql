-- 029: Support tickets + messages (in-app support with AI assistant escalation)
-- Idempotent style (IF NOT EXISTS / guarded DO blocks) — safe to re-run.

CREATE TABLE IF NOT EXISTS support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  priority   TEXT NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarded CHECKs: status ∈ ('open','resolved'), priority ∈ ('normal','high')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_status_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_status_check
      CHECK (status IN ('open', 'resolved'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_priority_check'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_priority_check
      CHECK (priority IN ('normal', 'high'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender     TEXT NOT NULL,
  user_id    UUID,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Guarded CHECK: sender ∈ ('user','admin')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_sender_check'
  ) THEN
    ALTER TABLE support_messages
      ADD CONSTRAINT support_messages_sender_check
      CHECK (sender IN ('user', 'admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status
  ON support_tickets (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated
  ON support_tickets (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON support_messages (ticket_id, created_at);
