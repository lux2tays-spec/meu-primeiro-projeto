-- 034: Preservar histórico financeiro ao excluir cliente
-- Idempotent style (IF NOT EXISTS / guarded DO blocks) — safe to re-run on boot.

-- 1) Soft-delete/anonimização de clientes: flag de exclusão lógica.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 2) Comissão PAGA é histórico: precisa sobreviver à exclusão do agendamento.
--    Torna appointment_id nullable (era NOT NULL em 028). DROP NOT NULL é
--    idempotente — não falha se a coluna já for nullable.
ALTER TABLE commissions ALTER COLUMN appointment_id DROP NOT NULL;

-- 3) Troca a FK criada em 028 (ON DELETE CASCADE) por ON DELETE SET NULL:
--    apagar um appointment deixa a linha da comissão como histórico órfão
--    (appointment_id = NULL) em vez de apagá-la junto.
DO $$
BEGIN
  -- Remove a FK antiga apenas se ainda cascateia (confdeltype 'c' = CASCADE).
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commissions_appointment_id_fkey'
      AND conrelid = 'commissions'::regclass
      AND confdeltype = 'c'
  ) THEN
    ALTER TABLE commissions DROP CONSTRAINT commissions_appointment_id_fkey;
  END IF;

  -- Recria com ON DELETE SET NULL se a FK não existir.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commissions_appointment_id_fkey'
      AND conrelid = 'commissions'::regclass
  ) THEN
    ALTER TABLE commissions
      ADD CONSTRAINT commissions_appointment_id_fkey
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Obs.: o UNIQUE de appointment_id (commissions_appointment_id_key) permanece —
-- múltiplos NULLs são permitidos em constraints UNIQUE do Postgres.
