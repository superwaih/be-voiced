/**
 * Visual QA harness for `pnpm dev` in a plain browser (open http://localhost:1420/?qa).
 *
 * Uses Tauri's official IPC mocks so the real UI can be reviewed and screenshotted without the
 * native shell. Only loaded when import.meta.env.DEV is true and no Tauri runtime is present, so it
 * never ships in a build. The sample conversation below is invented demo content.
 */
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { defaultCaptionStyle } from "../lib/captions";
import { projectMeta } from "../lib/project";
import type { Clip, Project, Segment, Settings } from "../lib/types";

const LINES: [string, string][] = [
  ["S0", "Welcome back. Today I'm talking with Priya Raman, who spent nine years running logistics for a grocery chain before starting her own cold storage company. Priya, thanks for coming on."],
  ["S1", "Thanks for having me. I've listened to the show for a while, so this is a little surreal."],
  ["S0", "Let's start with the leap. You had a stable job and a team. What made you walk away from that?"],
  ["S1", "Honestly, it was a spreadsheet. Every quarter I'd see how much produce we threw away because a truck sat at a dock for four hours. We were losing more to waiting than to spoilage in transit. And nobody owned that problem, because it lived between departments."],
  ["S0", "So the waste wasn't on the road, it was in the handoffs."],
  ["S1", "Exactly. People picture refrigerated trucks breaking down. That almost never happens. What happens is a pallet waits in a warm corridor while two people argue over a signature."],
  ["S0", "That's a very specific kind of problem to build a company around."],
  ["S1", "It is, and I think that's why it worked. I'm going to say something unpopular here. Most founders pick problems that are too big. If your pitch takes a whole industry to explain, you're not going to fix any of it."],
  ["S0", "I actually disagree a little. Some problems only get solved when someone thinks at that scale."],
  ["S1", "Sure, but those people usually have ten years of runway. I had eleven months of savings. When you're that constrained, narrow is a survival strategy, not a lack of ambition."],
  ["S0", "Fair. Walk me through the first customer."],
  ["S1", "It was a regional distributor two hours from my apartment. I drove there with a thermometer and a clipboard and asked if I could stand on their loading dock for a week. They thought I was strange. By Thursday I could tell them their average dwell time was fifty-one minutes, and that one shift was responsible for most of it."],
  ["S0", "And that shift found out you'd been watching?"],
  ["S1", "They did, and I learned my first big lesson. If your data makes someone look bad, they will fight the data. So I stopped presenting it as blame. I showed it as, here's the forty minutes we can give you back every night."],
  ["S0", "That reframing seems small but it changes the entire conversation."],
  ["S1", "It changes everything. Adoption is emotional before it's rational. Nobody installs sensors because a chart told them to."],
  ["S0", "Let's talk numbers for a second. How much can a mid-sized distributor actually save?"],
  ["S1", "On the sites we work with, we typically cut dock dwell time by around a third in the first ninety days. The spoilage savings are nice, but the real money is labor. You stop paying overtime for trucks that are late because the previous truck was late."],
  ["S0", "Where do you think this goes in five years?"],
  ["S1", "My prediction is that cold chain goes the way of package tracking. Ten years ago you had no idea where your parcel was. Now you'd be furious if you couldn't see it. Temperature is going to be the same. Retailers will expect a full history for every pallet, and suppliers who can't provide it will lose contracts."],
  ["S0", "That sounds like a lot of pressure on small farms."],
  ["S1", "It is, and that part worries me. If the tools stay expensive, compliance becomes a moat for big players. So we price the smallest tier so a single farm can use it. It barely makes us money, but I'd rather grow with them than watch them get squeezed out."],
  ["S0", "Last question. What's something you believed when you started that turned out to be wrong?"],
  ["S1", "I thought the hardest part would be the hardware. It wasn't. The hardest part was getting a night-shift supervisor to trust a stranger with a tablet. Once he did, he sold it to every other site better than I ever could."],
  ["S0", "Priya, this was great. Where can people find you?"],
  ["S1", "We're easy to find online, and I read every message, even the angry ones."],
];

