"use client";

/**
 * Everything the interface needs that it cannot work out for itself.
 *
 * This is the only module that knows where data comes from. Today it comes from the browser:
 * recordings and settings in localStorage, duration and dimensions from a media element, the
 * waveform decoded with WebAudio. After PLAN.md phases 1–3 the same functions call `/api/...`
 * instead, and nothing above here changes.
 *
 * Neither transcription nor rendering waits on a server any more: Whisper runs in a worker on the
 * GPU (`lib/transcribe`), and captions are burned in with WebCodecs (`lib/render`). `serviceCan`
 * reports what this particular browser can manage, and the interface asks before offering it.
 *
 * Shapes are already the service's shapes, not the browser's, so that swap stays a rewrite of this
 * file rather than a rewrite of the app.
 */

import { projectMeta } from "@/lib/engine/project";
import { canRenderHere } from "@/lib/render";
import { canTranscribeHere, transcribe as runTranscription, TranscribeCancelled } from "@/lib/transcribe";
import { QUALITIES } from "@/lib/transcribe/models";
import { fileFor, rememberBlob, urlFor } from "@/lib/files";
import type {
  AppErrorPayload,
  AskEntry,
  ImportedMedia,
  MediaInfo,
  Project,
  ProjectMeta,
  Settings,
  Transcript,
  WhisperModel,
} from "@/lib/engine/types";

export class AppError extends Error {
  kind: AppErrorPayload["kind"];
  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.name = "AppError";
    this.kind = payload.kind;
  }
}

/**
 * What can be done here today.
 *
 * Transcription runs in this browser. Rendering video does not: burning captions into a picture
 * needs an encoder and the original file, which is the one job still waiting on a worker
 * (PLAN.md phase 5). Screens read this rather than offering something that cannot happen.
 */
export const serviceCan = {
  transcribe: canTranscribeHere(),
  renderVideo: canRenderHere(),
};

export const isCancelled = (err: unknown) => err instanceof AppError && err.kind === "cancelled";
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const fail = (message: string, kind: AppErrorPayload["kind"] = "error") => new AppError({ kind, message });

/** A URL a <video> or <img> can use. Blob URLs now; signed URLs from the bucket later. */
/**
 * A URL something can be played from.
 *
 * Two kinds now: a signed storage URL for a recording the server holds, and a blob URL for one
 * that has only just been chosen and not uploaded yet.
 */
export const fileSrc = (path: string | null | undefined) =>
  !path ? undefined : /^https?:/.test(path) ? path : urlFor(path);

// --- Jobs ----------------------------------------------------------------------------------------

export interface JobProgressEvent {
  jobId: string;
  stage: string;
  progress: number | null;
  detail: string | null;
}

export type UnlistenFn = () => void;

const listeners = new Set<(e: JobProgressEvent) => void>();

/** Progress for every running job. Polling or SSE against the jobs table replaces this. */
export const onJobProgress = (cb: (e: JobProgressEvent) => void): Promise<UnlistenFn> => {
  listeners.add(cb);
  return Promise.resolve(() => void listeners.delete(cb));
};

const report = (e: JobProgressEvent) => listeners.forEach((cb) => cb(e));

/** Lets work that runs outside this module — rendering, say — report through the same channel. */
export const reportJobProgress = (jobId: string, stage: string, progress: number | null, detail: string | null = null) =>
  report({ jobId, stage, progress, detail });

export const newJobId = () => crypto.randomUUID();

const cancelled = new Set<string>();

/** Throws if this job was cancelled. Every long step passes through one of these. */
function checkpoint(jobId: string) {
  if (cancelled.has(jobId)) {
    cancelled.delete(jobId);
    throw fail("Cancelled", "cancelled");
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Stored documents ----------------------------------------------------------------------------

const KEY = {
  settings: "bv.settings",
  projects: "bv.projects",
  metas: "bv.projectMetas",
  history: "bv.askHistory",
  peaks: "bv.peaks",
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Out of quota or storage blocked: the session works, it just will not survive a reload.
  }
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  transcriptionMode: "local",
  whisperModel: "base.en",
  whisperLanguage: "auto",
  deepgramLanguage: "en",
  exportDir: "Downloads",
  lastProjectId: null,
};

// --- Media ---------------------------------------------------------------------------------------

/** Duration and dimensions from a media element: the browser's ffprobe. */
function probe(url: string, isVideo: boolean): Promise<{ duration: number; width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const el = document.createElement(isVideo ? "video" : "audio") as HTMLVideoElement;
    el.preload = "metadata";
    el.src = url;
    let settled = false;
    const give = (duration: number) => {
      if (settled) return;
      settled = true;
      resolve({
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        width: isVideo ? el.videoWidth || null : null,
        height: isVideo ? el.videoHeight || null : null,
      });
    };
    el.addEventListener("loadedmetadata", () => give(el.duration));
    el.addEventListener("error", () => give(0));
    setTimeout(() => give(el.duration), 6000);
  });
}

