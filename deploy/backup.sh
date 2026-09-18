#!/usr/bin/env bash
#
# backup.sh — nightly backup of the CASCADE databases.
#
# Dumps every database in the shared Postgres:
#   * the app DB (POSTGRES_DB) — user accounts, roles, entitlements
#   * the `zitadel` DB          — ALL identity data (users, password hashes,
#     verification state). Losing this locks every user out permanently.
#   * the `glitchtip` DB        — optional, only if GLITCHTIP_DB_PASSWORD is
#     set (error/performance tracking history; losing it is not an outage).
#
# On a single VM, backups are only safe if they leave the box, so the script
# optionally uploads to an off-VM target (rclone). Run it from cron; see the
# Backups section of docs/project/deployment.md.
#
# Config (from deploy/.env, or the environment):
#   POSTGRES_USER / POSTGRES_DB     required (read from .env)
#   BACKUP_DIR                      local output dir      (default ./backups)
#   BACKUP_RETENTION_DAYS           prune older than N    (default 14)
#   BACKUP_GPG_RECIPIENT            if set, encrypt dumps with this GPG key
#   BACKUP_RCLONE_REMOTE            if set, `rclone copy` to this remote (offsite)
set -euo pipefail

cd "$(dirname "$0")"  # the deploy/ directory (compose project root)

# Load .env so POSTGRES_* and BACKUP_* are available.
set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

: "${POSTGRES_USER:?POSTGRES_USER not set (check deploy/.env)}"
: "${POSTGRES_DB:?POSTGRES_DB not set (check deploy/.env)}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
written=()

dbs=("$POSTGRES_DB" zitadel)
# Optional: only present if GlitchTip (error/performance tracking) was set up
# (deploy/db-init/02-create-glitchtip-db.sh). Dumping a database that was
# never created would fail the whole run for everyone who hasn't opted in.
[ -n "${GLITCHTIP_DB_PASSWORD:-}" ] && dbs+=(glitchtip)

for db in "${dbs[@]}"; do
  out="$BACKUP_DIR/${db}_${timestamp}.sql.gz"
  # -T: no TTY (we're piping). pg_dump runs inside the db container.
  docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$db" | gzip -9 > "$out"

  if [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
    gpg --yes --batch --encrypt --recipient "$BACKUP_GPG_RECIPIENT" "$out"
    rm -f "$out"
    out="${out}.gpg"
  fi

  # Sanity: a real dump is never a few bytes.
  if [ "$(stat -c%s "$out")" -lt 200 ]; then
    echo "ERROR: backup $out looks empty ($(stat -c%s "$out") bytes)" >&2
    exit 1
  fi
  echo "wrote $out ($(stat -c%s "$out") bytes)"
  written+=("$out")
done

# Off-VM copy — the only part that survives total loss of the machine.
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ]; then
  rclone copy "$BACKUP_DIR" "$BACKUP_RCLONE_REMOTE" --include "*_${timestamp}.*"
  echo "uploaded to $BACKUP_RCLONE_REMOTE"
else
  echo "NOTE: BACKUP_RCLONE_REMOTE unset — backups are LOCAL ONLY (not disaster-safe)." >&2
fi

# Prune old local dumps.
find "$BACKUP_DIR" -type f -name '*.sql.gz*' -mtime "+${RETENTION_DAYS}" -delete

echo "backup complete: ${written[*]}"