function buildSegments(): Segment[] {
  let t = 3.2;
  return LINES.map(([speaker, text], i) => {
    const tokens = text.split(" ");
    const words = tokens.map((w) => {
      const dur = 0.18 + w.length * 0.045;
      const word = { text: w, start: t, end: t + dur, confidence: w.length > 11 ? 0.41 : 0.93 };
      t += dur + 0.07 + (/[.?!]$/.test(w) ? 0.35 : 0);
      return word;
    });
    t += 0.6;
    return { id: `g${i}`, speaker, start: words[0].start, end: words[words.length - 1].end, words };
  });
}

const now = new Date();
const iso = (minsAgo: number) => new Date(now.getTime() - minsAgo * 60_000).toISOString();

function sampleProject(): Project {
  const segments = buildSegments();
  const duration = Math.ceil(segments[segments.length - 1].end + 4);
  const clip = (partial: Partial<Clip> & Pick<Clip, "id" | "title" | "start" | "end">): Clip => ({
    origin: "ai",
    status: "suggested",
    createdAt: iso(30),
    updatedAt: iso(30),
    aspect: "9:16",
    resolution: 1080,
    framing: 0.5,
    captionsEnabled: true,
    captions: defaultCaptionStyle(),
    exports: [],
    ...partial,
  });
  const at = (seg: number, edge: "start" | "end") => segments[seg][edge];
  return {
    version: 1,
    id: "qa-project",
    name: "Cold chain with Priya Raman",
    createdAt: iso(90),
    updatedAt: iso(4),
    source: {
      path: "C:/Recordings/cold-chain-episode.m4a",
      name: "cold-chain-episode.m4a",
      extension: "m4a",
      size: 38_412_880,
      duration,
      hasVideo: false,
      hasAudio: true,
      width: null,
      height: null,
      fps: null,
      videoCodec: null,
      audioCodec: "aac",
    },
    thumbnailPath: null,
    previewPath: null,
    transcript: {
      engine: "deepgram",
      model: "nova-3",
      language: "en",
      diarized: true,
      createdAt: iso(60),
      speakers: [
        { id: "S0", name: "Marcus" },
        { id: "S1", name: "Priya" },
      ],
      segments,
    },
    topics: [
      { id: "t1", name: "Leaving a stable job", summary: "Why waste in the handoffs, not the trucks, pushed Priya to start a company.", ranges: [{ start: at(2, "start"), end: at(6, "end") }] },
      { id: "t2", name: "Picking a narrow problem", summary: "A disagreement about problem size and runway.", ranges: [{ start: at(7, "start"), end: at(9, "end") }] },
      { id: "t3", name: "Winning the first customer", summary: "A week on a loading dock and reframing data as time given back.", ranges: [{ start: at(11, "start"), end: at(15, "end") }] },
      { id: "t4", name: "The future of cold chain", summary: "Temperature history becoming as expected as package tracking.", ranges: [{ start: at(18, "start"), end: at(21, "end") }] },
    ],
    clips: [
      clip({ id: "c1", rank: 1, title: "If your data makes someone look bad, they fight it", start: at(13, "start"), end: at(15, "end"), speaker: "Priya", topic: "Winning the first customer", category: "insight", score: 91, summary: "Priya explains how presenting dwell-time data as blame backfired, and how reframing it won the site over.", why: "A lesson any operator recognizes, delivered in one clean arc with a quotable closing line." }),
      clip({ id: "c2", rank: 2, title: "Cold chain will go the way of package tracking", start: at(18, "start"), end: at(19, "end"), speaker: "Priya", topic: "The future of cold chain", category: "prediction", score: 86, summary: "A concrete prediction that retailers will demand temperature history for every pallet.", why: "Clear, bold and easy to understand without context." }),
      clip({ id: "c3", rank: 3, title: "Most founders pick problems that are too big", start: at(7, "start"), end: at(9, "end"), speaker: "Priya", topic: "Picking a narrow problem", category: "disagreement", score: 82, summary: "Priya argues for narrow problems and Marcus pushes back.", why: "A real, friendly disagreement with both sides making a fair point." }),
      clip({ id: "c4", rank: 4, title: "The waste lives in the handoffs", start: at(3, "start"), end: at(5, "end"), speaker: "Priya", topic: "Leaving a stable job", category: "explanation", score: 74, summary: "Why produce spoils at the dock, not on the road.", why: "Counterintuitive and visual." }),
      clip({ id: "c5", origin: "manual", status: "saved", rank: undefined, title: "The hardest part was trust, not hardware", start: at(23, "start"), end: at(23, "end"), aspect: "1:1", exports: [{ id: "e1", kind: "captioned", path: "C:/Videos/Be Voiced/trust.mp4", createdAt: iso(12), aspect: "1:1", resolution: 1080, bytes: 14_220_114 }] }),
    ],
    analysis: { model: "Be Voiced moment finder", createdAt: iso(40), runs: 1 },
    transcriptExports: [],
    ui: { view: "workspace", clipId: null, time: at(13, "start") + 2 },
  };
}

