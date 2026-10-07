/**
 * Questions about a transcript, answered from the transcript.
 *
 * Answering is pluggable: every engine takes a question plus the recording and returns prose with
 * citations, so the interface never changes when an engine is added. The local engine ships on and
 * needs no key — it retrieves the passages that answer the question and builds the answer out of
 * what was actually said, always with timestamps you can jump to. It never paraphrases beyond the
 * words in the recording, which is the trade for running offline and free.
 */

import { findMoments } from "./moments";
import { STOPWORDS, tokenize } from "./moments";
import { clock } from "./format";
import { buildUnits, speakerTalkTime, type Unit } from "./transcript";
import type { AnswerEngine, Citation, Project, TextIntelligence, Transcript } from "./types";

export interface AskContext {
  project: Project;
  transcript: Transcript;
  intel: TextIntelligence | null;
}

export interface AskResult {
  text: string;
  citations: Citation[];
  engine: AnswerEngine;
  note?: string;
}

export interface Engine {
  id: AnswerEngine;
  label: string;
  /** Why someone would pick it, shown in Settings and the engine picker. */
  description: string;
  available: boolean;
  answer: (question: string, ctx: AskContext) => Promise<AskResult>;
}

// --- Question reading --------------------------------------------------------------------------

type Intent = "moments" | "summary" | "speakers" | "when" | "stats" | "passages";

