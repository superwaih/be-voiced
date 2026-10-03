import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppErrorPayload,
  AspectRatio,
  ExportResult,
  ImportedMedia,
  KeyStatus,
  LinkInfo,
  MediaInfo,
  Project,
  ProjectMeta,
  Resolution,
  Settings,
  SidecarStatus,
  TextIntelligence,
  Transcript,
  WhisperModel,
} from "./types";

/**
 * Checked on call, not at import: the dev QA harness installs Tauri's IPC mocks after this module
 * is first loaded, and a value frozen at import time would miss them.
 */
export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class AppError extends Error {
  kind: AppErrorPayload["kind"];
  constructor(payload: AppErrorPayload) {
    super(payload.message);
    this.kind = payload.kind;
  }
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (err && typeof err === "object" && "message" in err && "kind" in err) {
      throw new AppError(err as AppErrorPayload);
    }
    throw new AppError({ kind: "error", message: typeof err === "string" ? err : String(err) });
  }
}

export const isCancelled = (err: unknown) => err instanceof AppError && err.kind === "cancelled";
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const fileSrc = (path: string | null | undefined) => (path ? convertFileSrc(path) : undefined);

export interface JobProgressEvent {
  jobId: string;
  stage: string;
  progress: number | null;
  detail: string | null;
}

export const onJobProgress = (cb: (e: JobProgressEvent) => void): Promise<UnlistenFn> =>
  listen<JobProgressEvent>("job-progress", (e) => cb(e.payload));

export const newJobId = () => crypto.randomUUID();

export const ipc = {
  cancelJob: (jobId: string) => call<boolean>("cancel_job", { jobId }),
  sidecarStatus: () => call<SidecarStatus>("sidecar_status"),

  loadSettings: () => call<Settings>("load_settings"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  defaultExportDir: () => call<string>("default_export_dir"),
  keyStatus: () => call<KeyStatus>("api_key_status"),
  setKey: (provider: "deepgram", key: string) => call<void>("set_api_key", { provider, key }),
  deleteKey: (provider: "deepgram") => call<void>("delete_api_key", { provider }),
  verifyKey: (provider: "deepgram") => call<void>("verify_api_key", { provider }),

  importMedia: (path: string) => call<ImportedMedia>("import_media", { path }),
  probeLink: (url: string) => call<LinkInfo>("probe_link", { url }),
  fetchLink: (jobId: string, url: string, info: LinkInfo | null) =>
    call<ImportedMedia & { link: LinkInfo }>("fetch_link", { jobId, url, info }),
  relinkSource: (path: string) => call<MediaInfo>("relink_source", { path }),
  generatePeaks: (req: { jobId: string; projectId: string; sourcePath: string; duration: number }) =>
    call<number[]>("generate_peaks", { req }),
  loadPeaks: (projectId: string) => call<number[] | null>("load_peaks", { projectId }),
  createPreviewProxy: (req: { jobId: string; projectId: string; sourcePath: string; duration: number }) =>
    call<string>("create_preview_proxy", { req }),

  saveProject: (project: Project, meta: ProjectMeta) => call<void>("save_project", { project, meta }),
  loadProject: (projectId: string) => call<Project>("load_project", { projectId }),
  listProjects: () => call<ProjectMeta[]>("list_projects"),
  deleteProject: (projectId: string) => call<void>("delete_project", { projectId }),

  listWhisperModels: () => call<WhisperModel[]>("list_whisper_models"),
  downloadWhisperModel: (jobId: string, model: string) => call<void>("download_whisper_model", { jobId, model }),
  deleteWhisperModel: (model: string) => call<void>("delete_whisper_model", { model }),

  transcribe: (req: {
    jobId: string;
    projectId: string;
    sourcePath: string;
    duration: number;
    engine: "local" | "cloud";
    whisperModel: string;
    language: string;
  }) => call<Transcript>("transcribe", { req }),

  analyzeText: (req: { jobId: string; text: string; language: string }) => call<TextIntelligence>("analyze_text", { req }),

  exportClip: (req: {
    jobId: string;
    projectId: string;
    sourcePath: string;
    outputPath: string;
    start: number;
    end: number;
    aspect: AspectRatio;
    resolution: Resolution;
    framing: number;
    hasVideo: boolean;
    sourceWidth: number | null;
    sourceHeight: number | null;
    background: string;
    ass: string | null;
  }) => call<ExportResult>("export_clip", { req }),
  writeTextFile: (path: string, contents: string) => call<void>("write_text_file", { path, contents }),
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
  openPath: (path: string) => call<void>("open_path", { path }),
  openUrl: (url: string) => call<void>("open_url", { url }),
  revealPath: (path: string) => call<void>("reveal_path", { path }),
};
