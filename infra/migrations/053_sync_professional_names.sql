-- 053 — Sincroniza o nome dos profissionais VINCULADOS a um usuário com o nome
-- do próprio usuário.
--
-- Contexto: Equipe = Profissionais (todo membro é agendável). Antes, editar o
-- nome pelo Perfil (users.name) não atualizava o profissional, então a agenda e
-- a seleção de serviço seguiam mostrando o nome antigo (ex.: "Jack fpadrao" em
-- vez de "Tati"). Este backfill corrige os registros já existentes; o código
-- passa a manter em sincronia daqui pra frente (PATCH /auth/me e PATCH /staff).
UPDATE professionals p
   SET name = u.name
  FROM users u
 WHERE p.user_id = u.id
   AND p.active = TRUE
   AND p.name IS DISTINCT FROM u.name;
