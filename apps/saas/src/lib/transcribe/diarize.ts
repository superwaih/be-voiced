/**
 * Working out who is speaking.
 *
 * Whisper says what was said; it has no idea who said it. This is the part that turns a wall of
 * text into a conversation with turns in it, which is what the transcript, the moment finder and
 * the captions are all shaped around.
 *
 * It takes two models, and both are needed:
 *
 *   1. **Segmentation** (pyannote) says *when* a voice is active and when it changes. Its speaker
 *      numbers are only meaningful locally — "speaker 1" ten seconds in has nothing to do with
 *      "speaker 1" a minute later. Using it alone looks like it works and is quietly wrong: in
 *      testing it put two obviously different speakers under one label and gave the second label
 *      a single word.
 *   2. **Embeddings** (an x-vector model) turn each of those stretches into a vector that
 *      describes the voice. Clustering those vectors is what makes the numbering mean the same
 *      thing across the whole recording.
 *
 * Skipping the second step is the common mistake. It is the whole reason this file is not fifty
 * lines long.
 */

import { AutoModel, AutoModelForAudioFrameClassification, AutoProcessor } from "@huggingface/transformers";

export const SEGMENTATION_MODEL = "onnx-community/pyannote-segmentation-3.0";
/**
 * The embedding model pyannote's own pipeline pairs with its segmentation model.
 *
 * A general speaker-verification model was tried first and was not discriminative enough: it put
 * two unmistakably different speakers in one cluster. This one is trained for exactly this job.
 */
export const EMBEDDING_MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM";

const SAMPLE_RATE = 16000;

/** Stretches shorter than this do not carry enough voice to identify reliably. */
const MIN_EMBED_SECONDS = 0.9;

/**
 * How different two voices have to sound to count as two people, as cosine distance.
 *
 * Measured, not guessed. On four-second slices of two known speakers:
 *
 *     same voice        0.30, 0.49
 *     different voices  0.74, 0.80, 0.81
 *
 * So the line belongs between about 0.5 and 0.7, and 0.6 sits in the middle of that gap with room
 * either side. An earlier guess of 0.42 was below the same-voice spread, which split one person
 * into seven — the failure looked like a broken model and was arithmetic.
 *
 * Erring high is the kinder failure: a missed speaker change reads as a long turn, a false one
 * reads as nonsense.
 */
const SPLIT_DISTANCE = 0.6;

/** Nobody is running a sixty-person panel through this, and a runaway cluster count is a bug. */
const MAX_SPEAKERS = 12;

export interface SpeakerTurn {
  speaker: number;
  start: number;
  end: number;
  confidence: number;
}

type Segmenter = {
  model: Awaited<ReturnType<typeof AutoModelForAudioFrameClassification.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
};

type Embedder = {
  model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>;
  processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>;
};

let segmenter: Segmenter | null = null;
let embedder: Embedder | null = null;

export async function loadDiarizer(): Promise<void> {
  if (!segmenter) {
    const [model, processor] = await Promise.all([
      AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL, { dtype: "fp32" }),
      AutoProcessor.from_pretrained(SEGMENTATION_MODEL),
    ]);
    segmenter = { model, processor };
  }
  if (!embedder) {
    const [model, processor] = await Promise.all([
      // Full precision: the model is small, and quantising an embedding model costs exactly the
      // discrimination this step exists for.
      AutoModel.from_pretrained(EMBEDDING_MODEL, { dtype: "fp32" }),
      AutoProcessor.from_pretrained(EMBEDDING_MODEL),
    ]);
    embedder = { model, processor };
  }
}

/** Where the voice changes, with numbering that only holds locally. */
async function segment(audio: Float32Array): Promise<{ start: number; end: number; local: number; confidence: number }[]> {
  await loadDiarizer();
  const { model, processor } = segmenter!;

  const inputs = await (processor as unknown as (a: Float32Array) => Promise<Record<string, unknown>>)(audio);
  const { logits } = (await (model as unknown as (i: unknown) => Promise<{ logits: unknown }>)(inputs)) as {
    logits: unknown;
  };
  const post = (
    processor as unknown as {
      post_process_speaker_diarization: (
        l: unknown,
        n: number,
      ) => { id: number; start: number; end: number; confidence: number }[][];
    }
  ).post_process_speaker_diarization(logits, audio.length);

  // The classes are a powerset: 0 is nobody, the next few are single voices, the rest are
  // combinations. Only the single-voice stretches can be attributed, so the others are dropped
  // and the words inside them inherit a neighbour's speaker later.
  const out: { start: number; end: number; local: number; confidence: number }[] = [];
  for (const t of post[0] ?? []) {
    if (t.id <= 0) continue;
    const local = t.id - 1;
    const last = out[out.length - 1];
    if (last && last.local === local && t.start - last.end < 0.25) {
      last.end = t.end;
      last.confidence = Math.max(last.confidence, t.confidence);
    } else {
      out.push({ start: t.start, end: t.end, local, confidence: t.confidence });
    }
  }
  return out;
}