const project = sampleProject();
(window as unknown as { __qaProject: Project }).__qaProject = project;
const otherMeta = {
  ...projectMeta({ ...project, id: "qa-2", name: "Quarterly product review", transcript: null, clips: [], analysis: null, topics: [], updatedAt: iso(60 * 26) }),
  hasVideo: true,
  duration: 3480,
  size: 1_904_220_311,
  sourceName: "product-review.mov",
};

const settings: Settings = {
  theme: (new URLSearchParams(location.search).get("theme") as Settings["theme"]) ?? "dark",
  transcriptionMode: "local",
  whisperModel: "base.en",
  whisperLanguage: "auto",
  deepgramLanguage: "en",
  exportDir: "C:/Users/you/Videos/Be Voiced",
  lastProjectId: new URLSearchParams(location.search).has("open") ? "qa-project" : null,
};

function peaks(duration: number) {
  const out: number[] = [];
  for (let i = 0; i < duration * 20; i++) {
    const speech = Math.sin(i / 7) * 0.5 + Math.sin(i / 2.3) * 0.3 + 0.55;
    const pause = Math.sin(i / 61) > 0.93 ? 0.15 : 1;
    out.push(Math.max(8, Math.min(250, Math.round(speech * pause * 190 + ((i * 7919) % 40)))));
  }
  return out;
}

mockWindows("main");
mockConvertFileSrc("windows");
mockIPC(
  (cmd) => {
    switch (cmd) {
      case "load_settings":
        return settings;
      case "save_settings":
        return null;
      case "sidecar_status":
        return { ffmpeg: true, ffprobe: true, whisper: true, folder: "C:/Program Files/Be Voiced" };
      case "default_export_dir":
        return settings.exportDir;
      case "api_key_status":
        return { deepgram: null };
      case "list_whisper_models":
        return [
          { id: "tiny.en", label: "Tiny (English)", size: "75 MB", englishOnly: true, note: "Fastest, rough drafts", installed: false },
          { id: "base.en", label: "Base (English)", size: "142 MB", englishOnly: true, note: "Quick and reliable for clear audio", installed: true },
          { id: "small.en", label: "Small (English)", size: "466 MB", englishOnly: true, note: "Better with crosstalk and accents", installed: false },
          { id: "large-v3-turbo", label: "Large v3 Turbo", size: "1.5 GB", englishOnly: false, note: "Most accurate, slowest", installed: false },
        ];
      case "list_projects":
        return [projectMeta(project, Uint8Array.from(peaks(project.source.duration))), otherMeta];
      case "load_project":
        return project;
      case "save_project":
        return null;
      case "load_peaks":
        return peaks(project.source.duration);
      case "path_exists":
        return false;
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);
