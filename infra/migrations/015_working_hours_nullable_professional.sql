-- Working hours can be tenant-wide (general, applies to all professionals) with
-- no specific professional. The code + scheduling already treat NULL professional_id
-- as "general" (queries use `professional_id IS NULL OR professional_id = $x`), but
-- the original schema had professional_id NOT NULL, causing a 500 when saving
-- general hours. Allow NULL.
ALTER TABLE working_hours ALTER COLUMN professional_id DROP NOT NULL;
