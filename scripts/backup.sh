#!/usr/bin/env bash
# Consistent PostgreSQL backup for BidTracker.
#
# Usage: ./scripts/backup.sh
# Environment: BACKUP_DIR, KEEP_DAILY, KEEP_WEEKLY, PGHOST, PGPORT,
# PGDATABASE, PGUSER, and PGPASSWORD.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/.." && pwd)/backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
PGDATABASE="${PGDATABASE:-bidtracker}"
PGUSER="${PGUSER:-bidtracker}"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
DOW="$(date -u +%u)"
TARGET="$BACKUP_DIR/daily/bidtracker-$STAMP.dump"
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

log() { printf '[backup] %s\n' "$*"; }

if ! command -v pg_dump >/dev/null 2>&1 || ! command -v pg_restore >/dev/null 2>&1; then
  log "ERROR: pg_dump and pg_restore must be installed"
  exit 1
fi

log "dumping $PGDATABASE"
pg_dump --username "$PGUSER" --dbname "$PGDATABASE" \
  --format custom --no-owner --no-privileges > "$TARGET"

if [ ! -s "$TARGET" ]; then
  log "ERROR: pg_dump produced an empty file"
  rm -f "$TARGET"
  exit 1
fi

# Parsing the whole archive catches truncated or malformed dumps.
if ! pg_restore --list "$TARGET" >/dev/null; then
  log "ERROR: backup verification failed"
  mv "$TARGET" "$TARGET.CORRUPT"
  exit 1
fi

log "verified $TARGET ($(du -h "$TARGET" | cut -f1))"

if [ "$DOW" = "7" ]; then
  cp "$TARGET" "$BACKUP_DIR/weekly/"
  log "promoted to weekly"
fi

prune() {
  local dir="$1" keep="$2"
  find "$dir" -name 'bidtracker-*.dump' -type f -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n "+$((keep + 1))" \
    | cut -d' ' -f2- \
    | while IFS= read -r old; do
        [ -n "$old" ] || continue
        log "pruning $(basename "$old")"
        rm -f -- "$old"
      done
}

prune "$BACKUP_DIR/daily" "$KEEP_DAILY"
prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
log "done"

# Restore into an empty destination (this replaces its contents):
#   Stop the backend service, then:
#   dropdb -U bidtracker --if-exists bidtracker
#   createdb -U bidtracker bidtracker
#   pg_restore -U bidtracker -d bidtracker --no-owner --no-privileges \
#     backups/daily/bidtracker-YYYYMMDD-HHMMSS.dump
#   Start the backend service again.
