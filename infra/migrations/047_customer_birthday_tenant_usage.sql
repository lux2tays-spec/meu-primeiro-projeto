-- 047 — Aniversário do cliente (#2) + uso/login por tenant (#11).

-- #2: data de aniversário do cliente (opcional). Usada pelo lembrete de
-- aniversário do bot (Fase 3).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birth_date DATE;

-- #11: rastreio de uso por tenant para o Root Admin.
--  - last_login_at: atualizado no login (auth).
--  - last_seen_at:  atualizado nas requisições autenticadas (com throttle de
--                   10 min para não escrever a cada request).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ;
