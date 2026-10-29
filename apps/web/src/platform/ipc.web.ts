/**
 * The same bridge the desktop app talks to, implemented for a browser.
 *
 * Every export matches `apps/desktop/src/lib/ipc.ts`, and Vite substitutes this file for that one
 * when building the web app, so the views, stores and engine run unchanged.
 *
 * What a browser can do, it does: recordings persist, waveforms are decoded from the real audio,
 * transcripts and subtitles download. What belongs to the service — whisper, FFmpeg, yt-dlp — says
 * so in a sentence rather than failing obscurely. Transcription reports the stages the service will
 * report and returns sample text until the API from PLAN.md Phase 3 exists; that transcript is
 * labelled `sample` so nobody mistakes it for their own words.
 */

import type {
  AppErrorPayload,
  AskEntry,
  ExportResult,
  ImportedMedia,
  KeyStatus,
  LinkInfo,
  MediaInfo,
  Project,
  ProjectMeta,
  Settings,
  SidecarStatus,
  TextIntelligence,
  Transcript,
  WhisperModel,
} from "@be-voiced/engine/types";
import { sampleTranscriptFor } from "../lib/sample";
import { fileFor, has, rememberBlob, urlFor } from "./files";

/** Which bridge this build talks to. */
export const platform: "desktop" | "web" = "web";

/** The bridge is this module, so it is always here. */
export const bridgeReady = () => true;

export class AppError extends Error {
  kind: AppErrorPayload["kind"];
  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.kind = payload.kind;
  }
}

export const isCancelled = (err: unknown) => err instanceof AppError && err.kind === "cancelled";
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Blob URLs stand in for the asset protocol: the browser already holds the bytes. */
export const fileSrc = (path: string | null | undefined) => (path ? urlFor(path) : undefined);

export interface JobProgressEvent {
  jobId: string;
  stage: string;
  progress: number | null;
  detail: string | null;
}

export type UnlistenFn = () => void;

const listeners = new Set<(e: JobProgressEvent) => void>();
export const onJobProgress = (cb: (e: JobProgressEvent) => void): Promise<UnlistenFn> => {
  listeners.add(cb);
  return Promise.resolve(() => void listeners.delete(cb));
};
const report = (e: JobProgressEvent) => listeners.forEach((cb) => cb(e));

export const newJobId = () => crypto.randomUUID();

const fail = (message: string, kind: AppErrorPayload["kind"] = "error") => new AppError({ kind, message });

const cancelled = new Set<string>();
/** Throws if this job was cancelled, which is how a desktop job ends early too. */
const checkpoint = (jobId: string) => {
  if (cancelled.has(jobId)) {
    cancelled.delete(jobId);
    throw fail("Cancelled", "cancelled");
  }
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Stored documents ----------------------------------------------------------------------------
// localStorage holds settings, recordings and conversations. It is synchronous, survives a reload,
// and is enough for everything the interface reads. The service replaces this wholesale.

const KEY = {
  settings: "bv.settings",
  projects: "bv.projects",
  metas: "bv.projectMetas",
  history: "bv.askHistory",
  peaks: "bv.peaks",
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Out of quota or storage blocked: the session still works, it just will not survive a reload.
  }
}

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  transcriptionMode: "local",
  whisperModel: "base.en",
  whisperLanguage: "auto",
  deepgramLanguage: "en",
  exportDir: "Downloads",
  lastProjectId: null,
};

// --- Media ---------------------------------------------------------------------------------------

/** Duration and dimensions from a media element, which is the browser's ffprobe. */
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

