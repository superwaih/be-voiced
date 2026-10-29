import { bigint, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * What the server keeps.
 *
 * Five tables, and the one that matters for scale is `jobs`. pg-boss keeps its own queue rows in a
 * `pgboss` schema; this table is the part we own — what the job is about, where its media is, how
 * far along it got, and what it produced. The queue moves work between processes; this is the
 * record of it, and the two commit together.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** Null for accounts that only ever sign in with Google. */
  passwordHash: text("password_hash"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Sessions are opaque rows, not JWTs, so signing out actually signs someone out and a stolen
 * cookie can be revoked.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * A recording someone brought in.
 *
 * The media itself lives in object storage; `storageKey` is where. Nothing about the file passes
 * through this server — the browser uploads straight to the bucket and the worker reads from it.
 */
export const recordings = pgTable(
  "recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type"),
    bytes: bigint("bytes", { mode: "number" }),
    duration: real("duration"),
    /** The project document: transcript, moments, clips, caption style. */
    document: jsonb("document"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recordings_user_idx").on(t.userId, t.updatedAt)],
);

/**
 * One unit of work for a worker.
 *
 * `attempt` and `error` are kept here rather than left to the queue, because someone whose
 * transcription failed twice deserves to be told that, not just shown a spinner.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordingId: uuid("recording_id")
      .notNull()
      .references(() => recordings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** queued | running | done | failed | cancelled */
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("Waiting"),
    progress: real("progress"),
    detail: text("detail"),
    attempt: integer("attempt").notNull().default(0),
    error: text("error"),
    result: jsonb("result"),
    /** Set by the worker, so a job whose worker died can be noticed and retried. */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_recording_idx").on(t.recordingId), index("jobs_user_idx").on(t.userId, t.createdAt)],
);

/** What someone is paying for, and what that entitles them to this period. */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" })
    .unique(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  /** Seconds of audio used this period, reset when the period rolls over. */
  secondsUsed: integer("seconds_used").notNull().default(0),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type Recording = typeof recordings.$inferSelect;
