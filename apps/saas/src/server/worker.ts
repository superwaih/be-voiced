/**
 * The transcription worker.
 *
 * A separate process from the web app, and that separation is the whole point: the web app stays
 * responsive no matter how much work is queued, because it is not doing any of it.
 *
 * **Concurrency is the worker count, not the request count.** This process takes exactly
 * `WORKER_CONCURRENCY` jobs at a time — one by default, because whisper already uses every core it
 * is given and running two at once on the same box makes both slower, not the pair faster. A
 * thousand people uploading at once puts a thousand rows in a table; they are worked through at
 * whatever rate the fleet can manage, and nothing falls over. To go faster, run more workers.
 *
 *   node --experimental-strip-types src/server/worker.ts
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql as raw } from "drizzle-orm";
import { db } from "./db";
import { jobs, recordings } from "./db/schema";
import { whisperModel } from "./config";
import { queue, TRANSCRIBE_QUEUE, type TranscribeMessage } from "./queue";
import { Cancelled, ProcessFailed } from "./run";
import { downloadUrl } from "./storage";
import { toWav, transcribeWav, wavPathFor } from "./whisper";

const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);
/** How often a running job says it is still alive, so a dead worker's job can be noticed. */
const HEARTBEAT_MS = 15_000;

async function setJob(id: string, patch: Partial<typeof jobs.$inferInsert>) {
  await db.update(jobs).set(patch).where(eq(jobs.id, id));
}

async function handle(message: TranscribeMessage) {
  const { jobId, recordingId, storageKey, language, duration } = message;

  // A job already finished is a job that must not run again: queues deliver more than once, and
  // the second delivery has to be free.
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!existing) return;
  if (existing.status === "done" || existing.status === "cancelled") return;

  const dir = await mkdtemp(join(tmpdir(), "bevoiced-"));
  const beat = setInterval(() => {
    void setJob(jobId, { heartbeatAt: new Date() }).catch(() => undefined);
  }, HEARTBEAT_MS);

  try {
    await setJob(jobId, {
      status: "running",
      stage: "Fetching audio",
      progress: 0,
      startedAt: new Date(),
      heartbeatAt: new Date(),
      attempt: (existing.attempt ?? 0) + 1,
    });

    // Read the media straight out of the bucket. It never went through the web app and it does not
    // come back through it either.
    const source = join(dir, "source");
    const res = await fetch(await downloadUrl(storageKey));
    if (!res.ok) throw new Error(`The stored recording could not be read (${res.status}).`);
    await writeFile(source, Buffer.from(await res.arrayBuffer()));

    await setJob(jobId, { stage: "Preparing audio", progress: 0.02 });
    const wav = wavPathFor(dir, jobId);
    await toWav(source, wav, duration, (f) => void setJob(jobId, { progress: 0.02 + f * 0.08 }));

    await setJob(jobId, { stage: "Transcribing", progress: 0.1 });
    const out = await transcribeWav(wav, language, (f) =>
      void setJob(jobId, { progress: 0.1 + f * 0.89 }),
    );
    if (!out.words.length) throw new Error("No speech was found in this file.");

    const result = { ...out, model: whisperModel().split(/[\\/]/).pop() ?? "whisper" };
    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({ status: "done", stage: "Done", progress: 1, result, finishedAt: new Date(), error: null })
        .where(eq(jobs.id, jobId));
      await tx.update(recordings).set({ updatedAt: new Date() }).where(eq(recordings.id, recordingId));
    });
    console.log(`job ${jobId}: done, ${out.words.length} words`);
  } catch (err) {
    const cancelled = err instanceof Cancelled;
    const message =
      err instanceof ProcessFailed
        ? `${err.command} failed. ${err.output.split("\n").slice(-2).join(" ")}`
        : err instanceof Error
          ? err.message
          : String(err);

    await setJob(jobId, {
      status: cancelled ? "cancelled" : "failed",
      stage: cancelled ? "Cancelled" : "Failed",
      error: cancelled ? null : message,
      finishedAt: new Date(),
    });
    console.error(`job ${jobId}: ${message}`);
    // Rethrow so the queue counts the attempt and retries it, unless someone cancelled.
    if (!cancelled) throw err;
  } finally {
    clearInterval(beat);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Jobs whose worker died: still marked running, but silent for too long.
 *
 * The queue will redeliver them of its own accord; this only stops the interface showing a job as
 * running forever while nothing is happening to it.
 */
async function reapStalled() {
  await db
    .update(jobs)
    .set({ status: "queued", stage: "Waiting", detail: "Picked up again" })
    .where(raw`${jobs.status} = 'running' AND ${jobs.heartbeatAt} < now() - interval '2 minutes'`);
}

async function main() {
  const model = whisperModel();
  console.log(`worker starting: concurrency ${CONCURRENCY}, model ${model}`);

  const boss = await queue();
  await boss.work<TranscribeMessage>(
    TRANSCRIBE_QUEUE,
    { batchSize: CONCURRENCY },
    async (messages) => {
      for (const m of messages) await handle(m.data);
    },
  );

  setInterval(() => void reapStalled().catch(() => undefined), 60_000);
  console.log("worker ready");
}

main().catch((err) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
