-- 018: pre-appointment reminders (anti-no-show)
-- Parameterizable per tenant: two reminders before the appointment + confirmation ask.

ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS appointment_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS reminder1_minutes INT NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS reminder2_minutes INT NOT NULL DEFAULT 30;

-- Idempotency log: one row per (appointment, kind). The job only sends when the
-- INSERT actually creates a row, so each reminder goes out exactly once.
CREATE TABLE IF NOT EXISTS appointment_reminder_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  sent_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (appointment_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_appt_reminder_log_appointment ON appointment_reminder_log(appointment_id);
