import type { Segment, Transcript, Word } from "./types";

export interface FlatWord extends Word {
  /** Global index across the transcript. */
  i: number;
  seg: number;
}

export function flattenWords(t: Transcript | null): FlatWord[] {
  if (!t) return [];
  const out: FlatWord[] = [];
  t.segments.forEach((s, seg) => {
    for (const w of s.words) out.push({ ...w, i: out.length, seg });
  });
  return out;
}

/** Index of the word being spoken at time t (last word that started at or before t), or -1. */
export function wordAt(words: { start: number; end: number }[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found >= 0 && t > words[found].end + 1.2) return -1;
  return found;
}

export const segmentText = (s: Segment) => s.words.map((w) => w.text).join(" ");

export const endsSentence = (text: string) => /[.?!]["'”’)\]]*$/.test(text);

export interface Unit {
  start: number;
  end: number;
  speaker: string;
  speakerId: string;
  text: string;
  firstWord: number;
  lastWord: number;
}

/** Sentence-level units. Clip boundaries snap to these so nobody gets cut mid-sentence. */
export function buildUnits(t: Transcript | null): Unit[] {
  if (!t) return [];
  const names = new Map(t.speakers.map((s) => [s.id, s.name]));
  const units: Unit[] = [];
  let index = 0;
  for (const seg of t.segments) {
    let buf: Word[] = [];
    let first = index;
    const flush = () => {
      if (!buf.length) return;
      units.push({
        start: buf[0].start,
        end: buf[buf.length - 1].end,
        speaker: names.get(seg.speaker) ?? seg.speaker,
        speakerId: seg.speaker,
        text: buf.map((w) => w.text).join(" "),
        firstWord: first,
        lastWord: first + buf.length - 1,
      });
      first += buf.length;
      buf = [];
    };
    for (const w of seg.words) {
      buf.push(w);
      index++;
      const long = buf.length >= 45 && /[,;:]$/.test(w.text);
      if (endsSentence(w.text) || long || buf.length >= 80) flush();
    }
    flush();
  }
  return units;
}

export function unitIndexAt(units: Unit[], t: number): number {
  const i = units.findIndex((u) => u.end > t + 0.01);
  return i === -1 ? units.length - 1 : i;
}

/** Expand or shrink a range by whole sentences. */
export function nudgeBySentence(units: Unit[], start: number, end: number, edge: "start" | "end", dir: -1 | 1) {
  if (!units.length) return { start, end };
  const si = unitIndexAt(units, start + 0.05);
  const ei = unitIndexAt(units, Math.max(start, end - 0.05));
  if (edge === "start") {
    const ni = Math.min(Math.max(0, si + dir), ei);
    return { start: units[ni].start, end };
  }
  const ni = Math.max(Math.min(units.length - 1, ei + dir), si);
  return { start, end: units[ni].end };
}

/** Snap a free range to whole sentences. */
export function snapToSentences(units: Unit[], start: number, end: number) {
  if (!units.length) return { start, end };
  const si = unitIndexAt(units, start + 0.05);
  const ei = unitIndexAt(units, Math.max(start, end - 0.05));
  return { start: units[si].start, end: units[Math.max(si, ei)].end };
}

export function snapToWord(words: Word[], t: number, edge: "start" | "end"): number {
  if (!words.length) return t;
  let best = edge === "start" ? words[0].start : words[0].end;
  let bestDist = Infinity;
  for (const w of words) {
    const v = edge === "start" ? w.start : w.end;
    const d = Math.abs(v - t);
    if (d < bestDist) {
      bestDist = d;
      best = v;
    }
  }
  return bestDist < 0.6 ? best : t;
}

export function wordsInRange(words: FlatWord[], start: number, end: number): FlatWord[] {
  return words.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.08);
}

// ---------------------------------------------------------------------------------------------
// Manual edits keep word timings. Unchanged words keep their exact times (LCS alignment); new or
// changed words are spread across the time left by the words they replaced.
// ---------------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");

export function realignSegment(seg: Segment, newText: string): Segment {
  const tokens = newText.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const old = seg.words;
  if (!tokens.length) return { ...seg, words: [] };

  const n = old.length;
  const m = tokens.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = norm(old[i].text) === norm(tokens[j]) && norm(tokens[j]) !== ""
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(old[i].text) === norm(tokens[j]) && norm(tokens[j]) !== "") {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }

  const words: Word[] = new Array(m);
  for (const [oi, nj] of pairs) words[nj] = { ...old[oi], text: tokens[nj] };

  const anchors: [number, number][] = [[-1, -1], ...pairs, [n, m]];
  for (let k = 0; k < anchors.length - 1; k++) {
    const [oa, na] = anchors[k];
    const [ob, nb] = anchors[k + 1];
    const count = nb - na - 1;
    if (count <= 0) continue;
    let from = oa >= 0 ? old[oa].end : seg.start;
    let to = ob < n ? old[ob].start : seg.end;
    if (to - from < 0.12 * count) {
      // No room between anchors: borrow a little from both neighbours.
      const mid = (from + to) / 2;
      from = mid - 0.06 * count;
      to = mid + 0.06 * count;
    }
    const slice = tokens.slice(na + 1, nb);
    const weights = slice.map((t) => Math.max(1, t.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let cursor = from;
    slice.forEach((text, idx) => {
      const span = ((to - from) * weights[idx]) / total;
      words[na + 1 + idx] = { text, start: cursor, end: cursor + span * 0.92 };
      cursor += span;
    });
  }
  return {
    ...seg,
    words,
    start: Math.min(seg.start, words[0].start),
    end: Math.max(seg.end, words[words.length - 1].end),
  };
}

export interface SearchHit {
  seg: number;
  firstWord: number;
  lastWord: number;
}

/** Case-insensitive phrase search across word boundaries. Returns global word ranges. */
export function searchTranscript(words: FlatWord[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  if (!q.length) return [];
  const hits: SearchHit[] = [];
  const normed = words.map((w) => norm(w.text));
  for (let i = 0; i < words.length; i++) {
    if (q.length === 1) {
      if (normed[i].includes(q[0])) hits.push({ seg: words[i].seg, firstWord: i, lastWord: i });
      continue;
    }
    let ok = true;
    for (let k = 0; k < q.length; k++) {
      const w = normed[i + k];
      if (w === undefined) {
        ok = false;
        break;
      }
      const matches = k === 0 ? w.endsWith(q[k]) : k === q.length - 1 ? w.startsWith(q[k]) : w === q[k];
      if (!matches) {
        ok = false;
        break;
      }
    }
    if (ok) hits.push({ seg: words[i].seg, firstWord: i, lastWord: i + q.length - 1 });
  }
  return hits;
}

export function wordCount(t: Transcript | null): number {
  return t ? t.segments.reduce((n, s) => n + s.words.length, 0) : 0;
}

export function speakerTalkTime(t: Transcript): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of t.segments) map.set(s.speaker, (map.get(s.speaker) ?? 0) + (s.end - s.start));
  return map;
}

/** Merge adjacent segments that end up with the same speaker after a reassignment. */
export function mergeAdjacent(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const prev = out[out.length - 1];
    if (prev && prev.speaker === s.speaker && s.start - prev.end < 1.5 && prev.words.length + s.words.length < 220) {
      out[out.length - 1] = { ...prev, end: s.end, words: [...prev.words, ...s.words] };
    } else out.push(s);
  }
  return out;
}
