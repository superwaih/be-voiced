# Deploying to a Contabo VPS

Everything on one box: the app, the workers, Postgres, object storage and TLS. One `docker compose`
command, one dial to turn.

## What to buy

Transcription is CPU-bound and nothing else here is, so **cores are the only spec that matters**.
Contabo sells more of them per euro than anywhere else, which is the reason to be here. RAM and
disk are generous on every tier and you will not be short of either.

Pick the tier by how much audio you expect per day, not by how many users you have.

## What one box does

whisper `base.en` ran 118 seconds of audio in 22.8 seconds on 12 threads — **5.2× realtime**. Per
core that is roughly **0.4–0.5× realtime**, so a worker given 2 threads does about **1× realtime**:
a minute of audio per minute.

| Cores | Workers × threads | Throughput | Audio per day, flat out |
| --- | --- | --- | --- |
| 4 | 1 × 2 | ~1× realtime | ~24 hours |
| 6 | 2 × 2 | ~2× realtime | ~48 hours |
| 8 | 3 × 2 | ~3× realtime | ~72 hours |
| 12 | 5 × 2 | ~5× realtime | ~120 hours |

Leave one core for the app, Postgres and MinIO. They need far less than a core between them, but
they need it when a request arrives, not when a transcription finishes.

**A sense of scale:** 1000 people each uploading one ten-minute recording a month is 10,000 minutes
— about **167 hours a month**, or 5.5 hours a day. A 6-core box clears that in under three hours of
its day. One VPS is not the constraint people expect it to be.

**The constraint it is:** everyone arriving at once. A thousand simultaneous ten-minute uploads is
10,000 minutes of audio; at 3× realtime that is **55 hours of queue**. Nothing breaks — the uploads
succeed, the rows are written, the jobs drain in order — but the last person waits two days. A
fixed box converts a spike into a wait, and the only answers are more cores or more boxes.

## Setting it up

```bash
# On the VPS, as root
apt update && apt install -y docker.io docker-compose-plugin git
git clone <your repo> be-voiced && cd be-voiced/apps/saas
```

Point **two** A records at the VPS before the first start, both to the same IP:

| Record | Points at | Why |
| --- | --- | --- |
| `app.example.com` | the VPS IP | the app |
| `storage.app.example.com` | the same IP | uploads and playback |

Storage needs a name of its own rather than a path under the app: a presigned URL is signed over
the exact path the browser requests, and a proxied subdirectory cannot preserve it. Caddy gets a
certificate for each on boot and cannot for a name that does not resolve.

Write `.env` beside `docker-compose.prod.yml`:

```bash
DOMAIN=app.example.com
POSTGRES_PASSWORD=<long random string>
S3_SECRET_ACCESS_KEY=<long random string>

# The model baked into the worker image.
#   ggml-base.en.bin        142 MB, quick, good for clear speech
#   ggml-small.en-tdrz.bin  465 MB, slower, and the only one that marks speaker changes
WHISPER_MODEL=ggml-base.en.bin

# Threads per worker, and the ceiling Docker enforces on each. Keep them equal.
WHISPER_THREADS=2
WORKER_CPUS=2
```

Then:

```bash
docker compose -f docker-compose.prod.yml up -d --build --scale worker=3
```

That is the whole deployment. Migrations apply themselves: a one-shot `migrate` container runs to
completion first, and the app and workers wait on it. Nothing to run by hand, and no window where
a worker reaches a database that has no tables yet.

The first build compiles whisper.cpp from source and downloads the model. Ten to twenty minutes,
once. Afterwards:

```bash
docker compose -f docker-compose.prod.yml ps        # app, worker(s) and caddy up; migrate exited 0
docker compose -f docker-compose.prod.yml logs -f app
```

Then open the domain and create an account. The first sign-up is an ordinary account, not an admin
— there is no admin panel yet.

## Turning the dial

`--scale worker=N` is the whole scaling story:

```bash
docker compose -f docker-compose.prod.yml up -d --scale worker=5
```

Rule of thumb: `N × WHISPER_THREADS ≈ cores − 1`. More workers than that and they fight each other
for cores, which makes every job slower without finishing any more of them.

