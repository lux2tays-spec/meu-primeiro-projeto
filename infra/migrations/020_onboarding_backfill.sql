-- 020: grandfather existing tenants out of the onboarding wizard.
-- Any tenant that already exists when this runs has been using the app before
-- the wizard shipped, so we mark them as completed. Tenants created afterwards
-- start with onboarding_completed_at = NULL and will see the wizard on first login.

UPDATE tenants
SET onboarding_completed_at = NOW()
WHERE onboarding_completed_at IS NULL;
