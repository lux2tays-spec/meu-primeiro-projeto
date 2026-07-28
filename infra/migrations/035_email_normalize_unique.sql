-- AUTH-4: unicidade de e-mail case-insensitive.
-- O backend passou a normalizar e-mails (trim + lowercase) antes de qualquer
-- query/insert; este índice garante a unicidade independente de caixa também
-- no banco (a UNIQUE original de users.email é case-sensitive).
--
-- SEGURO PARA O BOOT: se já existirem e-mails duplicados que diferem apenas por
-- maiúsculas/minúsculas, um CREATE UNIQUE INDEX cru FALHARIA e derrubaria a
-- subida do backend (as migrations rodam no boot). Por isso checamos duplicatas
-- antes e, se houver, apenas AVISAMOS e seguimos — o índice pode ser criado
-- manualmente depois de deduplicar. A normalização no app já previne novas
-- duplicatas daqui pra frente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'users_email_lower_key'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM users
      WHERE email IS NOT NULL
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
    ) THEN
      RAISE WARNING 'users_email_lower_key NAO criada: existem e-mails duplicados por caixa. Deduplique (ex.: manter o mais recente por LOWER(email)) e crie o indice manualmente: CREATE UNIQUE INDEX users_email_lower_key ON users (LOWER(email));';
    ELSE
      EXECUTE 'CREATE UNIQUE INDEX users_email_lower_key ON users (LOWER(email))';
    END IF;
  END IF;
END $$;
