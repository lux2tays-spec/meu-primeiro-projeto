-- 054 — Serviço OCULTO (avulso/personalizado no agendamento).
--
-- Quando o usuário cria um agendamento com "serviço personalizado" (nome, duração
-- e valor próprios, só para aquele atendimento), gravamos um serviço real porém
-- OCULTO: hidden = TRUE. Assim todo o resto do sistema (agenda, financeiro,
-- comissões, lembretes, bot, Google Agenda) continua funcionando sem alteração
-- — pois o agendamento aponta para um services.id de verdade — mas esse serviço
-- NÃO aparece na tela de Serviços (catálogo) nem no bot.
ALTER TABLE services ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice parcial: as listagens do catálogo filtram hidden = FALSE.
CREATE INDEX IF NOT EXISTS idx_services_visible ON services (tenant_id) WHERE hidden = FALSE;
