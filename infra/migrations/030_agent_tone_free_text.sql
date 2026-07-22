-- 030: agent_config.tone is free text.
-- 001_init.sql created a CHECK (tone IN ('formal','friendly','casual')), but the
-- Root Admin and business-type templates use free-text tones (e.g. 'amigável e
-- profissional'), so applying a template 500'd on the constraint. Drop it.
-- Idempotent: finds any CHECK on agent_config that references "tone" by
-- definition (name may differ across environments) and drops it if present.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'agent_config'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%tone%'
  LOOP
    EXECUTE format('ALTER TABLE agent_config DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
