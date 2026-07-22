-- 027: human handoff (atendimento humano).
-- The bot can be paused per conversation so a human takes over on the SAME
-- WhatsApp number. Two triggers set the pause:
--   1. the owner replies manually from their phone (detected in the webhook), or
--   2. the customer confirms "quero um especialista" (bot escalation).
-- While now() < bot_paused_until the bot stays silent; it auto-resumes after the
-- tenant's configurable timeout of human inactivity.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS bot_paused_until TIMESTAMPTZ;

-- Per-tenant handoff settings. Editable by the business owner (mobile + web) AND
-- by the Root Admin inside each tenant's edit screen. Text fields left empty fall
-- back to the code defaults in lib/handoffConfig.ts (single source of truth).
ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS handoff_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS handoff_pause_on_owner_reply BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS handoff_timeout_min          INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS handoff_offer_message        TEXT,
  ADD COLUMN IF NOT EXISTS handoff_button_label         TEXT,
  ADD COLUMN IF NOT EXISTS handoff_ack_message          TEXT,
  ADD COLUMN IF NOT EXISTS handoff_resume_message       TEXT,
  ADD COLUMN IF NOT EXISTS handoff_owner_resume_keyword TEXT;