/** Downloading a file is a browser's version of writing one. */
function offer(path: string, contents: string) {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split(/[\\/]/).pop() || "download.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const ipc = {
  cancelJob: async (jobId: string) => {
    cancelled.add(jobId);
    return true;
  },

  /**
   * The capabilities as the browser sees them: the service does the media work, so those read as
   * present. Downloading from a link genuinely is not available here, and says so.
   */
  sidecarStatus: async (): Promise<SidecarStatus> => ({
    ffmpeg: true,
    ffprobe: true,
    whisper: true,
    ytdlp: false,
    folder: "our servers",
  }),

  /** `lastProjectId` is dropped: on the web the address bar is what brings you back, not a setting. */
  loadSettings: async (): Promise<Settings> => ({
    ...DEFAULT_SETTINGS,
    ...read<Partial<Settings>>(KEY.settings, {}),
    lastProjectId: null,
  }),
  saveSettings: async (settings: Settings) => write(KEY.settings, settings),
  defaultExportDir: async () => "Downloads",

  keyStatus: async (): Promise<KeyStatus> => ({ deepgram: null }),
  setKey: async (_provider: "deepgram", _key: string): Promise<void> => {
    throw fail("Keys are held by the service, not by your browser.", "missing_key");
  },
  deleteKey: async (_provider: "deepgram"): Promise<void> => undefined,
  verifyKey: async (_provider: "deepgram"): Promise<void> => {
    throw fail("Keys are held by the service, not by your browser.", "missing_key");
  },

  importMedia: async (path: string): Promise<ImportedMedia> => {
    const media = await mediaInfo(path);
    return {
      projectId: crypto.randomUUID(),
      projectDir: "browser",
      media,
      thumbnailPath: media.hasVideo ? await thumbnail(urlFor(path)!) : null,
    };
  },

  probeLink: async (_url: string): Promise<LinkInfo> => {
    throw fail("Pasting links is a desktop feature. Upload a file to read and ask about it here.");
  },
  fetchLink: async (_jobId: string, _url: string, _info: LinkInfo | null): Promise<ImportedMedia & { link: LinkInfo }> => {
    throw fail("Pasting links is a desktop feature. Upload a file to read and ask about it here.");
  },

  relinkSource: (path: string): Promise<MediaInfo> => mediaInfo(path),

  /** Decoded with WebAudio, so the waveform is the real audio rather than a drawing of one. */
  generatePeaks: async (req: { jobId: string; projectId: string; sourcePath: string; duration: number }): Promise<number[]> => {
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
      // A codec the browser cannot decode. The interface treats no peaks as no waveform.
      return [];
    }
  },
  loadPeaks: async (projectId: string): Promise<number[] | null> => read<Record<string, number[]>>(KEY.peaks, {})[projectId] ?? null,

  createPreviewProxy: async (_req: { jobId: string; projectId: string; sourcePath: string; duration: number }): Promise<string> => {
    throw fail("Preview copies are made by the service. The original plays here when your browser supports it.");
  },

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

  saveProject: async (project: Project, meta: ProjectMeta): Promise<void> => {
    const projects = read<Record<string, Project>>(KEY.projects, {});
    const metas = read<Record<string, ProjectMeta>>(KEY.metas, {});
    projects[project.id] = project;
    metas[meta.id] = meta;
    write(KEY.projects, projects);
    write(KEY.metas, metas);
  },
  loadProject: async (projectId: string): Promise<Project> => {
    const project = read<Record<string, Project>>(KEY.projects, {})[projectId];
    if (!project) throw fail("That recording is not in this browser.");
    return project;
  },
  listProjects: async (): Promise<ProjectMeta[]> =>
    Object.values(read<Record<string, ProjectMeta>>(KEY.metas, {}))
      // The browser forgets files on reload, so a recording from an earlier visit is source-missing.
      .map((m) => ({ ...m, sourceMissing: !has(m.sourcePath) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  deleteProject: async (projectId: string): Promise<void> => {
    const projects = read<Record<string, Project>>(KEY.projects, {});
    const metas = read<Record<string, ProjectMeta>>(KEY.metas, {});
    const peaks = read<Record<string, number[]>>(KEY.peaks, {});
    delete projects[projectId];
    delete metas[projectId];
    delete peaks[projectId];
    write(KEY.projects, projects);
    write(KEY.metas, metas);
    write(KEY.peaks, peaks);
  },

  /** Models live on the service, so there is nothing to install or remove here. */
  listWhisperModels: async (): Promise<WhisperModel[]> => [
    {
      id: "base.en",
      label: "Standard",
      size: "fast",
      englishOnly: true,
      note: "Good quality, and quick even on a long recording.",
      installed: true,
    },
    {
      id: "small.en",
      label: "Careful",
      size: "slower",
      englishOnly: true,
      note: "More accurate with accents, crosstalk and difficult audio. Takes longer.",
      installed: true,
    },
  ],
  downloadWhisperModel: async (_jobId: string, _model: string): Promise<void> => {
    throw fail("Models live on the service. Nothing downloads to your browser.");
  },
  deleteWhisperModel: async (_model: string): Promise<void> => undefined,

  /**
   * On the service this is a queued job on a worker. Here it reports the same stages, so every
   * screen that watches a job behaves identically, and returns sample text labelled as such.
   */
  transcribe: async (req: {
    jobId: string;
    projectId: string;
    sourcePath: string;
    duration: number;
    engine: "local" | "cloud";
    whisperModel: string;
    language: string;
  }): Promise<Transcript> => {
    const file = fileFor(req.sourcePath);
    const size = file ? `${(file.size / 1_000_000).toFixed(0)} MB` : null;
    report({ jobId: req.jobId, stage: "Uploading", progress: 0, detail: size });
    for (let i = 1; i <= 6; i++) {
      await pause(200);
      checkpoint(req.jobId);
      report({ jobId: req.jobId, stage: "Uploading", progress: i / 6, detail: size });
    }
    report({ jobId: req.jobId, stage: "Waiting for a worker", progress: null, detail: "Starting one for your file" });
    await pause(800);
    checkpoint(req.jobId);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await pause(240);
      checkpoint(req.jobId);
      report({ jobId: req.jobId, stage: "Transcribing", progress: i / steps, detail: null });
    }
    return sampleTranscriptFor(req.duration);
  },

  analyzeText: async (_req: { jobId: string; text: string; language: string }): Promise<TextIntelligence> => {
    throw fail("Topic and sentiment analysis needs a key the service holds.", "missing_key");
  },

  exportClip: async (_req: Record<string, unknown>): Promise<ExportResult> => {
    throw fail("Rendering video happens on the service. Subtitle and transcript files download here.");
  },

  writeTextFile: async (path: string, contents: string): Promise<void> => offer(path, contents),
  /** No path exists in a browser, which also means an export never has to find a free name. */
  pathExists: async (_path: string) => false,
  openPath: async (path: string): Promise<void> => {
    const url = urlFor(path);
    if (url) window.open(url, "_blank", "noopener");
  },
  openUrl: async (url: string): Promise<void> => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  revealPath: async (_path: string): Promise<void> => undefined,
};
