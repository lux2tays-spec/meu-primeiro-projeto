-- 036: Anti double-booking no banco (BOT-6).
-- A checagem de conflito no app (SELECT antes do INSERT) tem uma janela de
-- corrida: duas reservas simultâneas no mesmo horário podiam passar as duas.
-- Esta EXCLUDE constraint garante no Postgres que dois agendamentos ativos do
-- MESMO profissional nunca se sobreponham no tempo. Violações chegam ao app
-- como erro 23P01 (exclusion_violation) e são tratadas como "horário
-- indisponível" (bot) / 409 (API) em scheduling.ts e routes/appointments.ts.
-- Idempotente (IF NOT EXISTS / guarded DO block) — seguro re-executar.

-- btree_gist permite usar igualdade (professional_id WITH =) num índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_no_overlap'
      AND conrelid = 'appointments'::regclass
  ) THEN
    BEGIN
      ALTER TABLE appointments
        ADD CONSTRAINT appointments_no_overlap
        EXCLUDE USING gist (
          professional_id WITH =,
          tstzrange(starts_at, ends_at) WITH &&
        ) WHERE (status <> 'cancelled');
    EXCEPTION WHEN exclusion_violation THEN
      -- Já existem agendamentos sobrepostos no banco: a constraint não pode ser
      -- criada até os conflitos serem resolvidos (cancelar/mover os duplicados).
      -- Não derruba o deploy (a migration roda sozinha no boot); a checagem de
      -- conflito no app continua valendo como proteção. Para corrigir: localizar
      -- os conflitos com a query abaixo, resolvê-los e então executar o ALTER
      -- TABLE acima manualmente (a migration já terá sido marcada como aplicada).
      --   SELECT a1.id, a2.id FROM appointments a1
      --   JOIN appointments a2 ON a1.professional_id = a2.professional_id
      --     AND a1.id < a2.id
      --     AND a1.status <> 'cancelled' AND a2.status <> 'cancelled'
      --     AND tstzrange(a1.starts_at, a1.ends_at) && tstzrange(a2.starts_at, a2.ends_at);
      RAISE WARNING 'appointments_no_overlap NAO criada: existem agendamentos sobrepostos. Resolva os conflitos e execute o ALTER TABLE manualmente (proteção contra double-booking segue apenas no app até lá).';
    END;
  END IF;
END $$;