/** A vector describing the voice in one stretch of audio. */
async function embed(audio: Float32Array, start: number, end: number): Promise<Float32Array | null> {
  const { model, processor } = embedder!;
  const from = Math.max(0, Math.floor(start * SAMPLE_RATE));
  const to = Math.min(audio.length, Math.ceil(end * SAMPLE_RATE));
  if (to - from < MIN_EMBED_SECONDS * SAMPLE_RATE) return null;

  // Long turns are trimmed: a few seconds identifies a voice, and the rest is just slower.
  const slice = audio.subarray(from, Math.min(to, from + 8 * SAMPLE_RATE));
  try {
    const inputs = await (processor as unknown as (a: Float32Array) => Promise<Record<string, unknown>>)(slice);
    const output = (await (model as unknown as (i: unknown) => Promise<Record<string, Tensorish>>)(
      inputs,
    )) as Record<string, Tensorish | undefined>;

    // wespeaker calls the voice vector `last_hidden_state`; x-vector models call it `embeddings`.
    // Taking either keeps this working if the model is swapped.
    const tensor = output.last_hidden_state ?? output.embeddings;
    if (!tensor?.data) {
      // Swallowing this is what hid a broken embedding step once already. If the shape ever
      // changes, it should be loud.
      console.warn("Speaker embedding produced nothing", Object.keys(output));
      return null;
    }
    return pool(tensor);
  } catch (err) {
    console.warn("Speaker embedding failed", err);
    return null;
  }
}

interface Tensorish {
  data: Float32Array;
  dims?: number[];
}

/**
 * Reduces whatever the model returned to one vector per voice.
 *
 * Some of these models hand back a pooled embedding already, shaped [1, D]. Others hand back a
 * hidden state per frame, shaped [1, frames, D], and those have to be averaged — comparing them
 * raw means comparing sequences of different lengths, which produces distances that look like
 * numbers and mean nothing. That mistake shows up as every turn becoming its own speaker.
 *
 * The result is unit length, so cosine distance is the only thing that matters afterwards.
 */
function pool(tensor: Tensorish): Float32Array {
  const dims = tensor.dims ?? [];
  let vector: Float32Array;

  if (dims.length === 3) {
    const [, frames, depth] = dims;
    vector = new Float32Array(depth);
    for (let f = 0; f < frames; f++) {
      for (let d = 0; d < depth; d++) vector[d] += tensor.data[f * depth + d];
    }
    for (let d = 0; d < depth; d++) vector[d] /= frames;
  } else {
    vector = new Float32Array(tensor.data);
  }

  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 1 : 1 - dot / denom;
}

/**
 * Agglomerative clustering, average linkage.
 *
 * Repeatedly joins the two closest clusters until the closest pair is further apart than the
 * threshold. Slow in theory, irrelevant in practice: the number of turns in a recording is in the
 * hundreds, not the millions.
 */
function cluster(vectors: Float32Array[]): number[] {
  const groups = vectors.map((_, i) => [i]);
  const assignment = vectors.map((_, i) => i);

  const distanceBetween = (a: number[], b: number[]) => {
    let total = 0;
    for (const i of a) for (const j of b) total += cosineDistance(vectors[i], vectors[j]);
    return total / (a.length * b.length);
  };

  while (groups.length > 1) {
    let bestA = -1;
    let bestB = -1;
    let best = Infinity;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const d = distanceBetween(groups[a], groups[b]);
        if (d < best) {
          best = d;
          bestA = a;
          bestB = b;
        }
      }
    }
    if (best > SPLIT_DISTANCE && groups.length <= MAX_SPEAKERS) break;
    if (bestA < 0) break;
    groups[bestA] = groups[bestA].concat(groups[bestB]);
    groups.splice(bestB, 1);
  }

  groups.forEach((members, id) => members.forEach((i) => (assignment[i] = id)));
  return assignment;
}

