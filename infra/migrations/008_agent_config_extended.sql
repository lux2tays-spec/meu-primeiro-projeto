-- Extend agent_config with business identity and AI behavior fields
ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS business_type       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS neighborhood        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city                TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state               TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram_url       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS google_maps_url     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS website_url         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_number     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS catalog_files       JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS return_reminder_days INTEGER NOT NULL DEFAULT 30;