Watch the queue to know whether N is right:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U bevoiced -c "SELECT status, count(*) FROM jobs GROUP BY status;"
```

A `queued` count that never falls to zero means you are under-provisioned. A worker that is idle
most of the day means you are over.

## Going past one box

Workers hold no state. They take jobs from Postgres and media from storage, and that is all they
touch — so a second VPS running only the `worker` service, pointed at the first box's
`DATABASE_URL` and `S3_ENDPOINT`, doubles throughput and needs no other change.

That is the scaling path here: not elastic, but linear and cheap. Open Postgres and MinIO to the
second box over a private network or a WireGuard tunnel — never the public internet.

## Backups

`pg_dump` runs daily in its own container, verifies the dump, uploads it off the box and prunes
what has aged out. Postgres holds every account, transcript and project document — everything a
user would consider their work.

**It does not run until you configure it.** The service starts with the stack, finds no
destination, says so in its logs and stops. That is deliberate: a box with no backups should be
noisy about it rather than look healthy.

### Where the dumps go

Not on this machine. A dump on the same disk as the database dies with it, and the reassuring list
of files makes the loss worse, because it reads like safety until the moment it is tested. The
script refuses the local MinIO outright for this reason.

Cloudflare R2 is the natural target: egress is free, so pulling a dump back down during an
incident costs nothing at the moment a surprise bill is least welcome. Any S3-compatible storage
works — Backblaze B2, Contabo Object Storage, another provider's S3.

Create a bucket and an API token scoped to it, then add to `.env`:

```bash
BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=bevoiced-backups
BACKUP_S3_ACCESS_KEY_ID=<token id>
BACKUP_S3_SECRET_ACCESS_KEY=<token secret>

# Optional; these are the defaults.
BACKUP_AT=03:17          # daily, UTC — always UTC, so clock changes cannot skip a run
BACKUP_RETAIN_DAYS=14
BACKUP_S3_PREFIX=postgres
```

Then start it and **prove it works now**, rather than finding out at 03:17:

```bash
docker compose -f docker-compose.prod.yml up -d backup
docker compose -f docker-compose.prod.yml run --rm backup /usr/local/bin/backup.sh
```

A good run ends with the size it uploaded and how many backups are held. A wrong key or a missing
bucket fails here, in front of you, which is the entire point of running it by hand once.

```bash
docker compose -f docker-compose.prod.yml logs backup    # what it did, and when the next one is
```

### Restoring

**Do this once, before you need it.** An untested restore is a belief, not a backup — and the only
way to find out that the dump is empty, or that you backed up the wrong database, is to try.

List what is held, and fetch one:

```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint sh backup -c '
  mc alias set b "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY" &&
  mc ls b/$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/'
```

Restore it over the live database — this **replaces** the current contents, so stop the app and
workers first so nothing writes mid-restore:

```bash
docker compose -f docker-compose.prod.yml stop app worker

docker compose -f docker-compose.prod.yml run --rm --entrypoint sh backup -c '
  set -e
  mc alias set b "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY"
  mc cp b/$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/bevoiced-20261029T031700Z.dump /tmp/r.dump
  PGPASSWORD="$POSTGRES_PASSWORD" pg_restore     --host=postgres --username=bevoiced --dbname=bevoiced     --clean --if-exists --no-owner --no-privileges --single-transaction /tmp/r.dump'

docker compose -f docker-compose.prod.yml start app worker
```

`--single-transaction` means a restore that fails half way leaves the database as it was rather
than half-written. `--clean --if-exists` drops what the dump is about to replace, so restoring
over a populated database does not collide.

To rehearse without touching production, restore into a scratch database instead — same command
with `--dbname=rehearsal` after `createdb`:

```bash
docker compose -f docker-compose.prod.yml exec postgres createdb -U bevoiced rehearsal
```

### What is not covered

Roles and passwords live outside the dump (`pg_dump` is one database, not the cluster), but there
is only one role here and the compose file creates it from `POSTGRES_PASSWORD`. Keep that value
somewhere other than this box, or a restore has a database and no way into it.


## What this does not do

**There is no autoscaler.** A fixed box cannot grow to meet a spike; you decide the capacity in
advance and the queue absorbs the rest. If bursts are the normal case rather than the exception,
workers belong somewhere that bills per second — the app can stay here and only the `worker`
service moves.

**Media is not backed up.** The database is (below), but the recordings themselves are not. They
are the one thing here that cannot be regenerated, and they are also the expensive thing to copy.
`mc mirror` to the same bucket is the cheap answer when you decide the storage bill is worth it.

**Storage grows forever.** Every upload is kept. Decide a retention window and enforce it, or the
disk fills.
