/// <reference lib="webworker" />

/**
 * Transcription, off the main thread.
 *
 * Whisper runs here through ONNX Runtime — on the GPU where WebGPU exists, on the CPU otherwise.
 * Either way it is seconds to minutes of solid work, so it cannot share a thread with the
 * interface.
 *
 * The audio is walked in windows rather than handed over whole. That is what makes progress real:
 * a long recording reports where it has got to instead of showing a bar that cannot say. Windows
 * overlap, and the overlap is split down the middle when the words are stitched back together, so
 * no word is counted twice and none is dropped at a seam.
 *
 * Who is speaking is worked out separately, over the whole recording at once — see `diarize.ts`
 * for why that pass cannot be windowed.
 */

import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import { assignSpeakers, diarize, loadDiarizer } from "./diarize";
import type { FromWorker, RawWord, ToWorker } from "./protocol";

const SAMPLE_RATE = 16000;

const post = (m: FromWorker) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let cancelled = false;
let loaded: { model: string; pipe: AutomaticSpeechRecognitionPipeline } | null = null;

class Cancelled extends Error {}

function check() {
  if (cancelled) throw new Cancelled();
}

/** True when this browser can run the model on the GPU, which is roughly an order of magnitude. */
async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load(model: string): Promise<AutomaticSpeechRecognitionPipeline> {
  if (loaded?.model === model) return loaded.pipe;
  loaded = null;

  const webgpu = await hasWebGPU();
  post({ type: "loading", progress: null, detail: webgpu ? "Preparing, using your graphics card" : "Preparing" });

  // Eight-bit weights on both backends. Whisper holds its accuracy at this precision, and it is
  // the difference between a download someone will wait for and one they will not: full precision
  // costs about three times as much for no gain you can hear. Half precision is avoided on the
  // GPU because Whisper's encoder has known accuracy problems there.
  const pipe = (await pipeline("automatic-speech-recognition", model, {
    device: webgpu ? "webgpu" : "wasm",
    dtype: "q8",
    progress_callback: (p: unknown) => {
      const e = p as { status?: string; file?: string; progress?: number; total?: number };
      if (e.status !== "progress" || typeof e.progress !== "number") return;
      const mb = e.total ? `${(e.total / 1_048_576).toFixed(0)} MB` : null;
      post({
        type: "loading",
        progress: e.progress / 100,
        detail: mb ? `Downloading the model once, ${mb}` : "Downloading the model once",
      });
    },
  })) as AutomaticSpeechRecognitionPipeline;

  loaded = { model, pipe };
  return pipe;
}

async function run(msg: Extract<ToWorker, { type: "start" }>) {
  const pipe = await load(msg.model);
  check();

  if (msg.diarize) {
    // Fetched now rather than after transcribing, so the whole download happens while someone is
    // already waiting for "getting ready" instead of pausing again at the end.
    post({ type: "loading", progress: null, detail: "Preparing to tell voices apart" });
    await loadDiarizer().catch(() => undefined);
    check();
  }

  const total = msg.audio.length / SAMPLE_RATE;
  const step = Math.max(10, msg.window - msg.overlap);
  const starts: number[] = [];
  for (let at = 0; at < total; at += step) starts.push(at);

  const words: RawWord[] = [];
  let language: string | null = null;

  for (let i = 0; i < starts.length; i++) {
    check();
    const from = starts[i];
    const to = Math.min(total, from + msg.window);
    if (to - from < 0.2) break;

    const slice = msg.audio.subarray(Math.floor(from * SAMPLE_RATE), Math.floor(to * SAMPLE_RATE));
    const output = await pipe(slice, {
      return_timestamps: "word",
      // Whisper sees 30 seconds at a time; the stride is what lets it join them without a seam.
      chunk_length_s: 30,
      stride_length_s: 5,
      language: msg.language === "auto" ? undefined : msg.language,
      task: "transcribe",
    });

    const chunks = (Array.isArray(output) ? output[0] : output).chunks ?? [];
    // Each window owns from halfway through its leading overlap to halfway through its trailing
    // one, so a word that straddles a seam lands in exactly one window.
    const ownFrom = i === 0 ? 0 : from + msg.overlap / 2;
    const ownTo = i === starts.length - 1 ? total : to - msg.overlap / 2;

    for (const c of chunks) {
      const text = c.text?.trim();
      if (!text) continue;
      const [s, e] = c.timestamp;
      if (typeof s !== "number" || !Number.isFinite(s)) continue;
      const start = from + s;
      if (start < ownFrom || start >= ownTo) continue;
      const end = typeof e === "number" && Number.isFinite(e) ? from + e : start + 0.2;
      words.push({ text, start, end });
    }

    post({ type: "progress", progress: Math.min(1, (i + 1) / starts.length) });
  }

  // The model reports the language it heard, when it was not told.
  if (msg.language !== "auto") language = msg.language;

  let finished: RawWord[] = words;
  let diarized = false;

  if (msg.diarize && words.length) {
    try {
      check();
      post({ type: "stage", stage: "Telling the voices apart" });
      const turns = await diarize(msg.audio);
      check();
      if (turns.length) {
        finished = assignSpeakers(words, turns);
        diarized = new Set(finished.map((w) => w.speaker ?? 0)).size > 1;
      }
    } catch (err) {
      // A transcript with one speaker label is still a transcript. Losing the whole thing because
      // the segmentation model would not load would be a much worse trade.
      if (err instanceof Cancelled || cancelled) throw err;
      console.warn("Could not tell the voices apart", err);
    }
  }

  post({ type: "done", words: finished, language, diarized });
}

self.addEventListener("message", (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  cancelled = false;
  run(msg)
    .catch((err) => {
      if (err instanceof Cancelled || cancelled) {
        post({ type: "cancelled" });
        return;
      }
      post({ type: "failed", message: err instanceof Error ? err.message : String(err) });
    })
    .finally(() => {
      cancelled = false;
    });
});
