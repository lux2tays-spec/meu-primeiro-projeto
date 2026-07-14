-- JWT revocation via per-user token version.
-- Every issued JWT carries a `tv` claim; bumping token_version invalidates all
-- previously issued tokens for that user (password reset, staff removal/role change).
-- Pre-migration tokens have no `tv` claim and are treated as version 0, so
-- existing sessions keep working until they expire or a bump happens.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