/** A frame a few seconds in, drawn to a canvas: the browser's thumbnail. */
function thumbnail(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    let settled = false;
    const give = (key: string | null) => {
      if (settled) return;
      settled = true;
      resolve(key);
    };
    video.addEventListener("loadeddata", () => {
      video.currentTime = Math.min(2, (video.duration || 6) / 3);
    });
    video.addEventListener("seeked", () => {
      const width = 640;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * width) || 360;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => give(blob ? rememberBlob("thumbnails", blob) : null), "image/jpeg", 0.82);
    });
    video.addEventListener("error", () => give(null));
    setTimeout(() => give(null), 8000);
  });
}

async function mediaInfo(path: string): Promise<MediaInfo> {
  const file = fileFor(path);
  if (!file) throw fail("That file is no longer open in this browser. Choose it again.");
  const url = urlFor(path)!;
  const hasVideo = file.type.startsWith("video/") || /\.(mp4|mov|mkv|webm)$/i.test(file.name);
  const { duration, width, height } = await probe(url, hasVideo);
  return {
    path,
    name: file.name,
    extension: file.name.split(".").pop()?.toLowerCase() ?? "",
    size: file.size,
    duration,
    hasVideo,
    hasAudio: true,
    width,
    height,
    fps: null,
    videoCodec: null,
    audioCodec: null,
  };
}

/**
 * Clears transcripts this app made up.
 *
 * An earlier build filled in sample text while the worker was being built, labelled `sample` as its
 * model — which is how it is found here. A real transcript can never carry that model, so this is
 * safe to run on every load. Whatever the sample text produced goes with it: topics, the analysis,
 * and the moments the finder picked out of words nobody said. The recording itself, its waveform
 * and any clip cut by hand are left alone.
 */
export function clearSampleTranscripts(): number {
  const projects = read<Record<string, Project>>(KEY.projects, {});
  const metas = read<Record<string, ProjectMeta>>(KEY.metas, {});
  let cleared = 0;

  for (const [id, p] of Object.entries(projects)) {
    if (p.transcript?.model !== "sample") continue;
    const next: Project = {
      ...p,
      transcript: null,
      topics: [],
      analysis: null,
      clips: p.clips.filter((c) => c.origin !== "ai"),
    };
    projects[id] = next;
    metas[id] = projectMeta(next, null, metas[id]);
    cleared++;
  }

  if (cleared) {
    write(KEY.projects, projects);
    write(KEY.metas, metas);
  }
  return cleared;
}

