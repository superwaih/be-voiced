import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, modelMarksSpeakers, threads, whisperCli, whisperModel } from "./config";
import { runLines } from "./run";

/**
 * Whisper on the server, through whisper.cpp — the same engine the desktop app uses, and the same
 * invocation, so a transcript made here and one made there agree.
 *
 * Two steps. ffmpeg turns whatever was uploaded into the 16 kHz mono WAV whisper.cpp expects, and
 * whisper.cpp writes a JSON file with a token per word. The token offsets are what give word-level
 * timings, which this app needs everywhere: the transcript follows playback word by word, captions
 * highlight the word being said, and clips snap to word boundaries.
 */

export interface ServerWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
}

/** Tokens like `[_BEG_]` are whisper.cpp's own markers, not speech. */
const isSpecial = (token: string) => {
  const t = token.trim();
  return t.startsWith("[_") && t.endsWith("]");
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);

/** ffmpeg reports `out_time_ms=…` on its progress stream; that is how far through the file it is. */
function progressSeconds(line: string): number | null {
  const match = /out_time_ms=(\d+)/.exec(line);
  return match ? Number(match[1]) / 1_000_000 : null;
}

export async function toWav(
  input: string,
  output: string,
  duration: number,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  await runLines(
    ffmpeg(),
    [
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      input,
      "-vn",
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      "-progress",
      "pipe:1",
      output,
    ],
    (line: string) => {
      const at = progressSeconds(line);
      if (at !== null && duration > 0) onProgress(Math.min(1, at / duration));
    },
    signal,
  );
}

export async function transcribeWav(
  wav: string,
  language: string,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ words: ServerWord[]; language: string | null; diarized: boolean }> {
  const base = wav.replace(/\.wav$/i, "");
  const model = whisperModel();
  const tdrz = modelMarksSpeakers();

  const args = [
    "-m",
    model,
    "-f",
    wav,
    "-l",
    language === "auto" ? "auto" : language,
    "-t",
    String(threads()),
    "-oj",
    "-ojf",
    "-of",
    base,
    "-pp",
  ];
  // tinydiarize models are trained to mark where the speaker changes.
  if (tdrz) args.push("-tdrz");

  await runLines(
    whisperCli(),
    args,
    (line: string) => {
      const at = line.indexOf("progress =");
      if (at < 0) return;
      const digits = line.slice(at + 10).replace(/[^\d]/g, "");
      const percent = Number(digits);
      if (Number.isFinite(percent)) onProgress(Math.min(1, Math.max(0, percent / 100)));
    },
    signal,
  );

  const jsonPath = `${base}.json`;
  let raw: string;
  try {
    raw = await readFile(jsonPath, "utf8");
  } catch {
    throw new Error("whisper.cpp finished without writing a transcript.");
  }
  await rm(jsonPath, { force: true });

  const json = JSON.parse(raw) as {
    result?: { language?: string };
    transcription?: {
      offsets?: { from?: number; to?: number };
      speaker_turn_next?: boolean;
      tokens?: { text?: string; offsets?: { from?: number; to?: number }; p?: number }[];
    }[];
  };

  const words: ServerWord[] = [];
  let speaker = 0;
  let diarized = false;

  for (const segment of json.transcription ?? []) {
    const segFrom = (segment.offsets?.from ?? 0) / 1000;
    const segTo = (segment.offsets?.to ?? 0) / 1000;

    let current: ServerWord | null = null;
    let probabilities: number[] = [];

    for (const token of segment.tokens ?? []) {
      const text = token.text ?? "";
      if (!text || isSpecial(text)) continue;

      const from = (token.offsets?.from ?? segFrom * 1000) / 1000;
      const to = (token.offsets?.to ?? segTo * 1000) / 1000;

      // whisper.cpp emits sub-word tokens; a leading space is what starts a new word.
      if (text.startsWith(" ") || !current) {
        if (current) {
          current.confidence = mean(probabilities);
          words.push(current);
        }
        probabilities = [];
        current = { text: text.trim(), start: from, end: to, speaker };
      } else {
        current.text += text;
        current.end = Math.max(current.end, to);
      }
      if (typeof token.p === "number") probabilities.push(token.p);
    }

    if (current) {
      current.confidence = mean(probabilities);
      words.push(current);
    }

    // The model says "the speaker changes after this segment", so the next one is someone else.
    if (segment.speaker_turn_next) {
      speaker = speaker === 0 ? 1 : 0;
      diarized = true;
    }
  }

  return { words, language: json.result?.language ?? null, diarized };
}

export const wavPathFor = (dir: string, id: string) => join(dir, `${id}.wav`);
