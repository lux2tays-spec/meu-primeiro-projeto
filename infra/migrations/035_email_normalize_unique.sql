-- AUTH-4: unicidade de e-mail case-insensitive.
-- O backend passou a normalizar e-mails (trim + lowercase) antes de qualquer
-- query/insert; este índice garante a unicidade independente de caixa também
-- no banco (a UNIQUE original de users.email é case-sensitive).
--
-- ATENÇÃO: se já existirem e-mails duplicados que diferem apenas por
-- maiúsculas/minúsculas (ex.: 'Joao@x.com' e 'joao@x.com'), a criação do
-- índice FALHA. Nesse caso, deduplicar manualmente antes de reexecutar.
-- (Assumimos base limpa; o IF NOT EXISTS cobre apenas re-execuções.)
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (LOWER(email));
