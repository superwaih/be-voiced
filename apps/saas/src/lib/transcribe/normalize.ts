/**
 * Turning a list of timed words into a transcript people can read.
 *
 * Whisper gives words, not turns. Splitting them into paragraphs is what makes a transcript
 * readable, and where to split is a judgement: a change of speaker, a long pause, or a finished
 * sentence followed by a shortish one. The thresholds here are the desktop app's, which have been
 * read against real recordings.
 *
 * Timings are made monotonic first. Models occasionally emit words that overlap or have no length
 * at all, and everything downstream — the playback highlight, snapping a clip to a word — assumes
 * they run forwards.
 */

import type { Segment, Speaker, Transcript, Word } from "@/lib/engine/types";
import type { RawWord } from "./protocol";

const endsSentence = (text: string) => /[.?!]["'”’)\]]*$/.test(text);

function makeSegment(index: number, speaker: string, words: Word[]): Segment {
  return {
    id: `s${index}`,
    speaker,
    start: words[0].start,
    end: words[words.length - 1].end,
    words,
  };
}

export function normalize(model: string, language: string | null, raw: RawWord[], engine: "whisper" | "deepgram" = "whisper"): Transcript {
  const words = raw
    .filter((w) => w.text.trim().length > 0)
    .sort((a, b) => a.start - b.start)
    .map((w) => ({ ...w }));

  let lastEnd = 0;
  for (const w of words) {
    if (w.start < lastEnd) w.start = lastEnd;
    if (w.end <= w.start) w.end = w.start + 0.08;
    lastEnd = Math.max(lastEnd, Math.max(w.start, w.end - 0.02));
  }

  // Speakers are numbered by when they first talk, so "Speaker 1" is whoever opens the recording
  // rather than whichever index the model happened to use.
  const order: number[] = [];
  for (const w of words) {
    const s = w.speaker ?? 0;
    if (!order.includes(s)) order.push(s);
  }
  const diarized = order.length > 1;

  const segments: Segment[] = [];
  let current: Word[] = [];
  let currentSpeaker = words[0]?.speaker ?? 0;

  for (const w of words) {
    const speaker = w.speaker ?? 0;
    const word: Word = { text: w.text.trim(), start: w.start, end: w.end };

    if (current.length) {
      const last = current[current.length - 1];
      const gap = word.start - last.end;
      const done = endsSentence(last.text);
      const split =
        speaker !== currentSpeaker ||
        gap > 2.5 ||
        (done && (current.length >= 90 || gap > 1.2)) ||
        current.length >= 220;
      if (split) {
        segments.push(makeSegment(segments.length, `S${currentSpeaker}`, current));
        current = [];
        currentSpeaker = speaker;
      }
    } else {
      currentSpeaker = speaker;
    }
    current.push(word);
  }
  if (current.length) segments.push(makeSegment(segments.length, `S${currentSpeaker}`, current));

  const speakers: Speaker[] = order.map((raw, i) => ({ id: `S${raw}`, name: `Speaker ${i + 1}` }));
  if (!speakers.length) speakers.push({ id: "S0", name: "Speaker 1" });

  return {
    engine,
    model,
    language,
    diarized,
    createdAt: new Date().toISOString(),
    speakers,
    segments,
  };
}
