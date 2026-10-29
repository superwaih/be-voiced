"use client";

/**
 * Transcription on our server, in three steps.
 *
 *   1. ask for somewhere to put the file      POST /api/uploads
 *   2. send it straight there                 PUT  <presigned url>
 *   3. ask for it to be transcribed           POST /api/transcribe  → 202 { id }
 *      then wait                              GET  /api/transcribe/<id>
 *
 * The middle step is the one that matters: the file goes **directly to object storage** and never
 * passes through the app. That is what lets a thousand people upload at once without the server
 * holding a thousand files in memory.
 *
 * Step three returns a job id rather than a transcript, because the work takes minutes and no
 * request survives that between here and a worker.
 */

import type { Transcript } from "@/lib/engine/types";
import { normalize } from "./normalize";
import type { RawWord } from "./protocol";
import type { TranscribeProgress } from "./index";

interface JobView {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  stage: string;
  progress: number | null;
  detail: string | null;
  error?: string;
  result?: { words: RawWord[]; language: string | null; diarized: boolean; model: string };
}

export interface ServerCapability {
  available: boolean;
  engine: "whisper" | null;
  model: string | null;
}

let capability: ServerCapability | null = null;

/** What this server can do. Asked once per page load, and never blocks anything. */
export async function serverCapability(): Promise<ServerCapability> {
  if (capability) return capability;
  try {
    const res = await fetch("/api/transcribe");
    capability = (await res.json()) as ServerCapability;
  } catch {
    capability = { available: false, engine: null, model: null };
  }
  return capability;
}

export class ServerCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "ServerCancelled";
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * PUTs the file to storage, reporting how much has gone.
 *
 * `fetch` cannot say how far through an upload it is, and a hundred-megabyte upload with no
 * progress is indistinguishable from a hung one — so this is the one place an XMLHttpRequest
 * still earns its keep.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The upload was refused (${xhr.status}).`));
    xhr.onerror = () => reject(new Error("The upload did not reach storage."));
    xhr.onabort = () => reject(new ServerCancelled());

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export async function transcribeOnServer(
  file: File,
  language: string,
  duration: number,
  onProgress: (p: TranscribeProgress) => void,
  signal?: AbortSignal,
): Promise<Transcript> {
  if (signal?.aborted) throw new ServerCancelled();

  // 1. Somewhere to put it.
  onProgress({ stage: "Preparing", progress: null, detail: null });
  const place = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      contentType: file.type || "application/octet-stream",
      bytes: file.size,
      duration,
    }),
    signal,
  });
  const placed = (await place.json()) as { recordingId: string; uploadUrl: string; error?: string };
  if (!place.ok) throw new Error(placed.error ?? "Could not start an upload.");

  // 2. Straight to storage, not through us.
  const mb = (n: number) => `${(n / 1_048_576).toFixed(0)} MB`;
  await putWithProgress(
    placed.uploadUrl,
    file,
    (sent, total) =>
      onProgress({ stage: "Uploading", progress: total ? sent / total : null, detail: `${mb(sent)} of ${mb(total)}` }),
    signal,
  );

  // 3. Ask for it to be transcribed, and wait.
  onProgress({ stage: "Queued", progress: null, detail: null });
  const started = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordingId: placed.recordingId, language, duration }),
    signal,
  });
  const first = (await started.json()) as JobView & { error?: string };
  if (!started.ok) throw new Error(first.error ?? "The server would not take that recording.");

  const jobId = first.id;
  // Cancelling has to reach the server: stopping the poll alone leaves a worker busy for nobody.
  const stop = () => void fetch(`/api/transcribe/${jobId}`, { method: "DELETE", keepalive: true });
  signal?.addEventListener("abort", stop, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) throw new ServerCancelled();
      await pause(1000);

      const res = await fetch(`/api/transcribe/${jobId}`, { cache: "no-store" });
      if (res.status === 404) throw new Error("The server lost track of that job.");
      const view = (await res.json()) as JobView;

      onProgress({
        stage: view.status === "queued" ? "Waiting for a worker" : view.stage,
        progress: view.progress,
        detail: view.detail,
      });

      if (view.status === "done" && view.result) {
        const { words, language: detected, model } = view.result;
        return normalize(model, detected, words, "whisper");
      }
      if (view.status === "failed") throw new Error(view.error ?? "Transcription failed on the server.");
      if (view.status === "cancelled") throw new ServerCancelled();
    }
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
