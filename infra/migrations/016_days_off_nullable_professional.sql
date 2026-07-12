-- Days off can be tenant-wide (general, blocks all professionals — e.g. holiday)
-- with no specific professional, mirroring working_hours (migration 015).
-- Scheduling treats NULL professional_id as "applies to everyone"
-- (queries use `professional_id = $x OR professional_id IS NULL`).
ALTER TABLE days_off ALTER COLUMN professional_id DROP NOT NULL;
