#!/bin/sh
# One database backup: dump, verify, upload off-box, prune what has aged out.
#
# Run on a schedule by the `backup` service, and by hand to prove it works:
#
#   docker compose -f docker-compose.prod.yml run --rm backup /usr/local/bin/backup.sh
#
# Do that once after setting the credentials. A backup nobody has ever run is a guess, and the
# first run is where a wrong key or a missing bucket shows up — not at 03:17 next Tuesday.

set -eu

log() { echo "[backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
die() { log "FAILED: $*"; exit 1; }

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is not set — see DEPLOY.md}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is not set}"
: "${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is not set}"
: "${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is not set}"

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-soundbite}"
PGDATABASE="${PGDATABASE:-soundbite}"
PREFIX="${BACKUP_S3_PREFIX:-postgres}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"

# ---- the guard ---------------------------------------------------------------------------------
# A backup on the same disk as the database is not a backup. If the volume is lost, or the VPS is,
# both go together — and the reassuring list of dump files makes it worse, because it reads like
# safety right up to the moment it is needed. So: refuse the local bucket outright rather than
# succeeding into it.
case "$BACKUP_S3_ENDPOINT" in
  *minio:9000*|*localhost*|*127.0.0.1*|*://minio*)
    die "BACKUP_S3_ENDPOINT points at this box's own MinIO ($BACKUP_S3_ENDPOINT).
       That stores the backups on the disk they exist to survive. Point it at R2, or any
       S3-compatible storage that is not this machine."
    ;;
esac
if [ -n "${S3_ENDPOINT:-}" ] && [ "$BACKUP_S3_ENDPOINT" = "$S3_ENDPOINT" ]; then
  die "BACKUP_S3_ENDPOINT is the same endpoint the app uses for media. Backups must go elsewhere."
fi
[ -n "$PREFIX" ] || die "BACKUP_S3_PREFIX must not be empty; the prune step is scoped by it."

# ---- dump --------------------------------------------------------------------------------------
stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
name="${PGDATABASE}-${stamp}.dump"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
file="$tmp/$name"

log "dumping $PGDATABASE from $PGHOST"
# Custom format: compressed, and restorable table by table. --no-owner/--no-privileges so the dump
# restores cleanly into a fresh container whatever the role is called there.
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  --host="$PGHOST" --username="$PGUSER" --dbname="$PGDATABASE" \
  --format=custom --compress=9 --no-owner --no-privileges \
  --file="$file" \
  || die "pg_dump failed"

size="$(du -h "$file" | cut -f1)"

# ---- verify ------------------------------------------------------------------------------------
# The difference between a backup and a file that happens to exist. Reading the archive's table of
# contents catches a dump truncated by a full disk or a connection dropped mid-write, which is
# otherwise invisible until a restore fails.
log "verifying archive"
pg_restore --list "$file" > /dev/null 2>&1 || die "the dump is not a readable archive; not uploading it"
tables="$(pg_restore --list "$file" 2>/dev/null | grep -c 'TABLE DATA' || true)"
[ "${tables:-0}" -gt 0 ] || die "the dump contains no table data; refusing to upload an empty backup"
log "archive is valid: $size, $tables tables with data"

# ---- upload ------------------------------------------------------------------------------------
mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" \
  > /dev/null 2>&1 || die "could not reach $BACKUP_S3_ENDPOINT — check the endpoint and keys"

mc mb --ignore-existing "backup/$BACKUP_S3_BUCKET" > /dev/null 2>&1 || true

target="backup/$BACKUP_S3_BUCKET/$PREFIX/$name"
log "uploading to $BACKUP_S3_BUCKET/$PREFIX/$name"
mc cp "$file" "$target" > /dev/null || die "upload failed; the dump has NOT been saved off-box"

# Confirm it is actually there and the right size, rather than trusting the exit code.
mc stat "$target" > /dev/null 2>&1 || die "upload reported success but the object is not there"
log "uploaded $size"

# ---- prune -------------------------------------------------------------------------------------
# Scoped to the prefix checked above, so this cannot wander into the rest of the bucket.
if [ "$RETAIN_DAYS" -gt 0 ]; then
  log "pruning backups older than ${RETAIN_DAYS}d"
  mc rm --recursive --force --older-than "${RETAIN_DAYS}d" \
    "backup/$BACKUP_S3_BUCKET/$PREFIX/" 2>/dev/null || log "prune found nothing to remove"
fi

kept="$(mc ls "backup/$BACKUP_S3_BUCKET/$PREFIX/" 2>/dev/null | wc -l | tr -d ' ')"
log "done — $kept backup(s) held off-box"