/**
 * Who is speaking, across the whole recording.
 *
 * Returns an empty list when it cannot tell — one voice, or too little to go on — and the caller
 * treats that as a single-speaker transcript rather than guessing.
 */
export async function diarize(audio: Float32Array): Promise<SpeakerTurn[]> {
  const local = await segment(audio);
  if (local.length < 2) return [];

  const vectors: Float32Array[] = [];
  const embedded: number[] = [];
  for (let i = 0; i < local.length; i++) {
    const v = await embed(audio, local[i].start, local[i].end);
    if (v) {
      vectors.push(v);
      embedded.push(i);
    }
  }
  if (vectors.length < 2) return [];

  const assignment = cluster(vectors);
  const speakerOf = new Map<number, number>();
  embedded.forEach((turnIndex, k) => speakerOf.set(turnIndex, assignment[k]));

  // Turns too short to identify take the speaker of the nearest turn that was identified.
  const resolved: SpeakerTurn[] = local.map((t, i) => {
    let speaker = speakerOf.get(i);
    if (speaker === undefined) {
      let nearest = Infinity;
      for (const [index, s] of speakerOf) {
        const d = Math.abs(index - i);
        if (d < nearest) {
          nearest = d;
          speaker = s;
        }
      }
    }
    return { speaker: speaker ?? 0, start: t.start, end: t.end, confidence: t.confidence };
  });

  const found = new Set(resolved.map((t) => t.speaker)).size;

  // Everything turning out to be one voice is a real answer, and not one worth labelling.
  if (found < 2) return [];

  // A speaker for nearly every turn is not a conversation, it is a broken clustering step. Saying
  // nothing is far better than confidently splitting one person into seven.
  if (found > Math.max(2, resolved.length * 0.6)) {
    console.warn(`Diarization found ${found} speakers across ${resolved.length} turns; ignoring it.`);
    return [];
  }

  return tidy(resolved);
}

/** Turns shorter than this are not long enough to be a turn, only an interruption. */
const ISOLATED_SECONDS = 2.5;

/**
 * Smooths the result into turns a person would recognise.
 *
 * Two passes. A brief turn sitting between two stretches of the same other speaker is almost
 * always that speaker — one drawn-out or unusual word whose voice print wandered — so it is given
 * back. Then neighbours with the same speaker are joined, so the result is turns rather than
 * fragments.
 *
 * Without the first pass, a single word can appear as a whole extra person in the transcript.
 */
function tidy(turns: SpeakerTurn[]): SpeakerTurn[] {
  const smoothed = turns.map((t) => ({ ...t }));
  for (let i = 1; i < smoothed.length - 1; i++) {
    const before = smoothed[i - 1];
    const after = smoothed[i + 1];
    const brief = smoothed[i].end - smoothed[i].start < ISOLATED_SECONDS;
    if (brief && before.speaker === after.speaker && before.speaker !== smoothed[i].speaker) {
      smoothed[i].speaker = before.speaker;
    }
  }

  const merged: SpeakerTurn[] = [];
  for (const t of smoothed) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === t.speaker && t.start - last.end < 0.75) last.end = t.end;
    else merged.push({ ...t });
  }
  return merged;
}

/**
 * Gives each word a speaker, by whichever turn it overlaps most.
 *
 * A word landing in silence or crosstalk takes the speaker of the word before it, because a turn
 * that changes for one word and changes straight back is almost always wrong.
 */
export function assignSpeakers<T extends { start: number; end: number }>(
  words: T[],
  turns: SpeakerTurn[],
): (T & { speaker?: number })[] {
  if (!turns.length) return words;

  let at = 0;
  let previous: number | undefined;

  return words.map((word) => {
    while (at < turns.length - 1 && turns[at].end < word.start) at++;

    let best: number | undefined;
    let bestOverlap = 0;
    for (let i = at; i < turns.length && turns[i].start < word.end; i++) {
      const overlap = Math.min(word.end, turns[i].end) - Math.max(word.start, turns[i].start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = turns[i].speaker;
      }
    }

    const speaker = best ?? previous;
    previous = speaker;
    return { ...word, speaker };
  });
}
