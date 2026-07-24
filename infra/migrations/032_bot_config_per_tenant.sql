-- 032: per-tenant overrides for bot behaviour that used to be hardcoded.
-- Global defaults live in platform_settings 'bot_config' (Root Admin). These
-- columns are per-tenant OVERRIDES: NULL means "inherit the global default".
--   allow_price_list      — may the bot send the full price list / service table?
--   collect_last_name     — should the bot collect the customer's surname?
--   reminder_*_template   — per-tenant reminder copy (NULL = use global template).
ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS allow_price_list              BOOLEAN,
  ADD COLUMN IF NOT EXISTS collect_last_name             BOOLEAN,
  ADD COLUMN IF NOT EXISTS reminder_return_template      TEXT,
  ADD COLUMN IF NOT EXISTS reminder_appointment_template TEXT;
