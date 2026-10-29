"use client";

/**
 * Application state that is not about one recording: settings, the library, running jobs, toasts.
 *
 * Which screen you are on is not in here — that is the URL's job now.
 */

import { create } from "zustand";
import { api, clearSampleTranscripts, DEFAULT_SETTINGS, errorMessage, isCancelled, newJobId, onJobProgress } from "@/lib/api";
import type { ProjectMeta, Settings, WhisperModel } from "@/lib/engine/types";

export type JobKind = "import" | "transcribe" | "analyze" | "export" | "peaks";

export interface JobState {
  id: string;
  kind: JobKind;
  label: string;
  projectId?: string;
  clipId?: string;
  stage: string;
  progress: number | null;
  detail: string | null;
  startedAt: number;
}

export interface Toast {
  id: string;
  tone: "neutral" | "success" | "error";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

interface AppStore {
  booted: boolean;
  settings: Settings;
  models: WhisperModel[];
  library: ProjectMeta[];
  jobs: Record<string, JobState>;
  toasts: Toast[];
  /** The recording waiting on a delete confirmation, from whichever screen asked. */
  pendingDelete: ProjectMeta | null;

  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  upsertMeta: (meta: ProjectMeta) => void;
  removeMeta: (id: string) => void;
  askDelete: (meta: ProjectMeta | null) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
  runJob: <T>(
    info: Omit<JobState, "id" | "stage" | "progress" | "detail" | "startedAt"> & { stage?: string },
    fn: (jobId: string) => Promise<T>,
  ) => Promise<T>;
  cancelJob: (id: string) => void;
}

export const useApp = create<AppStore>((set, get) => ({
  booted: false,
  settings: DEFAULT_SETTINGS,
  models: [],
  library: [],
  jobs: {},
  toasts: [],
  pendingDelete: null,

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      await api.saveSettings(settings);
    } catch (err) {
      get().toast({ tone: "error", title: "Settings not saved", body: errorMessage(err) });
    }
  },

  refreshModels: async () => set({ models: await api.listModels() }),
  refreshLibrary: async () => set({ library: await api.listProjects() }),

  upsertMeta: (meta) =>
    set((s) => {
      const prev = s.library.find((m) => m.id === meta.id);
      const merged = { ...meta, sourceMissing: prev?.sourceMissing };
      return { library: [merged, ...s.library.filter((m) => m.id !== meta.id)] };
    }),
  removeMeta: (id) => set((s) => ({ library: s.library.filter((m) => m.id !== id) })),
  askDelete: (meta) => set({ pendingDelete: meta }),

  toast: (t) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    window.setTimeout(() => get().dismissToast(id), t.tone === "error" ? 9000 : 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  runJob: async (info, fn) => {
    const id = newJobId();
    set((s) => ({
      jobs: {
        ...s.jobs,
        [id]: { ...info, id, stage: info.stage ?? "Starting", progress: null, detail: null, startedAt: Date.now() },
      },
    }));
    try {
      return await fn(id);
    } finally {
      set((s) => {
        const jobs = { ...s.jobs };
        delete jobs[id];
        return { jobs };
      });
    }
  },

  cancelJob: (id) => {
    void api.cancelJob(id);
    set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], stage: "Cancelling" } } } : s));
  },
}));

let booting: Promise<void> | null = null;

/** Loads settings and the library once per page load, however many screens ask for it. */
export function bootApp(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    await onJobProgress((e) => {
      useApp.setState((s) => {
        const job = s.jobs[e.jobId];
        // A job being cancelled keeps saying so until it actually stops.
        if (!job || job.stage === "Cancelling") return s;
        return { jobs: { ...s.jobs, [e.jobId]: { ...job, stage: e.stage, progress: e.progress, detail: e.detail } } };
      });
    });
    const settings = await api.loadSettings().catch(() => DEFAULT_SETTINGS);
    useApp.setState({ settings });

    // Transcripts an earlier build invented are cleared before anything reads them.
    const cleared = clearSampleTranscripts();

    const { refreshModels, refreshLibrary } = useApp.getState();
    await Promise.all([refreshModels(), refreshLibrary()].map((p) => p.catch(() => undefined)));
    useApp.setState({ booted: true });

    if (cleared) {
      useApp.getState().toast({
        tone: "neutral",
        title: `Cleared ${cleared} sample ${cleared === 1 ? "transcript" : "transcripts"}`,
        body: "An earlier build filled those in while transcription was being written. Your recordings are untouched.",
      });
    }
  })();
  return booting;
}

/** Reports a failed action, unless it failed because someone cancelled it. */
export function reportError(title: string, err: unknown) {
  if (isCancelled(err)) return;
  useApp.getState().toast({ tone: "error", title, body: errorMessage(err) });
}