const INTENT_PATTERNS: [Intent, RegExp][] = [
  ["moments", /\b(best|top|highlight|highlights|moments?|clips?|worth (watching|sharing|posting)|most interesting)\b/i],
  ["summary", /\b(summar\w*|tl;?dr|overview|gist|recap|what(?:'s| is) (?:this|it) about|main (?:points|ideas|takeaways)|key (?:points|takeaways)|takeaways)\b/i],
  ["speakers", /\b(who(?:'s| is| are| was| were)? (?:speaking|talking|on (?:this|the)|in (?:this|the))|speakers?|how many (?:people|voices|speakers))\b/i],
  ["when", /\b(when (?:did|do|does|was|is|were)|at what point|what time|timestamps?)\b/i],
  ["stats", /\b(how long|how many words|what language|which engine|how many speakers)\b/i],
];

function readIntent(q: string): Intent {
  for (const [intent, re] of INTENT_PATTERNS) if (re.test(q)) return intent;
  return "passages";
}

/** Loose stem so "founders" matches "founder" and "tokenized" matches "tokenize". */
function stem(word: string) {
  let w = word;
  for (const suffix of ["'s", "ing", "ers", "ed", "es", "s"]) {
    if (w.length > suffix.length + 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

const QUESTION_WORDS = new Set("what who when where why how which whose did does do is are was were can could should would will tell show give find explain summarize list".split(" "));

function questionTerms(q: string) {
  const raw = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const terms = raw.filter((w) => w.length > 2 && !STOPWORDS.has(w) && !QUESTION_WORDS.has(w));
  const phrases: string[] = [];
  for (let i = 0; i < terms.length - 1; i++) phrases.push(`${stem(terms[i])} ${stem(terms[i + 1])}`);
  return { terms: terms.map(stem), phrases };
}

// --- Retrieval ---------------------------------------------------------------------------------

interface Scored {
  index: number;
  score: number;
}

function unitTokens(units: Unit[]) {
  return units.map((u) => tokenize(u.text).map(stem));
}

/** Rare words count for more, so a question's distinctive word drives the match. */
function idf(tokens: string[][]) {
  const df = new Map<string, number>();
  tokens.forEach((list) => {
    for (const t of new Set(list)) df.set(t, (df.get(t) ?? 0) + 1);
  });
  const total = Math.max(1, tokens.length);
  return (term: string) => Math.log(1 + total / (1 + (df.get(term) ?? 0)));
}

function retrieve(units: Unit[], q: string): Scored[] {
  const { terms, phrases } = questionTerms(q);
  if (!terms.length) return [];
  const tokens = unitTokens(units);
  const weight = idf(tokens);
  const stemmedText = units.map((_, i) => tokens[i].join(" "));

  const base = units.map((_, i) => {
    const set = new Set(tokens[i]);
    let score = 0;
    let hits = 0;
    for (const term of terms) {
      if (set.has(term)) {
        score += weight(term);
        hits++;
      } else if (term.length > 4 && tokens[i].some((t) => t.startsWith(term) || term.startsWith(t))) {
        // Partial stem overlap still counts, at a discount.
        score += weight(term) * 0.5;
        hits++;
      }
    }
    // Covering more of the question matters more than repeating one word.
    if (hits > 1) score *= 1 + 0.25 * (hits - 1);
    for (const phrase of phrases) if (stemmedText[i].includes(phrase)) score += 1.2;
    // Very short units rarely answer anything on their own.
    if (units[i].text.split(/\s+/).length < 6) score *= 0.6;
    return score;
  });

  // Spread a little credit to neighbours so answers come out as passages, not clipped sentences.
  const smoothed = base.map((s, i) => s + 0.35 * (base[i - 1] ?? 0) + 0.35 * (base[i + 1] ?? 0));
  return smoothed
    .map((score, index) => ({ index, score }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

const MAX_PASSAGE = 45;

/** Grow a hit into a passage that starts and ends on sentence boundaries. */
function passageAt(units: Unit[], index: number): { start: number; end: number; first: number; last: number } {
  let first = index;
  let last = index;
  const fits = () => units[last].end - units[first].start <= MAX_PASSAGE;
  // One sentence of lead-in reads better than starting mid-thought.
  if (first > 0 && units[first].speaker === units[first - 1].speaker) first--;
  while (last + 1 < units.length && units[last + 1].start - units[last].end < 1.2 && fits()) last++;
  while (units[last].end - units[first].start > MAX_PASSAGE && last > first) last--;
  return { start: units[first].start, end: units[last].end, first, last };
}

function citationsFrom(units: Unit[], hits: Scored[], count: number): Citation[] {
  const out: Citation[] = [];
  const used: { start: number; end: number }[] = [];
  const floor = (hits[0]?.score ?? 0) * 0.45;
  for (const hit of hits) {
    if (hit.score < floor) break;
    if (out.length >= count) break;
    const p = passageAt(units, hit.index);
    if (used.some((u) => p.start < u.end && p.end > u.start)) continue;
    used.push({ start: p.start, end: p.end });
    const span = units.slice(p.first, p.last + 1);
    // Label the passage with whoever says most of it, not whoever happens to start it.
    const byWords = new Map<string, number>();
    for (const u of span) byWords.set(u.speaker, (byWords.get(u.speaker) ?? 0) + u.text.split(/\s+/).length);
    const lead = [...byWords.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? span[0].speaker;
    out.push({
      start: p.start,
      end: p.end,
      speaker: lead,
      text: trimQuote(span.map((u) => u.text).join(" ")),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

// --- Answers -----------------------------------------------------------------------------------

const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

const COUNT_WORDS = ["no", "One", "Two", "Three", "Four", "Five"];
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);

/** Keep the quote readable in the thread; the timestamp is there for the rest. */
function trimQuote(text: string, max = 420) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}...`;
}

function answerPassages(q: string, units: Unit[]): AskResult {
  const hits = retrieve(units, q);
  const citations = citationsFrom(units, hits, 3);
  if (!citations.length) {
    return {
      engine: "local",
      text: "Nothing in this recording matches that. Try the words you expect to hear in the conversation itself.",
      citations: [],
      note: "Answers come from the transcript, so searching for words that were actually spoken works best.",
    };
  }
  const where = list(citations.map((c) => clock(c.start)));
  const lead =
    citations.length === 1
      ? `${citations[0].speaker || "That"} covers it at ${where}.`
      : `${countWord(citations.length)} places where that comes up, at ${where}.`;
  return { engine: "local", text: lead, citations };
}

function answerMoments(ctx: AskContext): AskResult {
  const want = 3;
  const found = ctx.project.clips
    .filter((c) => c.status !== "rejected")
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, want)
    .map((c) => ({ start: c.start, end: c.end, speaker: c.speaker ?? "", title: c.title, summary: c.summary ?? c.why ?? "" }));

  // Asked for three: top up from the finder when the project holds fewer, rather than answering
  // with whatever happens to be stored.
  if (found.length < want) {
    const extra = findMoments(ctx.transcript, {
      count: want - found.length,
      existing: found.map((c) => ({ start: c.start, end: c.end })),
      focus: null,
      intel: ctx.intel,
      duration: ctx.project.source.duration,
    }).highlights.map((h) => ({ start: h.start, end: h.end, speaker: h.speaker, title: h.title, summary: h.why || h.summary }));
    found.push(...extra);
  }

  if (!found.length) return { engine: "local", text: "There is not enough transcript here to pick moments from.", citations: [] };
  found.sort((a, b) => a.start - b.start);
  return {
    engine: "local",
    text: `${countWord(found.length)} ${found.length === 1 ? "moment" : "moments"} worth watching.`,
    citations: found.map((c) => ({ start: c.start, end: c.end, speaker: c.speaker, label: c.title, text: c.summary })),
  };
}

function answerSummary(ctx: AskContext, units: Unit[]): AskResult {
  const topics = ctx.project.topics;
  if (topics.length) {
    return {
      engine: "local",
      text: `The conversation moves through ${topics.length} ${topics.length === 1 ? "topic" : "topics"}.`,
      citations: topics.map((t) => ({
        start: t.ranges[0]?.start ?? 0,
        end: t.ranges[0]?.end ?? 0,
        speaker: "",
        label: t.name,
        text: t.summary,
      })),
    };
  }
  // No analysis yet: take the strongest sentence from each quarter of the recording.
  const duration = ctx.project.source.duration || units[units.length - 1]?.end || 0;
  const quarters: Citation[] = [];
  for (let i = 0; i < 4; i++) {
    const from = (duration / 4) * i;
    const to = (duration / 4) * (i + 1);
    const slice = units.filter((u) => u.start >= from && u.start < to && u.text.split(/\s+/).length > 9);
    const pick = slice.sort((a, b) => tokenize(b.text).length - tokenize(a.text).length)[0];
    if (pick) quarters.push({ start: pick.start, end: pick.end, speaker: pick.speaker, text: pick.text });
  }
  return {
    engine: "local",
    text: "Run Find moments for a proper read of this conversation. Until then, here is the shape of it, a line from each quarter.",
    citations: quarters,
    note: "Topics and summaries get much better once the recording has been analysed.",
  };
}

function answerSpeakers(ctx: AskContext): AskResult {
  const talk = speakerTalkTime(ctx.transcript);
  const names = ctx.transcript.speakers.map((s) => ({ name: s.name, time: talk.get(s.id) ?? talk.get(s.name) ?? 0 }));
  names.sort((a, b) => b.time - a.time);
  const text = ctx.transcript.diarized
    ? `${countWord(names.length)} ${names.length === 1 ? "voice" : "voices"}: ${list(names.map((n) => `${n.name} (${clock(n.time)})`))}.`
    : "This transcript was made with Whisper, which does not separate speakers, so everything is under one label. Transcribe again with Deepgram for speaker labels.";
  return { engine: "local", text, citations: [] };
}

function answerStats(ctx: AskContext, units: Unit[]): AskResult {
  const words = units.reduce((n, u) => n + u.text.split(/\s+/).length, 0);
  const t = ctx.transcript;
  return {
    engine: "local",
    text: `${clock(ctx.project.source.duration)} long, about ${words.toLocaleString()} words, transcribed with ${
      t.engine === "deepgram" ? "Deepgram" : "Whisper"
    } (${t.model})${t.language ? ` in ${t.language}` : ""}.`,
    citations: [],
  };
}

function answerWhen(q: string, units: Unit[]): AskResult {
  const hits = retrieve(units, q);
  const citations = citationsFrom(units, hits, 2);
  if (!citations.length) return answerPassages(q, units);
  return {
    engine: "local",
    text: `First at ${clock(citations[0].start)}${citations.length > 1 ? `, again at ${clock(citations[1].start)}` : ""}.`,
    citations,
  };
}

export const localEngine: Engine = {
  id: "local",
  label: "On this computer",
  description: "Finds and quotes the parts of the transcript that answer the question. Free, offline, never paraphrases.",
  available: true,
  async answer(question, ctx) {
    const units = buildUnits(ctx.transcript);
    if (!units.length) return { engine: "local", text: "This recording has no transcript yet.", citations: [] };
    switch (readIntent(question)) {
      case "moments":
        return answerMoments(ctx);
      case "summary":
        return answerSummary(ctx, units);
      case "speakers":
        return answerSpeakers(ctx);
      case "stats":
        return answerStats(ctx, units);
      case "when":
        return answerWhen(question, units);
      default:
        return answerPassages(question, units);
    }
  },
};

/** Engines in preference order. Cloud engines append themselves here when a key is saved. */
export function engines(): Engine[] {
  return [localEngine];
}

export async function ask(question: string, ctx: AskContext, preferred: AnswerEngine = "local"): Promise<AskResult> {
  const all = engines();
  const engine = all.find((e) => e.id === preferred && e.available) ?? all[0];
  const result = await engine.answer(question, ctx);
  return result;
}

/** Starter questions offered when a recording opens, tuned to what the project already has. */
export function suggestedQuestions(project: Project): string[] {
  const out = ["Give me the top three moments", "What is this about?"];
  if ((project.transcript?.speakers.length ?? 0) > 1) out.push("Who is talking?");
  out.push("How long is it?");
  return out;
}
