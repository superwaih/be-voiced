-- The first schema: accounts, recordings, jobs, subscriptions.
--
-- Written by hand rather than generated, so what runs against the database is what someone read.
-- pg-boss creates and owns its own `pgboss` schema on first run; nothing here touches it.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL UNIQUE,
  name              TEXT,
  password_hash     TEXT,
  email_verified_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS recordings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  storage_key  TEXT NOT NULL,
  content_type TEXT,
  bytes        BIGINT,
  duration     REAL,
  document     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recordings_user_idx ON recordings (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  stage        TEXT NOT NULL DEFAULT 'Waiting',
  progress     REAL,
  detail       TEXT,
  attempt      INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  result       JSONB,
  heartbeat_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_recording_idx ON jobs (recording_id);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs (user_id, created_at DESC);
-- Finding work that has stalled: a running job whose worker stopped reporting.
CREATE INDEX IF NOT EXISTS jobs_running_idx ON jobs (heartbeat_at) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free',
  status                 TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  seconds_used           INTEGER NOT NULL DEFAULT 0,
  period_end             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
