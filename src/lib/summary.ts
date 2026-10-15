/**
 * A summary of a whole recording, built from the recording.
 *
 * There is no model writing prose here. The sentences below were all actually said: the ones that
 * carry the most of what the conversation is about, spread across its length and de-duplicated so
 * five lines about one subject do not crowd out the rest. That is the honest trade for running on
 * this computer with no key and no cost — it cannot paraphrase, so it quotes.
 */

import { STOPWORDS, WEAK_LABEL_WORDS, tokenize } from "./moments";
import { buildUnits, speakerTalkTime, type Unit } from "./transcript";
import type { Transcript } from "./types";

export interface SummaryPoint {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Summary {
  /** Length, voices and what it is about, in one line. */
  lead: string;
  /** The handful of subjects the recording keeps returning to. */
  subjects: string[];
  /** Representative sentences, in the order they were said. */
  points: SummaryPoint[];
  words: number;
  speakers: { name: string; seconds: number }[];
}

/** Sentences that lean on what came before are useless out of context. */
const BACKREF = /^(they|it|that|this|those|these|he|she|sure|exactly|fair|right|yes|yeah|no|so|and|but|well|same|which|because)\b/i;
/** Housekeeping: introductions, sponsor reads, sign-offs. */
const HOUSEKEEPING =
  /\b(subscribe|sponsor(ed)?|brought to you by|link in (the )?(description|show notes)|welcome (back|to the)|thanks (so much )?for (having|joining|coming|listening)|rate and review|patreon|promo code)\b/i;

const stem = (w: string) => (w.length > 5 && /(ing|ers|ed|es|s)$/.test(w) ? w.replace(/(ing|ers|ed|es|s)$/, "") : w);

/** How often each term shows up across sentences, so common words count for less. */
function termWeights(tokens: string[][]) {
  const df = new Map<string, number>();
  tokens.forEach((list) => {
    for (const t of new Set(list)) df.set(t, (df.get(t) ?? 0) + 1);
  });
  const total = Math.max(1, tokens.length);
  return (term: string) => Math.log(1 + total / (1 + (df.get(term) ?? 0)));
}

/** Two-word phrases beat single words as subject labels: "cold chain", not "chain". */
function subjectsOf(units: Unit[], tokens: string[][], weight: (t: string) => number, skip: Set<string>, n = 4): string[] {
  const score = new Map<string, number>();
  const seen = new Map<string, string>();
  const spread = new Map<string, Set<number>>();
  const mark = (key: string, i: number) => {
    if (!spread.has(key)) spread.set(key, new Set());
    spread.get(key)!.add(i);
  };
  units.forEach((u, i) => {
    // Keep the original casing alongside: a proper noun should read "Priya", not "priya".
    const cased = u.text.replace(/[^\p{L}\p{N}'\s-]/gu, " ").split(/\s+/).filter(Boolean);
    const raw = cased.map((w) => w.toLowerCase());
    for (let k = 0; k < raw.length - 1; k++) {
      const a = raw[k];
      const b = raw[k + 1];
      if (STOPWORDS.has(a) || STOPWORDS.has(b) || a.length < 4 || b.length < 4) continue;
      // "dwell time" is a subject; "hardest part" is a turn of phrase. The leading word decides.
      if (skip.has(a) || skip.has(b) || WEAK_LABEL_WORDS.has(a) || WEAK_LABEL_WORDS.has(stem(a))) continue;
      const key = `${stem(a)} ${stem(b)}`;
      // A phrase says far more than either of its words, so it is worth several of them.
      score.set(key, (score.get(key) ?? 0) + 4);
      mark(key, i);
      if (!seen.has(key)) seen.set(key, `${cased[k]} ${cased[k + 1]}`.toLowerCase() === `${a} ${b}` ? `${cased[k]} ${cased[k + 1]}` : `${a} ${b}`);
    }
    for (const t of new Set(tokens[i])) {
      // Single words have to earn it: long, meaningful, and said in more than one place.
      if (t.length < 5 || skip.has(t) || WEAK_LABEL_WORDS.has(t)) continue;
      score.set(t, (score.get(t) ?? 0) + weight(t) * 0.5);
      mark(t, i);
      if (!seen.has(t)) seen.set(t, cased.find((w) => stem(w.toLowerCase()) === t) ?? t);
    }
  });
  const ranked = [...score.entries()]
    .filter(([key]) => (spread.get(key)?.size ?? 0) >= 2)
    .sort((a, b) => b[1] - a[1]);
  const out: string[] = [];
  for (const [key] of ranked) {
    const label = seen.get(key) ?? key;
    // Skip a single word already covered by a chosen phrase.
    if (out.some((o) => o.includes(label) || label.includes(o))) continue;
    out.push(label);
    if (out.length >= n) break;
  }
  return out;
}

const fmt = (s: number) => {
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m >= 1 ? `${m} minutes` : `${Math.round(s)} seconds`;
};

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function summarize(t: Transcript | null, duration = 0, count = 6): Summary | null {
  const units = buildUnits(t);
  if (!t || units.length < 3) return null;

  const tokens = units.map((u) => tokenize(u.text).map(stem));
  const weight = termWeights(tokens);
  const total = duration || units[units.length - 1].end;
  const words = units.reduce((n, u) => n + u.text.split(/\s+/).length, 0);

  const base = units.map((u, i) => {
    const uniq = new Set(tokens[i]);
    if (uniq.size < 3) return 0;
    // Average weight, so a long sentence does not win by length alone.
    let score = [...uniq].reduce((n, term) => n + weight(term), 0) / Math.sqrt(uniq.size);
    const wordCount = u.text.split(/\s+/).length;
    if (wordCount < 8) score *= 0.4;
    if (wordCount > 60) score *= 0.75;
    if (BACKREF.test(u.text)) score *= 0.55;
    if (HOUSEKEEPING.test(u.text)) score *= 0.15;
    if (u.text.trim().endsWith("?")) score *= 0.5;
    // The opening and closing minute are usually greetings and goodbyes.
    if (u.start < total * 0.02 || u.end > total * 0.98) score *= 0.5;
    return score;
  });

  // Greedy pick, penalising sentences that repeat a chosen one's vocabulary or sit next to it.
  const picked: number[] = [];
  const used = new Set<string>();
  const slot = total / Math.max(1, count);
  for (let round = 0; round < count; round++) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < units.length; i++) {
      if (base[i] <= 0 || picked.includes(i)) continue;
      const fresh = tokens[i].filter((term) => !used.has(term)).length / Math.max(1, new Set(tokens[i]).size);
      if (fresh < 0.45) continue;
      const near = picked.some((p) => Math.abs(units[p].start - units[i].start) < slot * 0.6);
      const score = base[i] * (0.55 + 0.45 * fresh) * (near ? 0.55 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    picked.push(best);
    for (const term of tokens[best]) used.add(term);
  }

  const talk = speakerTalkTime(t);
  const names = t.speakers.map((s) => ({ name: s.name, seconds: talk.get(s.id) ?? talk.get(s.name) ?? 0 }));
  names.sort((a, b) => b.seconds - a.seconds);

  const skip = new Set<string>();
  for (const sp of t.speakers) for (const part of sp.name.toLowerCase().split(/\s+/)) if (part) skip.add(stem(part));
  const subjects = subjectsOf(units, tokens, weight, skip);
  const voices = t.diarized && names.length > 1 ? `${names.length} voices` : "one voice";
  const lead = `${fmt(total)}, ${voices}${subjects.length ? `, mostly about ${list(subjects.slice(0, 3))}` : ""}.`;

  return {
    lead,
    subjects,
    words,
    speakers: names,
    points: picked
      .sort((a, b) => a - b)
      .map((i) => ({ start: units[i].start, end: units[i].end, speaker: units[i].speaker, text: units[i].text })),
  };
}
