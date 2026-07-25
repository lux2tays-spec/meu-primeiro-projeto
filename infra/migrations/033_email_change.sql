-- E-mail change requests: the new address only becomes the login e-mail after
-- the user clicks the confirmation link sent to the NEW address.
CREATE TABLE IF NOT EXISTS email_change_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email  TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_change_requests_token
  ON email_change_requests (token);

CREATE INDEX IF NOT EXISTS idx_email_change_requests_user
  ON email_change_requests (user_id);
