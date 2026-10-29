#!/bin/sh
# Runs backup.sh once a day, at BACKUP_AT (UTC).
#
# This is a sleep-until-the-next-occurrence loop rather than cron, for three reasons:
#
#   - crond's applet is not guaranteed present in every Alpine base, and discovering that it is
#     missing takes a day, because the symptom is simply that nothing happens.
#   - cron swallows output. Here the log goes to stdout, so `docker compose logs backup` is the
#     whole story, and a failing backup is visible in the same place as everything else.
#   - a restart cannot skip a run. Cron inside a container that was down at the scheduled minute
#     just misses it; this always sleeps to the next occurrence and says when that is.
#
# Everything is UTC on purpose. A local-time schedule runs twice or not at all on the two days a
# year the clocks change, and that is a silly way to lose a backup.

set -eu

log() { echo "[backup $(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

# Not configured yet is a normal state, not a crash. Exiting 0 with an explanation keeps the rest
# of the stack starting cleanly and keeps this out of a restart loop, while still being impossible
# to miss in `docker compose logs`. The service restarts `on-failure`, so exit 0 means it stays
# stopped until the credentials exist.
if [ -z "${BACKUP_S3_ENDPOINT:-}" ]; then
  log "backups are NOT running: BACKUP_S3_ENDPOINT is unset."
  log "the database is not being backed up anywhere. See the backup section of DEPLOY.md."
  exit 0
fi

AT="${BACKUP_AT:-03:17}"

case "$AT" in
  [0-9][0-9]:[0-9][0-9]) ;;
  *) log "BACKUP_AT must look like HH:MM in 24-hour UTC; got '$AT'"; exit 1 ;;
esac

hh="${AT%%:*}"
mm="${AT##*:}"
# Strip any leading zero so arithmetic does not read these as octal.
target=$(( ${hh#0} * 3600 + ${mm#0} * 60 ))
[ "$target" -lt 86400 ] || { log "BACKUP_AT '$AT' is not a real time of day"; exit 1; }

# A backup immediately on start, for proving the credentials work without waiting for the clock.
# Off by default: a crash-looping container would otherwise hammer the bucket.
if [ "${BACKUP_ON_START:-false}" = "true" ]; then
  log "BACKUP_ON_START is set; backing up now"
  /usr/local/bin/backup.sh || log "that backup failed — see the error above; carrying on to the schedule"
fi

log "scheduled daily at ${AT} UTC, keeping ${BACKUP_RETAIN_DAYS:-14} days"

while :; do
  now=$(( $(date -u +%H | sed 's/^0//;s/^$/0/') * 3600 \
        + $(date -u +%M | sed 's/^0//;s/^$/0/') * 60 \
        + $(date -u +%S | sed 's/^0//;s/^$/0/') ))
  delta=$(( target - now ))
  [ "$delta" -gt 0 ] || delta=$(( delta + 86400 ))

  log "next backup in $(( delta / 3600 ))h $(( (delta % 3600) / 60 ))m"
  sleep "$delta"

  # A failure must not end the loop: one bad night should not silently stop every future backup.
  # It is logged at full volume instead, and the schedule continues.
  /usr/local/bin/backup.sh || log "BACKUP FAILED — the database is not backed up for today"

  # Step off the scheduled second so the recomputed delta cannot land on zero and run twice.
  sleep 60
done
