-- 026: dynamic branding assets (logo variants, favicon, app icon).
-- One row per slot. Stored in the DB (small files) so the public /branding
-- endpoint can serve them with the right content-type and caching, and so a
-- redeploy never loses the uploaded brand. Colors/name live in platform_settings
-- (brand_config + branding_theme).

CREATE TABLE IF NOT EXISTS branding_assets (
  slot         TEXT PRIMARY KEY,   -- 'logo' | 'logo_dark' | 'logo_transparent' | 'favicon' | 'icon'
  content_type TEXT NOT NULL,
  data         BYTEA NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
