/**
 * Sample transcript text, until the service exists.
 *
 * The web bridge cannot transcribe: whisper runs on a server (PLAN.md, Phase 3). Until that server
 * is there, an upload returns this — a real two-speaker conversation with word timings, fitted to
 * the length of the file so captions, moments and clip previews line up with what is playing.
 *
 * The transcript is labelled `sample` as its model, which is what the interface displays, so it is
 * never mistaken for the person's own words.
 */

import type { Segment, Transcript, Word } from "@be-voiced/engine/types";

const LINES: [string, string][] = [
  ["S0", "Welcome back. Today I'm talking with Priya Raman, who spent nine years running logistics for a grocery chain before starting her own cold storage company."],
  ["S1", "Thanks for having me. I've listened to the show for a while, so this is a little surreal."],
  ["S0", "Let's start with the leap. You had a stable job and a team. What made you walk away from that?"],
  ["S1", "Honestly, it was a spreadsheet. Every quarter I'd see how much produce we threw away because a truck sat at a dock for four hours. We were losing more to waiting than to spoilage in transit."],
  ["S0", "So the waste wasn't on the road, it was in the handoffs."],
  ["S1", "Exactly. People picture refrigerated trucks breaking down. That almost never happens. What happens is a pallet waits in a warm corridor while two people argue over a signature."],
  ["S1", "I'm going to say something unpopular here. Most founders pick problems that are too big. If your pitch takes a whole industry to explain, you're not going to fix any of it."],
  ["S0", "I actually disagree a little. Some problems only get solved when someone thinks at that scale."],
  ["S1", "Sure, but those people usually have ten years of runway. I had eleven months of savings. When you're that constrained, narrow is a survival strategy, not a lack of ambition."],
  ["S0", "Walk me through the first customer."],
  ["S1", "It was a regional distributor two hours from my apartment. I drove there with a thermometer and a clipboard and asked if I could stand on their loading dock for a week."],
  ["S1", "By Thursday I could tell them their average dwell time was fifty-one minutes, and that one shift was responsible for most of it."],
  ["S0", "And that shift found out you'd been watching?"],
  ["S1", "They did, and I learned my first big lesson. If your data makes someone look bad, they will fight the data. So I stopped presenting it as blame and showed it as time we could give back."],
  ["S0", "How much can a mid-sized distributor actually save?"],
  ["S1", "On the sites we work with, we typically cut dock dwell time by around a third in the first ninety days. The spoilage savings are nice, but the real money is labour."],
  ["S0", "Where does this go in five years?"],
  ["S1", "My prediction is that cold chain goes the way of package tracking. Retailers will expect a full history for every pallet, and suppliers who can't provide it will lose contracts."],
  ["S0", "Last question. What did you believe at the start that turned out to be wrong?"],
  ["S1", "I thought the hardest part would be the hardware. It wasn't. The hardest part was getting a night-shift supervisor to trust a stranger with a tablet."],
];

const WORD = 0.38;
const GAP = 0.6;
const START = 1.5;

function build(rate: number): Segment[] {
  let at = START;
  return LINES.map(([speaker, text], i) => {
    const tokens = text.split(" ");
    const start = at;
    const words: Word[] = tokens.map((token, k) => ({
      text: token,
      start: start + k * WORD * rate,
      end: start + (k + 1) * WORD * rate,
      confidence: 0.86 + ((i + k) % 7) * 0.02,
    }));
    at = words[words.length - 1].end + GAP * rate;
    return { id: `s${i}`, speaker, start, end: words[words.length - 1].end, words };
  });
}

/** How long the conversation runs at its natural pace. */
const naturalEnd = (() => {
  const segments = build(1);
  return segments[segments.length - 1].end;
})();

/**
 * The conversation, fitted to a file of `duration` seconds.
 *
 * Speech is stretched or compressed within reason, and anything that still runs past the end of the
 * file is cut, so no caption is ever timed to a moment the media does not have.
 */
export function sampleTranscriptFor(duration: number): Transcript {
  const wanted = duration > 1 ? duration : naturalEnd;
  const rate = Math.min(2, Math.max(0.5, (wanted - START) / (naturalEnd - START)));
  const segments = build(rate)
    .filter((s) => s.start < wanted - 0.5)
    .map((s) => {
      if (s.end <= wanted) return s;
      const words = s.words.filter((w) => w.start < wanted);
      if (!words.length) return null;
      const last = words[words.length - 1];
      return { ...s, end: Math.min(last.end, wanted), words: [...words.slice(0, -1), { ...last, end: Math.min(last.end, wanted) }] };
    })
    .filter((s): s is Segment => !!s);

  return {
    engine: "whisper",
    model: "sample",
    language: "en",
    diarized: true,
    createdAt: new Date().toISOString(),
    speakers: [
      { id: "S0", name: "Marcus" },
      { id: "S1", name: "Priya" },
    ],
    segments,
  };
}
