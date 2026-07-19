-- 025: backup log — one row per successful DB backup, so the Root Admin infra
-- panel can show WHEN the last backup ran (the dumps live in a Docker volume the
-- backend can't read directly). Written best-effort by infra/backup.sh; a failed
-- INSERT never fails the backup itself.

CREATE TABLE IF NOT EXISTS backup_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename   TEXT NOT NULL,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_log_created ON backup_log(created_at DESC);
