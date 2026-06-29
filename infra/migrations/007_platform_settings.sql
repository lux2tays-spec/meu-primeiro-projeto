-- Platform settings (email, AI config) stored in DB so root admin can edit via UI
CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Configurable plans table (root admin manages via UI)
CREATE TABLE IF NOT EXISTS platform_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  max_agendas INTEGER NOT NULL DEFAULT 1,
  max_users   INTEGER NOT NULL DEFAULT 1,
  trial_days  INTEGER NOT NULL DEFAULT 0,
  features    JSONB NOT NULL DEFAULT '[]',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default plans
INSERT INTO platform_plans (slug, name, description, price_cents, max_agendas, max_users, trial_days, features, sort_order) VALUES
  ('free',          'Free',          'Para experimentar a plataforma',  0,     1, 1,  5,  '["1 agenda","1 usuário","Trial de 5 dias"]', 0),
  ('basico',        'Básico',        'Para profissionais autônomos',     8900,  1, 1,  0,  '["1 agenda","1 usuário","Suporte por e-mail"]', 1),
  ('premium',       'Premium',       'Para pequenas equipes',            16900, 3, 3,  0,  '["3 agendas","3 usuários","Suporte prioritário"]', 2),
  ('profissional',  'Profissional',  'Para negócios em crescimento',     29900, 10, 10, 0, '["10 agendas","10 usuários","Suporte VIP","Relatórios avançados"]', 3)
ON CONFLICT (slug) DO NOTHING;

-- Seed default platform settings
INSERT INTO platform_settings (key, value) VALUES
  ('email_smtp', '{
    "host": "",
    "port": 587,
    "secure": false,
    "user": "",
    "pass": "",
    "from_name": "AgendaBot",
    "from_email": "noreply@agendabot.com.br"
  }'),
  ('email_templates', '{
    "welcome":        { "subject": "Bem-vindo ao AgendaBot!", "enabled": true },
    "verify_email":   { "subject": "Confirme seu e-mail - AgendaBot", "enabled": true },
    "reset_password": { "subject": "Redefinição de senha - AgendaBot", "enabled": true },
    "new_staff":      { "subject": "Você foi adicionado como colaborador - AgendaBot", "enabled": true },
    "trial_ending":   { "subject": "Seu período de teste está encerrando - AgendaBot", "enabled": true },
    "subscription_confirmed": { "subject": "Assinatura confirmada - AgendaBot", "enabled": true }
  }'),
  ('ai_config', '{
    "provider": "anthropic",
    "api_key": "",
    "base_url": "",
    "model": "claude-haiku-4-5"
  }')
ON CONFLICT (key) DO NOTHING;

-- Add phone column to users if not exists (already exists, but guard anyway)
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;

-- Ensure tenants plan check allows future plan slugs via platform_plans
-- (For now plan check stays as-is; platform_plans is the source of truth for UI)
