-- Reminder period per service (in days). NULL = no reminder.
ALTER TABLE services ADD COLUMN IF NOT EXISTS reminder_days INTEGER;

-- Track which appointment reminders have already been sent (prevents duplicates)
CREATE TABLE IF NOT EXISTS appointment_reminders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status         TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error_message  TEXT,
  UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_appointment_reminders_sent_at ON appointment_reminders(sent_at);
