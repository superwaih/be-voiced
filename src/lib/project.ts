import { defaultCaptionStyle } from "./captions";
import { stripExtension } from "./format";
import { wordCount } from "./transcript";
import type { AnalyzeResult, Clip, ClipMeta, ImportedMedia, Project, ProjectMeta, Topic } from "./types";
import { packWave, sampleWave } from "./wave";

const now = () => new Date().toISOString();

export function newProject(imported: ImportedMedia): Project {
  const t = now();
  return {
    version: 1,
    id: imported.projectId,
    name: stripExtension(imported.media.name),
    createdAt: t,
    updatedAt: t,
    source: imported.media,
    thumbnailPath: imported.thumbnailPath,
    previewPath: null,
    transcript: null,
    topics: [],
    clips: [],
    analysis: null,
    transcriptExports: [],
    ui: { view: "workspace", clipId: null, time: 0 },
  };
}

export function defaultAspect(p: Project): Clip["aspect"] {
  return p.source.hasVideo ? "original" : "1:1";
}

export function newClip(p: Project, partial: Partial<Clip> & Pick<Clip, "start" | "end" | "title">): Clip {
  const t = now();
  return {
    id: crypto.randomUUID(),
    origin: "manual",
    status: "saved",
    createdAt: t,
    updatedAt: t,
    aspect: defaultAspect(p),
    resolution: 1080,
    framing: 0.5,
    captionsEnabled: true,
    captions: defaultCaptionStyle(),
    exports: [],
    ...partial,
  };
}

export function applyAnalysis(p: Project, result: AnalyzeResult, mode: "initial" | "more"): Project {
  const existingRanks = p.clips.filter((c) => c.origin === "ai").length;
  const clips = result.highlights.map((h, i) =>
    newClip(p, {
      origin: "ai",
      status: "suggested",
      title: h.title,
      start: h.start,
      end: h.end,
      speaker: h.speaker,
      topic: h.topic,
      category: h.category,
      summary: h.summary,
      why: h.why,
      score: h.score,
      rank: (mode === "more" ? existingRanks : 0) + i + 1,
    }),
  );
  const topics: Topic[] =
    mode === "initial"
      ? result.topics.map((t) => ({
          id: crypto.randomUUID(),
          name: t.name,
          summary: t.summary,
          ranges: t.ranges.map((r) => ({ start: r.start, end: r.end })),
        }))
      : p.topics;

  // A fresh analysis replaces untouched suggestions but never saved or edited clips.
  const kept = mode === "initial" ? p.clips.filter((c) => c.origin === "manual" || c.status !== "suggested") : p.clips;
  return {
    ...p,
    topics,
    clips: [...kept, ...clips],
    analysis: {
      model: result.model,
      createdAt: now(),
      runs: (p.analysis?.runs ?? 0) + 1,
    },
  };
}

/**
 * Library summary written next to each project. Waveform art is sampled from peaks when they are
 * loaded, otherwise carried over from the previous summary.
 */
export function projectMeta(p: Project, peaks?: Uint8Array | null, previous?: ProjectMeta): ProjectMeta {
  const prevClip = new Map((previous?.clips ?? []).concat(previous?.topSuggestions ?? []).map((c) => [c.id, c]));
  const clipMeta = (c: Clip): ClipMeta => {
    const video = c.exports.filter((e) => e.kind === "clip" || e.kind === "captioned");
    const old = prevClip.get(c.id);
    return {
      id: c.id,
      title: c.title,
      start: c.start,
      end: c.end,
      status: c.status,
      aspect: c.aspect,
      exportCount: c.exports.length,
      lastExportPath: video[video.length - 1]?.path ?? null,
      updatedAt: c.updatedAt,
      origin: c.origin,
      category: c.category,
      wave: peaks ? packWave(sampleWave(peaks, c.start, c.end, 32)) : old && old.start === c.start && old.end === c.end ? old.wave : undefined,
    };
  };
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    sourcePath: p.source.path,
    sourceName: p.source.name,
    duration: p.source.duration,
    size: p.source.size,
    hasVideo: p.source.hasVideo,
    thumbnailPath: p.thumbnailPath,
    stage: p.analysis ? "analyzed" : p.transcript ? "transcribed" : "imported",
    engine: p.transcript?.engine ?? null,
    language: p.transcript?.language ?? null,
    wordCount: wordCount(p.transcript),
    speakerCount: p.transcript?.speakers.length ?? 0,
    suggestionCount: p.clips.filter((c) => c.status === "suggested").length,
    clips: p.clips.filter((c) => c.status === "saved").map(clipMeta),
    // Six, not three: the Clips tab shows these as tiles, and Home takes the first three.
    topSuggestions: p.clips
      .filter((c) => c.status === "suggested")
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .slice(0, 6)
      .map(clipMeta),
    wave: peaks ? packWave(sampleWave(peaks, 0, p.source.duration, 96)) : previous?.wave,
    excerpt: p.transcript ? excerptOf(p) : undefined,
    link: p.link ?? null,
    chatCount: p.chat?.length ?? 0,
  };
}

function excerptOf(p: Project): string {
  const words: string[] = [];
  for (const seg of p.transcript?.segments ?? []) {
    for (const w of seg.words) {
      words.push(w.text);
      if (words.join(" ").length > 240) return `${words.join(" ")}...`;
    }
  }
  return words.join(" ");
}

/** How many suggestions to ask for, scaled to the conversation length. */
export function suggestionCount(durationSeconds: number): number {
  return Math.max(4, Math.min(14, Math.round(durationSeconds / 300)));
}

export const CATEGORY_LABEL: Record<string, string> = {
  opinion: "Strong opinion",
  contrarian: "Contrarian take",
  explanation: "Explanation",
  insight: "Insight",
  prediction: "Prediction",
  disagreement: "Disagreement",
  story: "Story",
  funny: "Funny",
  statistic: "Statistic",
  quote: "Quotable",
  answer: "Clear answer",
};
