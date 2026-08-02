-- 048 — Lembrete de aniversário do bot (#3, Fase 3).
--
-- Config por tenant no agent_config: liga/desliga, quantos dias ANTES enviar
-- (0 = no próprio dia) e o texto da mensagem. O bot usa isso para prospectar
-- novos agendamentos de quem está fazendo aniversário.
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS birthday_reminder_enabled     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS birthday_reminder_days_before INT     NOT NULL DEFAULT 0;
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS birthday_reminder_message     TEXT;

-- Dedup: no máximo 1 lembrete de aniversário por cliente por ano.
CREATE TABLE IF NOT EXISTS birthday_reminders (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year        INT  NOT NULL,
  status      TEXT NOT NULL DEFAULT 'sent',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, year)
);
