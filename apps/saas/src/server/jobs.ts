import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWord } from "./whisper";

/**
 * Transcription jobs the server is working on.
 *
 * An upload returns straight away with an id, and the browser asks how it is getting on. That is
 * the only shape that works: these jobs run for minutes, and a request held open for minutes dies
 * to a proxy timeout somewhere between here and the person waiting.
 *
 * Kept in memory on purpose, for now. One process, one map. When there is more than one of those
 * this becomes a table and a worker claims rows from it — the shape above does not change, which
 * is the point.
 */

export type JobStatus = "preparing" | "transcribing" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  status: JobStatus;
  stage: string;
  /** 0 to 1, or null where the step cannot say. */
  progress: number | null;
  detail: string | null;
  error?: string;
  result?: { words: ServerWord[]; language: string | null; diarized: boolean; model: string };
  createdAt: number;
  controller: AbortController;
  /** Where the uploaded file and its working WAV live, removed when the job ends. */
  dir: string;
}

const jobs = new Map<string, Job>();

/** Finished jobs are kept briefly so a slow poll still finds the answer, then dropped. */
const KEEP_FINISHED_MS = 10 * 60 * 1000;

export async function createJob(): Promise<Job> {
  const id = crypto.randomUUID();
  const dir = await mkdtemp(join(tmpdir(), "soundbite-"));
  const job: Job = {
    id,
    status: "preparing",
    stage: "Preparing audio",
    progress: null,
    detail: null,
    createdAt: Date.now(),
    controller: new AbortController(),
    dir,
  };
  jobs.set(id, job);
  sweep();
  return job;
}

export const getJob = (id: string) => jobs.get(id);

export function update(job: Job, patch: Partial<Pick<Job, "status" | "stage" | "progress" | "detail">>) {
  Object.assign(job, patch);
}

/** Ends a job and clears up after it, whatever the reason. */
export async function finish(job: Job, patch: Partial<Job>) {
  Object.assign(job, patch);
  job.progress = job.status === "done" ? 1 : job.progress;
  await rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
  setTimeout(() => jobs.delete(job.id), KEEP_FINISHED_MS).unref?.();
}

export async function cancelJob(id: string): Promise<boolean> {
  const job = jobs.get(id);
  if (!job || job.status === "done" || job.status === "failed") return false;
  job.controller.abort();
  await finish(job, { status: "cancelled", stage: "Cancelled" });
  return true;
}

/** A job whose caller vanished should not hold a temp directory forever. */
function sweep() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const job of jobs.values()) {
    if (job.createdAt < cutoff) {
      job.controller.abort();
      void rm(job.dir, { recursive: true, force: true }).catch(() => undefined);
      jobs.delete(job.id);
    }
  }
}

/** What the browser is told. The internals — the abort controller, the temp directory — stay here. */
export const publicView = (job: Job) => ({
  id: job.id,
  status: job.status,
  stage: job.stage,
  progress: job.progress,
  detail: job.detail,
  error: job.error,
  result: job.result,
});
