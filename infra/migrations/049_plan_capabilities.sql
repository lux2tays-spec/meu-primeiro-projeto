-- 049 — Matriz de recursos por plano (#10, Fase 4).
--
-- capabilities: objeto { chave: boolean | number } com o que cada plano tem.
-- O catálogo mestre e os defaults ficam em backend/src/lib/planCapabilities.ts.
-- Limites com coluna própria (max_agendas, max_users) continuam nas colunas;
-- ia_media espelha a coluna media_enabled. Aqui guardamos os recursos on/off e
-- o limite novo max_messages_month.
ALTER TABLE platform_plans ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}';

-- Padrão inicial por plano (decisão: aplicar novo padrão a todos). Planos
-- customizados ficam com '{}' e herdam os defaults do catálogo até serem editados.
UPDATE platform_plans SET capabilities = '{
  "vendas_module": false, "commissions": false, "birthday_reminder": false,
  "appointment_reminders": true, "return_reminders": false, "advanced_ai": false,
  "google_calendar": false, "payment_talk": false, "affiliate": true,
  "max_messages_month": 100
}'::jsonb WHERE slug = 'free';

UPDATE platform_plans SET capabilities = '{
  "vendas_module": true, "commissions": true, "birthday_reminder": false,
  "appointment_reminders": true, "return_reminders": true, "advanced_ai": false,
  "google_calendar": false, "payment_talk": true, "affiliate": true,
  "max_messages_month": 1000
}'::jsonb WHERE slug = 'basico';

UPDATE platform_plans SET capabilities = '{
  "vendas_module": true, "commissions": true, "birthday_reminder": true,
  "appointment_reminders": true, "return_reminders": true, "advanced_ai": true,
  "google_calendar": true, "payment_talk": true, "affiliate": true,
  "max_messages_month": 5000
}'::jsonb WHERE slug = 'premium';

UPDATE platform_plans SET capabilities = '{
  "vendas_module": true, "commissions": true, "birthday_reminder": true,
  "appointment_reminders": true, "return_reminders": true, "advanced_ai": true,
  "google_calendar": true, "payment_talk": true, "affiliate": true,
  "max_messages_month": 0
}'::jsonb WHERE slug = 'profissional';

-- ia_media segue a coluna media_enabled já existente (não duplicar fonte da verdade).
