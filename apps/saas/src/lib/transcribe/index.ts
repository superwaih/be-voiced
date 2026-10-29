"use client";

/**
 * Transcription, in the browser.
 *
 * Whisper runs on this machine — on the GPU through WebGPU where it exists, on the CPU otherwise.
 * Nothing is uploaded, nothing is queued behind anyone else, and there is no per-minute bill. The
 * cost is the model, downloaded once and cached by the browser afterwards.
 *
 * This module turns a file into 16 kHz mono samples, hands them to the worker, and reports what it
 * is doing. The worker does the work; see `worker.ts`.
 *
 * There is a second path, for the machines this one cannot serve: a browser too old for any of it,
 * or an attempt that failed outright. Those go to the server instead — see `server.ts`. Nobody
 * chooses between them and nobody is told which ran; a transcript is a transcript.
 */

import type { Transcript } from "@/lib/engine/types";
import { normalize } from "./normalize";
import { qualityFor } from "./models";
import type { FromWorker, ToWorker } from "./protocol";
import { serverCapability, ServerCancelled, transcribeOnServer } from "./server";

const SAMPLE_RATE = 16000;

export interface TranscribeProgress {
  stage: string;
  progress: number | null;
  detail: string | null;
}

export class TranscribeCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "TranscribeCancelled";
  }
}

/**
 * Whether this browser can do it at all.
 *
 * WebGPU is not required — it is the difference between quick and slow, not between working and
 * not. What is required is enough of a modern browser to run the runtime at all.
 */
export const canTranscribeHere = () =>
  typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";

export async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/**
 * Decodes a file to the mono 16 kHz Whisper expects.
 *
 * `OfflineAudioContext` does the resampling, which means the browser's own resampler rather than
 * one written here, and it decodes whatever containers the browser can open.
 */
async function toSamples(file: File, onStage: (p: TranscribeProgress) => void): Promise<Float32Array> {
  onStage({ stage: "Reading audio", progress: null, detail: null });
  const bytes = await file.arrayBuffer();

  // Decoding needs a context at the file's own rate; resampling needs one at the target rate.
  const decoded = await new AudioContext({ sampleRate: SAMPLE_RATE }).decodeAudioData(bytes).catch(async () => {
    // Safari and some containers refuse a context whose rate does not match the file's.
    const native = new AudioContext();
    const buffer = await native.decodeAudioData(bytes.slice(0));
    void native.close();
    const off = new OfflineAudioContext(1, Math.ceil((buffer.duration * SAMPLE_RATE) | 0), SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = buffer;
    src.connect(off.destination);
    src.start();
    return off.startRendering();
  });

  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);

  // Average the channels: speech sits in both, and one channel alone can be the quiet one.
  const left = decoded.getChannelData(0);
  const right = decoded.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
  return mono;
}

interface BrowserOptions {
  file: File;
  /** A quality id from `models.ts`. */
  quality: string;
  /** "auto", or a two-letter code. */
  language: string;
  onProgress: (p: TranscribeProgress) => void;
  signal?: AbortSignal;
}

export interface TranscribeOptions extends BrowserOptions {
  /** Used to decide whether a laptop should be asked to do this at all. */
  duration: number;
}

/**
 * Transcribes a recording, wherever it can be done.
 *
 * The server when it has whisper on it, which is the normal case and the one everyone should get:
 * the same quality from a phone as from a workstation, and no model to download. The browser when
 * the server has nothing set up, which keeps a bare checkout working and a self-hoster going.
 */
export async function transcribe(opts: TranscribeOptions): Promise<Transcript> {
  const { duration, ...browser } = opts;
  const server = await serverCapability();

  if (server.available) {
    try {
      return await transcribeOnServer(opts.file, opts.language, duration, opts.onProgress, opts.signal);
    } catch (err) {
      if (err instanceof ServerCancelled) throw new TranscribeCancelled();
      if (!canTranscribeHere()) throw err;
      // The server was meant to do this and could not. Falling back here is better than losing the
      // recording — but it is slower and costs a model download, so it is said out loud rather
      // than slipped past someone as if nothing happened.
      console.warn("Server transcription failed; falling back to this browser", err);
      opts.onProgress({
        stage: "Transcribing on this device",
        progress: null,
        detail: "The server could not take it, so it runs here instead",
      });
    }
  }

  if (!canTranscribeHere()) {
    throw new Error("This browser cannot transcribe, and the server has no transcription set up.");
  }
  return inBrowser(browser);
}

async function inBrowser({
  file,
  quality,
  language,
  onProgress,
  signal,
}: BrowserOptions): Promise<Transcript> {
  if (signal?.aborted) throw new TranscribeCancelled();
  const q = qualityFor(quality);
  const audio = await toSamples(file, onProgress);
  if (signal?.aborted) throw new TranscribeCancelled();

  const minutes = audio.length / SAMPLE_RATE / 60;
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

  try {
    return await new Promise<Transcript>((resolve, reject) => {
      const stop = () => {
        worker.postMessage({ type: "cancel" } satisfies ToWorker);
        reject(new TranscribeCancelled());
      };
      signal?.addEventListener("abort", stop, { once: true });

      worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        switch (msg.type) {
          case "loading":
            onProgress({ stage: "Getting ready", progress: msg.progress, detail: msg.detail });
            break;
          case "stage":
            onProgress({ stage: msg.stage, progress: null, detail: null });
            break;
          case "progress":
            onProgress({
              stage: "Transcribing",
              progress: msg.progress,
              detail: minutes >= 2 ? `${minutes.toFixed(0)} minutes of audio` : null,
            });
            break;
          case "done":
            onProgress({ stage: "Building transcript", progress: 1, detail: null });
            if (!msg.words.length) {
              reject(new Error("No speech was found in this file."));
              return;
            }
            resolve(normalize(q.id, msg.language, msg.words));
            break;
          case "cancelled":
            reject(new TranscribeCancelled());
            break;
          case "failed":
            reject(new Error(msg.message));
            break;
        }
      });

      worker.addEventListener("error", (e) => reject(new Error(e.message || "Transcription failed to start.")));

      const start: ToWorker = {
        type: "start",
        audio,
        model: q.model,
        language: q.englishOnly ? "en" : language,
        // Two-minute windows: often enough to report progress honestly, long enough that the
        // model keeps its context and the per-window overhead stays small.
        window: 120,
        overlap: 4,
        diarize: true,
      };
      worker.postMessage(start, [audio.buffer as ArrayBuffer]);
    });
  } finally {
    worker.terminate();
  }
}
