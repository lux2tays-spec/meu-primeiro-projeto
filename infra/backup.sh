#!/bin/sh
# =============================================================================
# AgendaBot — backup diario do PostgreSQL (pg_dump formato custom + gzip)
#
# Executado dentro do container `db-backup` (imagem postgres:16-alpine), que
# monta este arquivo e o volume `pg_backups` em /backups.
#
# Comportamento:
#   1. pg_dump -Fc do banco `agendabot` -> /backups/agendabot_<UTC ts>.dump.gz
#   2. Rotacao: mantem os ultimos BACKUP_KEEP dumps (padrao 14), apaga o resto.
#   3. Offsite OPCIONAL: se BACKUP_S3_BUCKET (aws cli) ou BACKUP_RCLONE_REMOTE
#      (rclone) estiverem configurados, envia o dump. Falha de upload NUNCA
#      falha o backup — loga e segue (o dump local ja esta salvo).
#   4. Sai com codigo != 0 somente se o pg_dump/compactacao falhar.
#
# Variaveis de ambiente (todas com padrao sensato — sem segredos no repo):
#   PGHOST (postgres) | PGPORT (5432) | PGUSER (agendabot) | PGDATABASE (agendabot)
#   PGPASSWORD ou POSTGRES_PASSWORD  — senha do Postgres (vem do ambiente)
#   BACKUP_DIR (/backups)            — diretorio dos dumps (volume pg_backups)
#   BACKUP_KEEP (14)                 — quantos dumps diarios manter
#   BACKUP_S3_BUCKET / BACKUP_S3_PREFIX + credenciais AWS_*  — offsite via aws cli
#   BACKUP_RCLONE_REMOTE (ex: "r2:agendabot-backups")        — offsite via rclone
#
# Restauracao: ver infra/BACKUP.md
# =============================================================================
set -u

log() {
  echo "[db-backup] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
}

# --- Conexao ----------------------------------------------------------------
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-agendabot}"
PGDATABASE="${PGDATABASE:-agendabot}"
export PGHOST PGPORT PGUSER PGDATABASE

# Aceita a senha tanto em PGPASSWORD quanto em POSTGRES_PASSWORD (mesma var do
# service postgres no compose). Nunca hardcoded aqui.
if [ -z "${PGPASSWORD:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  PGPASSWORD="$POSTGRES_PASSWORD"
fi
export PGPASSWORD="${PGPASSWORD:-}"

# --- Destino ----------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

TIMESTAMP="$(date -u '+%Y%m%d_%H%M%S')"
BASENAME="agendabot_${TIMESTAMP}.dump.gz"
OUT_FILE="${BACKUP_DIR}/${BASENAME}"
RAW_TMP="${BACKUP_DIR}/.${BASENAME}.raw.tmp"
GZ_TMP="${BACKUP_DIR}/.${BASENAME}.tmp"

if ! mkdir -p "$BACKUP_DIR"; then
  log "ERRO: nao foi possivel criar o diretorio de backups '$BACKUP_DIR'"
  exit 1
fi

# --- 1. Dump ----------------------------------------------------------------
log "iniciando pg_dump de ${PGDATABASE}@${PGHOST}:${PGPORT} -> ${BASENAME}"

if ! pg_dump -Fc --no-owner -f "$RAW_TMP" "$PGDATABASE"; then
  log "ERRO: pg_dump falhou — nenhum backup gerado nesta execucao"
  rm -f "$RAW_TMP" "$GZ_TMP"
  exit 1
fi

if ! gzip -c "$RAW_TMP" > "$GZ_TMP"; then
  log "ERRO: compactacao (gzip) falhou"
  rm -f "$RAW_TMP" "$GZ_TMP"
  exit 1
fi
rm -f "$RAW_TMP"

# Rename atomico: so aparece com o nome final se estiver completo.
if ! mv "$GZ_TMP" "$OUT_FILE"; then
  log "ERRO: nao foi possivel mover o dump para '$OUT_FILE'"
  rm -f "$GZ_TMP"
  exit 1
fi

SIZE="$(du -h "$OUT_FILE" 2>/dev/null | cut -f1)"
log "backup OK: ${OUT_FILE} (${SIZE:-?})"

# --- 2. Rotacao (mantem os BACKUP_KEEP mais recentes) ------------------------
# Nomes controlados por este script (sem espacos), entao ls -1t e seguro aqui.
ls -1t "$BACKUP_DIR"/agendabot_*.dump.gz 2>/dev/null \
  | tail -n +"$((BACKUP_KEEP + 1))" \
  | while IFS= read -r old; do
      if rm -f "$old"; then
        log "rotacao: removido $(basename "$old")"
      else
        log "AVISO: rotacao nao conseguiu remover '$old'"
      fi
    done

# Limpa temporarios orfaos de execucoes interrompidas (mais antigos que 1 dia).
find "$BACKUP_DIR" -maxdepth 1 -name '.agendabot_*.tmp' -mtime +0 -exec rm -f {} \; 2>/dev/null

# --- 3. Offsite opcional (best-effort: NUNCA falha o backup) -----------------
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  S3_DEST="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX:-agendabot-db}/${BASENAME}"
  if command -v aws >/dev/null 2>&1; then
    if aws s3 cp "$OUT_FILE" "$S3_DEST" >/dev/null 2>&1; then
      log "offsite: upload S3 OK -> ${S3_DEST}"
    else
      log "AVISO: upload S3 falhou (${S3_DEST}) — backup local mantido"
    fi
  else
    log "AVISO: BACKUP_S3_BUCKET definido mas o comando 'aws' nao existe neste container — apenas backup local (ver infra/BACKUP.md)"
  fi
fi

if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  if command -v rclone >/dev/null 2>&1; then
    if rclone copyto "$OUT_FILE" "${BACKUP_RCLONE_REMOTE}/${BASENAME}" >/dev/null 2>&1; then
      log "offsite: upload rclone OK -> ${BACKUP_RCLONE_REMOTE}/${BASENAME}"
    else
      log "AVISO: upload rclone falhou — backup local mantido"
    fi
  else
    log "AVISO: BACKUP_RCLONE_REMOTE definido mas o comando 'rclone' nao existe neste container — apenas backup local (ver infra/BACKUP.md)"
  fi
fi

if [ -z "${BACKUP_S3_BUCKET:-}" ] && [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
  log "offsite nao configurado (BACKUP_S3_BUCKET/BACKUP_RCLONE_REMOTE ausentes) — mantendo apenas copia local em ${BACKUP_DIR}"
fi

exit 0
