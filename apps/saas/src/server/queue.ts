import { PgBoss } from "pg-boss";

/**
 * The queue.
 *
 * pg-boss keeps jobs as rows in Postgres and hands them out with `SELECT … FOR UPDATE SKIP
 * LOCKED`, which is what makes this safe with many workers: each one takes work nobody else has,
 * without locking the others out.
 *
 * Postgres rather than Redis for one reason that matters more than throughput — a job and the
 * recording it belongs to can be written in the **same transaction**. With a separate queue server
 * there is always a window where one exists and the other does not, and the usual fix is an outbox
 * table, which is a queue you now maintain yourself.
 *
 * The ceiling is a few thousand jobs a second. This is minutes of work per job, so the ceiling is
 * irrelevant; the correctness is not.
 */

export const TRANSCRIBE_QUEUE = "transcribe";

const globalForBoss = globalThis as unknown as { __boss?: PgBoss };

export async function queue(): Promise<PgBoss> {
  if (globalForBoss.__boss) return globalForBoss.__boss;

  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL ?? "postgres://bevoiced:bevoiced@localhost:5432/bevoiced",
    // A worker that dies mid-job should not take the job with it: unclaimed after this, it goes
    // back on the queue for someone else.
    schema: "pgboss",
  });
  boss.on("error", (err: unknown) => console.error("queue error", err));
  await boss.start();
  await boss.createQueue(TRANSCRIBE_QUEUE);

  globalForBoss.__boss = boss;
  return boss;
}

export interface TranscribeMessage {
  jobId: string;
  recordingId: string;
  userId: string;
  storageKey: string;
  language: string;
  duration: number;
}

/** Puts a transcription on the queue. Retries are the queue's business, not the caller's. */
export async function enqueueTranscription(message: TranscribeMessage): Promise<void> {
  const boss = await queue();
  await boss.send(TRANSCRIBE_QUEUE, message, {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    // Long enough for an hour of audio on a slow box; a job still running after this is stuck,
    // and the queue hands it to someone else.
    expireInSeconds: 3 * 60 * 60,
  });
}
