/**
 * Moment finder. Runs locally on the transcript, so it works offline with Whisper transcripts.
 * When a Deepgram key is saved, Deepgram Text Intelligence adds topics, intents and sentiment,
 * which sharpen scoring and name the topics.
 *
 * The question it tries to answer: if someone could only watch a few minutes of this conversation,
 * which moments would they want? Candidates are whole sentences (never cut mid-thought), usually
 * 30 to 90 seconds, scored on what tends to make a clip worth publishing:
 * strong or contrarian opinions, explanations, advice, predictions, disagreements, stories, humour,
 * statistics, quotable lines and clear answers to questions. Housekeeping, filler and intros are
 * penalised.
 */

import type { AnalyzeResult, HighlightCategory, TextIntelligence, Transcript } from "./types";
import { buildUnits, flattenWords, type Unit } from "./transcript";

type CueCategory = Exclude<HighlightCategory, "quote" | "answer">;

const CUES: { category: CueCategory; weight: number; pattern: RegExp }[] = [
  {
    category: "contrarian",
    weight: 1.7,
    pattern:
      /\b(unpopular|controversial|most people (think|believe|assume|get)|everyone (says|thinks|assumes)|overrated|underrated|it'?s a myth|the opposite|counterintuitive|nobody talks about|people get (this|it) wrong|conventional wisdom)\b/g,
  },
  {
    category: "opinion",
    weight: 1.1,
    pattern:
      /\b(i think|i believe|in my opinion|honestly|frankly|the truth is|to be honest|i'?m convinced|i would argue|i'?d argue|the real (problem|issue|reason)|i strongly)\b/g,
  },
  {
    category: "prediction",
    weight: 1.5,
    pattern:
      /\b(in (the next )?(two|three|five|ten|\d+) years|my prediction|i predict|going to (happen|change|disappear|explode)|will (become|replace|disappear|change|win|lose)|the future (of|is|will)|by 20\d\d|five years from now|ten years from now)\b/g,
  },
  {
    category: "statistic",
    weight: 1.3,
    pattern:
      /(\b\d+(\.\d+)?\s?(%|percent|x\b|times\b|million|billion|thousand|hours|minutes|days|dollars)|\$\d|\b(doubled|tripled|half of|a third|two thirds|nine out of ten|one in (three|four|five|ten)))/g,
  },
  {
    category: "story",
    weight: 1.2,
    pattern: /\b(i remember|one time|when i was|years ago|the first time|true story|let me tell you|back (then|in)|there was this)\b/g,
  },
  {
    category: "insight",
    weight: 1.3,
    pattern:
      /\b(the key (is|was|thing)|the lesson|what i learned|i learned|the secret|the trick|the biggest mistake|if you want to|my advice|the most important|what matters (is|most)|the thing (nobody|no one) tells you)\b/g,
  },
  {
    category: "explanation",
    weight: 1.0,
    pattern: /\b(the reason (is|was|why)|here'?s (why|how|the thing)|what (that|this) means|in other words|the way (it|this) works|think of it (like|as)|for example)\b/g,
  },
  {
    category: "disagreement",
    weight: 1.5,
    pattern: /\b(i disagree|that'?s not (true|right|fair)|i don'?t (agree|buy)|not so sure|push back|devil'?s advocate|with respect|hold on|wait,? no)\b/g,
  },
  {
    category: "funny",
    weight: 1.1,
    pattern: /(\b(laugh(s|ing|ter)?|haha+|hilarious|joking|ridiculous|absurd)\b|\[laughter\]|\(laughs\))/g,
  },
  {
    category: "opinion",
    weight: 0.35,
    pattern: /\b(never|always|nobody|everyone|biggest|worst|best|huge|incredible|insane|crazy|obsessed|terrible|brilliant)\b/g,
  },
];

const HOUSEKEEPING =
  /\b(subscribe|sponsor(ed)?|brought to you by|link in (the )?(description|show notes)|welcome (back|to the)|thanks (so much )?for (having|joining|coming|listening)|before we (start|begin|get into)|let'?s get (started|into it)|where can people find|follow (me|us) on|check out|rate and review|patreon|promo code|housekeeping)\b/g;
const FILLERS = /\b(um+|uh+|erm|hmm|you know|i mean|kind of|sort of|like,)\b/g;
const LEADING_FILLER = /^((so|and|but|yeah|yes|well|okay|ok|right|um+|uh+|like|i mean|you know)[,.]?\s+)+/i;

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each even few for from further get gets getting go going gonna got had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just know let's like lot make me more most much mustn't my myself no nor not now of off on once one only or other ought our ours ourselves out over own people really right said same say says see she she'd she'll she's should shouldn't so some such take than that that's the their theirs them themselves then there there's these they they'd they'll they're they've thing things think this those though through to too two under until up us very want was wasn't way we we'd we'll we're we've well were weren't what what's when when's where where's which while who who's whom why why's will with won't would wouldn't yeah yes you you'd you'll you're you've your yours yourself yourselves okay actually basically kind sort mean guess stuff maybe probably something anything everything someone everybody anyway gotta wanna"
  ).split(" "),
);

/** Words that carry little meaning as topic labels even when frequent. */
const WEAK_LABEL_WORDS = new Set(
  (
    "away along late early goes went come came comes coming find found thanks thank hardest harder hard easy big small good bad great little long short new old first last next year years time times day days week weeks month months minute minutes hour hours part start started starting started end ended ending talk talking talked tell told ask asked question questions answer lot lots kind sort point case fact idea sense look looked looking give gave given feel felt keep kept put puts call called try tried trying work worked working happen happened happens change changed changes back fine sure exactly fair great literally obviously pretty whole able else ever every many less least most much still yet already almost enough quite rather truly across around because since while whether"
  ).split(" "),
);

/** Sentences that need earlier context to make sense make poor titles. */
const BACKREFERENCE = /^(they|it|that|this|those|these|he|she|sure|exactly|fair|right|yes|yeah|no|so|and|but|well|same)\b/i;
/** General, standalone statements read as pull quotes. */
const MAXIM = /^(if you|if your|when you|nobody|no one|everyone|everybody|the best|the worst|the hardest|the biggest|never|always|most people|you can'?t|you have to|there'?s no)\b/i;

const CATEGORY_REASON: Record<HighlightCategory, string> = {
  contrarian: "a contrarian take",
  opinion: "a clearly argued opinion",
  prediction: "a concrete prediction",
  statistic: "a specific number or statistic",
  story: "a story",
  insight: "practical advice",
  explanation: "a clear explanation",
  disagreement: "a real disagreement",
  funny: "a funny exchange",
  quote: "a quotable line",
  answer: "a direct answer to a question",
};

interface UnitFeatures {
  words: number;
  cue: Record<CueCategory, number>;
  fillers: number;
  housekeeping: number;
  question: boolean;
  quote: number;
  sentiment: number;
  intent: number;
  confidence: number;
}

export interface FindOptions {
  count: number;
  existing: { start: number; end: number }[];
  focus: string | null;
  intel: TextIntelligence | null;
  duration: number;
}

const CATEGORIES: CueCategory[] = ["contrarian", "opinion", "prediction", "statistic", "story", "insight", "explanation", "disagreement", "funny"];

function emptyCue(): Record<CueCategory, number> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<CueCategory, number>;
}

const countMatches = (text: string, re: RegExp) => text.match(re)?.length ?? 0;

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Per-unit signal from Deepgram segments, which are expressed in transcript word indexes. */
function intelPerUnit(units: Unit[], intel: TextIntelligence | null) {
  const sentiment = new Float32Array(units.length);
  const intent = new Float32Array(units.length);
  const topic: (string | null)[] = new Array(units.length).fill(null);
  if (!intel) return { sentiment, intent, topic };
  const overlap = (u: Unit, s: { startWord: number; endWord: number }) =>
    Math.max(0, Math.min(u.lastWord, s.endWord) - Math.max(u.firstWord, s.startWord) + 1) / Math.max(1, u.lastWord - u.firstWord + 1);
  units.forEach((u, i) => {
    let sw = 0;
    let ss = 0;
    for (const s of intel.sentiments) {
      const o = overlap(u, s);
      if (o > 0) {
        sw += o;
        ss += o * Math.abs(s.score);
      }
    }
    sentiment[i] = sw ? ss / sw : 0;
    let best = 0;
    for (const s of intel.intents) {
      const o = overlap(u, s);
      if (o > 0 && s.labels.length) intent[i] = Math.max(intent[i], o * Math.max(...s.labels.map((l) => l.confidence)));
    }
    for (const s of intel.topics) {
      const o = overlap(u, s);
      if (o > best && s.labels.length) {
        best = o;
        topic[i] = [...s.labels].sort((a, b) => b.confidence - a.confidence)[0].label;
      }
    }
  });
  return { sentiment, intent, topic };
}

function unitFeatures(units: Unit[], t: Transcript, intel: TextIntelligence | null): UnitFeatures[] {
  const flat = flattenWords(t);
  const signal = intelPerUnit(units, intel);
  return units.map((u, i) => {
    const text = u.text.toLowerCase();
    const cue = emptyCue();
    for (const c of CUES) cue[c.category] += countMatches(text, c.pattern) * c.weight;
    const words = u.lastWord - u.firstWord + 1;
    const strong = countMatches(text, CUES[CUES.length - 1].pattern);
    // Short, declarative and emphatic sentences make the best pull quotes.
    const quote = words >= 5 && words <= 16 && !text.endsWith("?") ? 0.4 + Math.min(0.8, strong * 0.4) : 0;
    let conf = 0;
    let confN = 0;
    for (let w = u.firstWord; w <= u.lastWord; w++) {
      const c = flat[w]?.confidence;
      if (c !== undefined) {
        conf += c;
        confN++;
      }
    }
    return {
      words,
      cue,
      fillers: countMatches(text, FILLERS),
      housekeeping: countMatches(text, HOUSEKEEPING),
      question: /\?["')\]]*$/.test(u.text),
      quote,
      sentiment: signal.sentiment[i],
      intent: signal.intent[i],
      confidence: confN ? conf / confN : 1,
    };
  });
}

interface Candidate {
  i: number;
  j: number;
  start: number;
  end: number;
  score: number;
  reasons: { label: HighlightCategory | "energy" | "topic" | "speaker" | "sentiment" | "focus"; value: number }[];
  category: HighlightCategory;
}

export function findMoments(t: Transcript, opts: FindOptions): AnalyzeResult {
  const units = buildUnits(t);
  if (!units.length) return { model: "", topics: [], highlights: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const feats = unitFeatures(units, t, opts.intel);
  const signal = intelPerUnit(units, opts.intel);

  // Speaking rate baseline so "energy" is relative to this conversation, not an absolute.
  const rates = units.flatMap((u, k) => (u.end - u.start > 2 ? [feats[k].words / (u.end - u.start)] : []));
  const sortedRates = [...rates].sort((a, b) => a - b);
  const medianRate = sortedRates[Math.floor(sortedRates.length / 2)] ?? 2.5;

  // Loose stems so "pricing" matches "price" and "farms" matches "farm".
  const focusTerms = opts.focus ? tokenize(opts.focus).map((w) => w.replace(/(ing|ed|es|s)$/, "").slice(0, Math.max(4, w.length - 3))) : [];
  const duration = opts.duration || units[units.length - 1].end;

  const candidates: Candidate[] = [];
  for (let i = 0; i < units.length; i++) {
    // Starting on a filler fragment or on housekeeping rarely makes a good opening.
    if (feats[i].words < 3 && !feats[i].question) continue;
    for (let j = i; j < units.length; j++) {
      const start = units[i].start;
      const end = units[j].end;
      const len = end - start;
      if (len > 95 && j > i) break;
      if (len < 26) continue;
      const c = scoreWindow(i, j, start, end);
      if (c) candidates.push(c);
      if (len > 95) break;
    }
  }

  function scoreWindow(i: number, j: number, start: number, end: number): Candidate | null {
    const len = end - start;
    const cue = emptyCue();
    let words = 0;
    let fillers = 0;
    let housekeeping = 0;
    let sentiment = 0;
    let intent = 0;
    let conf = 0;
    let bestQuote = 0;
    const speakerTime = new Map<string, number>();
    const topicWords = new Map<string, number>();
    for (let k = i; k <= j; k++) {
      const f = feats[k];
      for (const c of CATEGORIES) cue[c] += f.cue[c];
      words += f.words;
      fillers += f.fillers;
      housekeeping += f.housekeeping;
      sentiment += f.sentiment * f.words;
      intent = Math.max(intent, f.intent);
      conf += f.confidence * f.words;
      bestQuote = Math.max(bestQuote, f.quote);
      speakerTime.set(units[k].speakerId, (speakerTime.get(units[k].speakerId) ?? 0) + (units[k].end - units[k].start));
      const tp = signal.topic[k];
      if (tp) topicWords.set(tp, (topicWords.get(tp) ?? 0) + f.words);
    }
    if (housekeeping > 1) return null;

    const reasons: Candidate["reasons"] = [];
    let score = 0;

    // What is said: capped per category so one repeated phrase cannot dominate.
    for (const c of CATEGORIES) {
      const v = Math.min(cue[c], 3.2);
      if (v > 0) {
        score += v;
        reasons.push({ label: c, value: v });
      }
    }
    if (bestQuote > 0.5) {
      score += bestQuote;
      reasons.push({ label: "quote", value: bestQuote });
    }

    // Structure: a question answered at length by someone else is one of the most reliable clip shapes.
    const prev = units[i - 1];
    const opensWithQuestion = feats[i].question && j > i && units[i + 1].speakerId !== units[i].speakerId;
    const answersPrevQuestion = prev && feats[i - 1].question && prev.speakerId !== units[i].speakerId;
    if (opensWithQuestion) {
      score += 1.4;
      reasons.push({ label: "answer", value: 1.4 });
    } else if (answersPrevQuestion) {
      score += 0.5;
    }
    if (feats[j].question) score -= 1.2;
    if (feats[j].quote > 0.5 || CATEGORIES.some((c) => feats[j].cue[c] > 0)) score += 0.4;

    // Delivery: energy relative to this conversation, and one clear voice.
    const rate = words / Math.max(1, len);
    const energy = Math.max(-1, Math.min(1, (rate / medianRate - 1) * 2.5));
    score += energy * 0.6;
    if (energy > 0.3) reasons.push({ label: "energy", value: energy * 0.6 });
    const dominant = Math.max(...speakerTime.values()) / Math.max(1, len);
    const speakers = speakerTime.size;
    if (dominant > 0.72) {
      score += 0.4;
    } else if (speakers > 1 && cue.disagreement > 0) {
      score += 0.8;
    }

    // Deepgram signals when available.
    if (opts.intel) {
      const s = sentiment / Math.max(1, words);
      score += s * 2.2;
      if (s > 0.35) reasons.push({ label: "sentiment", value: s * 2.2 });
      score += intent * 0.5;
      const topTopic = Math.max(0, ...topicWords.values());
      if (topTopic / Math.max(1, words) > 0.8) {
        score += 0.35;
        reasons.push({ label: "topic", value: 0.35 });
      }
    }

    // Penalties: filler, housekeeping, intros and outros, low confidence transcription.
    score -= Math.min(2, (fillers / Math.max(1, words)) * 18);
    score -= housekeeping * 2;
    if (start < duration * 0.03 || end > duration * 0.97) score -= 1;
    if (conf / Math.max(1, words) < 0.6) score -= 0.6;

    // Length: about 60 seconds is ideal, 30 to 90 is normal.
    const lengthFit = Math.exp(-(((len - 60) / 32) ** 2));
    score = score * (0.55 + 0.45 * lengthFit);
    if (len > 90) score *= 0.8;

    if (focusTerms.length) {
      const text = units.slice(i, j + 1).map((u) => u.text.toLowerCase()).join(" ");
      const hits = focusTerms.filter((term) => text.includes(term)).length;
      if (hits) {
        const v = Math.min(3, hits) * 1.6;
        score += v;
        reasons.push({ label: "focus", value: v });
      }
    }

    const content = reasons.filter((r) => r.label !== "energy" && r.label !== "sentiment" && r.label !== "topic" && r.label !== "focus");
    const category = (content.sort((a, b) => b.value - a.value)[0]?.label ?? "insight") as HighlightCategory;
    return { i, j, start, end, score, reasons, category };
  }

  const overlapsExisting = (c: { start: number; end: number }) => opts.existing.some((r) => c.start < r.end - 1 && c.end > r.start + 1);
  const open = candidates.filter((c) => !overlapsExisting(c)).sort((a, b) => b.score - a.score);
  const top = open[0]?.score ?? 0;
  // The bar is relative to the best remaining moment, and lower when the editor asked for something specific.
  const floor = Math.max(focusTerms.length ? 0.6 : 1.2, top * (focusTerms.length ? 0.25 : 0.38));
  const picked: Candidate[] = [];
  const taken = [...opts.existing];
  for (const c of open) {
    if (picked.length >= opts.count) break;
    // Quality over quantity: stop when the remaining candidates are much weaker than the best.
    if (c.score < floor) break;
    if (taken.some((r) => c.start < r.end - 1 && c.end > r.start + 1)) continue;
    picked.push(c);
    taken.push({ start: c.start, end: c.end });
  }

  const names = new Map(t.speakers.map((s) => [s.id, s.name]));
  const docFreq = buildDocFreq(units);
  const highlights = picked.map((c) => {
    const span = units.slice(c.i, c.j + 1);
    const speakerTime = new Map<string, number>();
    span.forEach((u) => speakerTime.set(u.speakerId, (speakerTime.get(u.speakerId) ?? 0) + (u.end - u.start)));
    const mainSpeaker = [...speakerTime.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const topicCounts = new Map<string, number>();
    for (let k = c.i; k <= c.j; k++) {
      const tp = signal.topic[k];
      if (tp) topicCounts.set(tp, (topicCounts.get(tp) ?? 0) + feats[k].words);
    }
    const topic = [...topicCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? keywords(span, docFreq, units.length, 1)[0] ?? "";
    return {
      title: titleFor(span, feats.slice(c.i, c.j + 1), focusTerms),
      startUnit: c.i,
      endUnit: c.j,
      start: c.start,
      end: c.end,
      speaker: names.get(mainSpeaker) ?? mainSpeaker,
      topic: capitalize(topic),
      category: c.category,
      summary: summaryFor(span, feats.slice(c.i, c.j + 1), names.get(mainSpeaker) ?? "The speaker", c.category),
      why: whyFor(c),
      score: Math.max(1, Math.min(100, Math.round(45 + 54 * (c.score / Math.max(0.001, top))))),
    };
  });

  return {
    model: opts.intel ? "Be Voiced moment finder with Deepgram text intelligence" : "Be Voiced moment finder",
    topics: opts.intel ? topicsFromIntel(units, opts.intel) : topicsFromKeywords(units),
    highlights,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
  };
}

// --- Writing ---------------------------------------------------------------------------------

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function cleanSentence(text: string) {
  let s = text.replace(LEADING_FILLER, "").replace(/\b(um+|uh+)[,]?\s*/gi, "").replace(/\s+/g, " ").trim();
  s = s.replace(/[,;:]+$/, "");
  return capitalize(s);
}

function clamp(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[,;:.]+$/, "")}...`;
}

function titleFor(span: Unit[], feats: UnitFeatures[], focusTerms: string[] = []) {
  // The most quotable sentence becomes the title: cue-bearing, not a question, 5 to 16 words.
  let best = 0;
  let bestScore = -Infinity;
  span.forEach((u, k) => {
    const f = feats[k];
    const cues = CATEGORIES.reduce((n, c) => n + f.cue[c], 0);
    const lengthFit = f.words >= 5 && f.words <= 16 ? 1 : f.words < 5 ? -1.5 : -0.4 - (f.words - 16) * 0.05;
    const clean = cleanSentence(u.text);
    const standalone = (MAXIM.test(clean) ? 1.6 : 0) - (BACKREFERENCE.test(clean) ? 1.4 : 0);
    const lower = u.text.toLowerCase();
    const focus = focusTerms.filter((term) => lower.includes(term)).length * 1.5;
    const s = cues + f.quote * 1.5 + lengthFit + standalone + focus - (f.question ? 1.5 : 0) - f.fillers * 0.3 - k * 0.05;
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  });
  return clamp(cleanSentence(span[best].text).replace(/[.!]+$/, ""), 72);
}

function summaryFor(span: Unit[], feats: UnitFeatures[], speaker: string, category: HighlightCategory) {
  // Quote the sentence that carries the clip's main signal, so the summary matches its label.
  const isQuestion = (u: Unit) => /\?["')\]]*$/.test(u.text);
  const standalone = (u: Unit) => !isQuestion(u) && u.text.split(" ").length >= 6 && !BACKREFERENCE.test(cleanSentence(u.text));
  let opener = span.find(standalone) ?? span.find((u) => !isQuestion(u)) ?? span[0];
  if (category in feats[0].cue) {
    let best = 0;
    span.forEach((u, k) => {
      const v = feats[k].cue[category as CueCategory];
      if (v > best && standalone(u)) {
        best = v;
        opener = u;
      }
    });
  }
  const lead: Record<HighlightCategory, string> = {
    contrarian: `${speaker} pushes back on a common assumption`,
    opinion: `${speaker} makes a clear case`,
    prediction: `${speaker} makes a prediction`,
    statistic: `${speaker} backs a point with numbers`,
    story: `${speaker} tells a story`,
    insight: `${speaker} shares hard-won advice`,
    explanation: `${speaker} explains how it works`,
    disagreement: "The speakers disagree",
    funny: "A light, funny exchange",
    quote: `${speaker} lands a memorable line`,
    answer: `${speaker} answers a direct question`,
  };
  return `${lead[category]}: "${clamp(cleanSentence(opener.text), 110)}"`;
}

function whyFor(c: Candidate) {
  const reasons: string[] = [];
  const seen = new Set<string>();
  for (const r of [...c.reasons].sort((a, b) => b.value - a.value)) {
    const text =
      r.label === "energy"
        ? "energetic delivery"
        : r.label === "sentiment"
          ? "strong feeling behind it"
          : r.label === "topic"
            ? "stays on one topic"
            : r.label === "focus"
              ? "matches what you asked for"
              : r.label === "speaker"
                ? "one clear voice"
                : CATEGORY_REASON[r.label];
    if (seen.has(text)) continue;
    seen.add(text);
    reasons.push(text);
    if (reasons.length === 3) break;
  }
  const len = Math.round(c.end - c.start);
  if (!reasons.length) return `Stands on its own in ${len} seconds without cutting anyone off.`;
  const list = reasons.length === 1 ? reasons[0] : `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}`;
  return `${capitalize(list)}, complete in ${len} seconds.`;
}

// --- Topics ----------------------------------------------------------------------------------

type TopicOut = AnalyzeResult["topics"][number];

function topicsFromIntel(units: Unit[], intel: TextIntelligence): TopicOut[] {
  const unitOfWord = (w: number) => {
    let lo = 0;
    let hi = units.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (units[mid].firstWord <= w) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const groups = new Map<string, { name: string; ranges: TopicOut["ranges"]; coverage: number; first: number; text: string }>();
  for (const seg of intel.topics) {
    const label = [...seg.labels].sort((a, b) => b.confidence - a.confidence)[0];
    if (!label) continue;
    const key = label.label.toLowerCase();
    const su = unitOfWord(seg.startWord);
    const eu = unitOfWord(seg.endWord);
    const range = { startUnit: su, endUnit: eu, start: units[su].start, end: units[eu].end };
    const g = groups.get(key) ?? { name: capitalize(label.label), ranges: [], coverage: 0, first: range.start, text: units[su].text };
    const last = g.ranges[g.ranges.length - 1];
    if (last && range.start - last.end < 20) {
      last.end = Math.max(last.end, range.end);
      last.endUnit = Math.max(last.endUnit, range.endUnit);
    } else g.ranges.push(range);
    g.coverage += range.end - range.start;
    g.first = Math.min(g.first, range.start);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.coverage >= 15 || g.ranges.length > 1)
    .sort((a, b) => b.coverage - a.coverage)
    .slice(0, 10)
    .sort((a, b) => a.first - b.first)
    .map((g) => ({ name: g.name, summary: `First discussed: "${clamp(cleanSentence(g.text), 90)}"`, ranges: g.ranges }));
}

function buildDocFreq(units: Unit[]) {
  const df = new Map<string, number>();
  for (const u of units) for (const w of new Set(contentRuns(u.text).flat().filter(isLabelWord))) df.set(w, (df.get(w) ?? 0) + 1);
  return df;
}

/** Content words in order, with sentence breaks kept so phrases never span two sentences. */
function contentRuns(text: string) {
  return text
    .toLowerCase()
    .split(/[.?!;:,]+/)
    .map((part) =>
      part
        .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
        .split(/\s+/)
        .filter(Boolean),
    );
}

const isLabelWord = (w: string) => w.length > 3 && !STOPWORDS.has(w) && !WEAK_LABEL_WORDS.has(w) && !/^\d+$/.test(w) && !w.includes("'");

/**
 * Distinctive labels for a passage: repeated two-word phrases first ("dwell time", "cold chain"),
 * then single words, weighted by how specific they are to this passage.
 */
function keywords(span: Unit[], df: Map<string, number>, total: number, n = 2) {
  const tf = new Map<string, number>();
  const phrases = new Map<string, number>();
  for (const u of span) {
    for (const run of contentRuns(u.text)) {
      for (let k = 0; k < run.length; k++) {
        const w = run[k];
        if (!isLabelWord(w)) continue;
        tf.set(w, (tf.get(w) ?? 0) + 1);
        const next = run[k + 1];
        if (next && isLabelWord(next)) phrases.set(`${w} ${next}`, (phrases.get(`${w} ${next}`) ?? 0) + 1);
      }
    }
  }
  const idf = (w: string) => Math.log(1 + total / (df.get(w) ?? 1));
  const scored = [
    ...[...phrases.entries()].filter(([, c]) => c >= 2).map(([p, c]) => [p, c * 2.2 * Math.max(...p.split(" ").map(idf))] as const),
    ...[...tf.entries()].filter(([, c]) => c >= 2).map(([w, c]) => [w, c * idf(w)] as const),
  ].sort((a, b) => b[1] - a[1]);
  const out: string[] = [];
  for (const [label] of scored) {
    if (out.some((o) => o.includes(label) || label.includes(o))) continue;
    out.push(label);
    if (out.length === n) break;
  }
  return out;
}

/** Without Deepgram: split into passages of a few minutes and name each by its distinctive words. */
function topicsFromKeywords(units: Unit[]): TopicOut[] {
  const df = buildDocFreq(units);
  const duration = units[units.length - 1].end - units[0].start;
  const chunkLen = Math.max(90, Math.min(300, duration / 8));
  const chunks: { su: number; eu: number; words: string[] }[] = [];
  let su = 0;
  for (let k = 0; k < units.length; k++) {
    if (units[k].end - units[su].start >= chunkLen || k === units.length - 1) {
      chunks.push({ su, eu: k, words: keywords(units.slice(su, k + 1), df, units.length, 3) });
      su = k + 1;
    }
  }
  const topics: (TopicOut & { key: string })[] = [];
  for (const ch of chunks) {
    if (!ch.words.length) continue;
    const key = ch.words[0];
    const range = { startUnit: ch.su, endUnit: ch.eu, start: units[ch.su].start, end: units[ch.eu].end };
    const prev = topics[topics.length - 1];
    if (prev && (prev.key === key || ch.words.slice(0, 2).includes(prev.key))) {
      prev.ranges[prev.ranges.length - 1].end = range.end;
      prev.ranges[prev.ranges.length - 1].endUnit = range.endUnit;
    } else {
      topics.push({
        key,
        name: capitalize(ch.words[0]),
        summary: `Opens with: "${clamp(cleanSentence(units[ch.su].text), 90)}"`,
        ranges: [range],
      });
    }
  }
  return topics.slice(0, 10).map(({ key: _key, ...t }) => t);
}
