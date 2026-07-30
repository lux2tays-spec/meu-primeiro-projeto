-- 040: Sistema de avisos e notificações (in-app + e-mail + WhatsApp; push pronto).
--
-- notifications           — caixa de avisos in-app, um registro por destinatário.
-- push_tokens             — tokens Expo por dispositivo (pronto p/ ativar com EAS).
-- notification_preferences — preferências por usuário: quais eventos e canais.
--
-- Entrega = evento habilitado AND canal habilitado. Broadcasts do Root Admin
-- escolhem os canais explicitamente e ignoram o filtro por-evento.

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tenant de contexto (NULL = aviso de plataforma / broadcast do Root).
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  -- destinatário (sempre um usuário da plataforma).
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,          -- appointment_reminder | new_customer | reschedule | confirmation | service_completion | broadcast | trial_ending | ...
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  link        TEXT,                   -- deep-link in-app (ex.: /calendar)
  data        JSONB,                  -- payload extra (ex.: { appointment_id })
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);
-- não-lidos por usuário (contagem do sino) — índice parcial enxuto.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,   -- ExpoPushToken[...]
  platform    TEXT,                   -- ios | android
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- canais (master): in-app é sempre gravado; estes controlam a ENTREGA externa.
  channel_inapp      BOOLEAN NOT NULL DEFAULT TRUE,
  channel_push       BOOLEAN NOT NULL DEFAULT TRUE,
  channel_email      BOOLEAN NOT NULL DEFAULT FALSE,
  channel_whatsapp   BOOLEAN NOT NULL DEFAULT FALSE,
  -- eventos (por-usuário): ligar/desligar cada tipo de aviso.
  evt_appointment_reminder BOOLEAN NOT NULL DEFAULT TRUE,
  evt_new_customer         BOOLEAN NOT NULL DEFAULT TRUE,
  evt_reschedule           BOOLEAN NOT NULL DEFAULT TRUE,
  evt_confirmation         BOOLEAN NOT NULL DEFAULT TRUE,
  evt_service_completion   BOOLEAN NOT NULL DEFAULT TRUE,
  evt_broadcast            BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência de avisos automáticos (ex.: "finalizar serviço") — evita reenvio.
-- Uma linha por (tipo, chave) já entregue.
CREATE TABLE IF NOT EXISTS notification_log (
  kind        TEXT NOT NULL,          -- ex.: 'service_completion'
  ref         TEXT NOT NULL,          -- ex.: appointment_id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, ref)
);
