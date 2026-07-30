-- 039: per-tenant override para "falar sobre pagamento".
-- Antes só existia o flag GLOBAL platform_settings 'bot_config'.allow_payment_talk
-- (Root Admin), que sobrepunha até as instruções do tenant. Este override
-- por-tenant permite ao proprietário decidir na tela do Agente IA:
--   NULL  = herdar o padrão global (Root Admin)
--   TRUE  = este negócio PODE falar de pagamento (sobrepõe o global)
--   FALSE = este negócio NÃO fala de pagamento
ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS allow_payment_talk BOOLEAN;