/** Downloading is a browser's version of writing a file. */
function download(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.split(/[\\/]/).pop() || "download.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// --- The surface ---------------------------------------------------------------------------------

export const api = {
  cancelJob: async (jobId: string) => {
    cancelled.add(jobId);
    return true;
  },

  // Settings -------------------------------------------------------------------------------------

  /** `lastProjectId` is dropped: the address bar is what brings you back here, not a setting. */
  loadSettings: async (): Promise<Settings> => ({
    ...DEFAULT_SETTINGS,
    ...read<Partial<Settings>>(KEY.settings, {}),
    lastProjectId: null,
  }),
  saveSettings: async (settings: Settings): Promise<void> => write(KEY.settings, settings),

  /** How careful to be. The model behind each is downloaded once and cached by the browser. */
  listModels: async (): Promise<WhisperModel[]> =>
    QUALITIES.map((q) => ({
      id: q.id,
      label: q.label,
      size: q.size,
      englishOnly: q.englishOnly,
      note: q.note,
      installed: true,
    })),

  // Recordings -----------------------------------------------------------------------------------

  importMedia: async (path: string): Promise<ImportedMedia> => {
    const media = await mediaInfo(path);
    return {
      projectId: crypto.randomUUID(),
      projectDir: "browser",
      media,
      thumbnailPath: media.hasVideo ? await thumbnail(urlFor(path)!) : null,
    };
  },

  relinkSource: (path: string): Promise<MediaInfo> => mediaInfo(path),

  /**
   * Saves a recording to the account it belongs to.
   *
   * This used to write localStorage, which is per-browser rather than per-person — two people
   * signing in on one machine saw each other's work. The document is the project: transcript,
   * moments, clips, caption style.
   */
  saveProject: async (project: Project, meta: ProjectMeta): Promise<void> => {
    const res = await fetch(`/api/recordings/${project.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: project.name, document: project, duration: project.source.duration }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw fail(body.error ?? "Could not save that recording.");
    }
    // The summary is derived from the document, so nothing else has to be sent.
    void meta;
  },

  loadProject: async (projectId: string): Promise<Project> => {
    const res = await fetch(`/api/recordings/${projectId}`, { cache: "no-store" });
    if (!res.ok) throw fail("That recording is not here.");
    const { recording, media } = (await res.json()) as {
      recording: { id: string; name: string; document: Project | null };
      media: string | null;
    };
    if (!recording.document) throw fail("That recording has nothing saved yet.");

    // The media lives in the bucket now, so the project's source path is the signed URL it can be
    // played from. `fileSrc` hands it straight to the player.
    const project = recording.document;
    return media ? { ...project, source: { ...project.source, path: media } } : project;
  },

  listProjects: async (): Promise<ProjectMeta[]> => {
    const res = await fetch("/api/recordings", { cache: "no-store" });
    if (!res.ok) return [];
    const { recordings } = (await res.json()) as {
      recordings: { id: string; name: string; document: Project | null; updatedAt: string }[];
    };
    return recordings
      .filter((r) => r.document)
      .map((r) => projectMeta(r.document as Project, null, undefined));
  },

  deleteProject: async (projectId: string): Promise<void> => {
    const res = await fetch(`/api/recordings/${projectId}`, { method: "DELETE" });
    if (!res.ok) throw fail("Could not delete that recording.");
  },

  // Waveform -------------------------------------------------------------------------------------

  /** Decoded from the real audio, so the waveform is the recording and not a drawing of one. */
  generatePeaks: async (req: { jobId: string; projectId: string; sourcePath: string }): Promise<number[]> => {
    const file = fileFor(req.sourcePath);
    const stored = read<Record<string, number[]>>(KEY.peaks, {});
    if (!file) return stored[req.projectId] ?? [];
    report({ jobId: req.jobId, stage: "Reading audio", progress: null, detail: null });
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const samples = buffer.getChannelData(0);
      const total = Math.max(1, Math.floor(buffer.duration * 20));
      const span = Math.max(1, Math.floor(samples.length / total));
      const peaks: number[] = [];
      for (let i = 0; i < total; i++) {
        let max = 0;
        // Every 16th sample is plenty for a 20-per-second envelope and keeps long files quick.
        for (let k = i * span; k < (i + 1) * span; k += 16) max = Math.max(max, Math.abs(samples[k] ?? 0));
        peaks.push(Math.min(255, Math.round(max * 255)));
        if (i % 400 === 0) {
          checkpoint(req.jobId);
          report({ jobId: req.jobId, stage: "Reading audio", progress: i / total, detail: null });
          await pause(0);
        }
      }
      stored[req.projectId] = peaks;
      write(KEY.peaks, stored);
      return peaks;
    } catch {
      // A codec the browser cannot decode. No peaks means no waveform, which the interface handles.
      return [];
    }
  },

  loadPeaks: async (projectId: string): Promise<number[] | null> =>
    read<Record<string, number[]>>(KEY.peaks, {})[projectId] ?? null,

  // Transcription --------------------------------------------------------------------------------

  /**
   * Whisper, on this machine, in a worker.
   *
   * The file never leaves the browser. Progress is real — the worker walks the audio in windows
   * and says where it has got to — and cancelling actually stops the work rather than hiding it.
   */
  transcribe: async (req: {
    jobId: string;
    projectId: string;
    sourcePath: string;
    duration: number;
    model: string;
    language: string;
  }): Promise<Transcript> => {
    const file = fileFor(req.sourcePath);
    if (!file) throw fail("That file is no longer open in this browser. Choose it again.");

    // The job's own cancel flag drives an AbortSignal, so one Cancel button stops everything.
    const abort = new AbortController();
    const watch = window.setInterval(() => {
      if (cancelled.has(req.jobId)) abort.abort();
    }, 150);

    try {
      return await runTranscription({
        file,
        quality: req.model,
        language: req.language,
        duration: req.duration,
        signal: abort.signal,
        onProgress: (p: { stage: string; progress: number | null; detail: string | null }) =>
          report({ jobId: req.jobId, stage: p.stage, progress: p.progress, detail: p.detail }),
      });
    } catch (err) {
      if (err instanceof TranscribeCancelled) {
        cancelled.delete(req.jobId);
        throw fail("Cancelled", "cancelled");
      }
      throw err instanceof AppError ? err : fail(err instanceof Error ? err.message : String(err));
    } finally {
      window.clearInterval(watch);
    }
  },

  // Conversations --------------------------------------------------------------------------------

  loadAskHistory: async (): Promise<AskEntry[]> =>
    read<AskEntry[]>(KEY.history, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

  saveAskEntry: async (entry: AskEntry): Promise<void> => {
    const all = read<AskEntry[]>(KEY.history, []);
    const at = all.findIndex((e) => e.id === entry.id);
    if (at >= 0) all[at] = entry;
    else all.unshift(entry);
    write(KEY.history, all.slice(0, 200));
  },

  deleteAskEntry: async (entryId: string): Promise<void> =>
    write(KEY.history, read<AskEntry[]>(KEY.history, []).filter((e) => e.id !== entryId)),

  clearAskHistory: async (): Promise<void> => write(KEY.history, []),

  // Exports --------------------------------------------------------------------------------------

  /** Subtitles and transcripts are text, so the browser can hand them over itself. */
  saveTextFile: async (name: string, contents: string): Promise<void> => download(name, contents),

  /** Hands a finished render to the person, which is a browser's version of saving a file. */
  saveFile: async (name: string, blob: Blob): Promise<void> => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
};
