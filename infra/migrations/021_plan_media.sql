-- 021: per-plan capability to handle incoming audio/image on the WhatsApp bot.
-- Off by default; the platform owner turns it on for the plans that include it.

ALTER TABLE platform_plans
  ADD COLUMN IF NOT EXISTS media_enabled BOOLEAN NOT NULL DEFAULT FALSE;
