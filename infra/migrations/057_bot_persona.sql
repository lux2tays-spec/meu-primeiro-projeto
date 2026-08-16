-- 057 — Persona humana do bot.
--
-- persona_name/persona_style por tenant: dão um NOME e um jeito de escrever ao
-- "atendente", para soar como uma pessoa real e única (não um bot genérico).
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS persona_name  TEXT;
ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS persona_style TEXT;

-- Remove o "atendente/assistente virtual" dos templates por tipo de negócio
-- (contradizia a persona humana e fazia o bot se apresentar como IA). Troca por
-- enquadramento humano, de forma genérica (cobre os 7 templates).
UPDATE business_type_templates
   SET system_prompt = regexp_replace(
         system_prompt,
         'Você é (a|o) (atendente|assistente) virtual de',
         'Você faz parte da equipe de',
         'gi')
 WHERE system_prompt ILIKE '%virtual%';
