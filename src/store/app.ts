import { create } from "zustand";
import { AppError, errorMessage, ipc, isCancelled, newJobId, onJobProgress } from "../lib/ipc";
import type { KeyStatus, ProjectMeta, Settings, SidecarStatus, WhisperModel } from "../lib/types";

export type View = "home" | "projects" | "transcripts" | "clips" | "settings" | "project";

export type JobKind = "import" | "transcribe" | "analyze" | "export" | "peaks" | "proxy" | "model";

export interface JobState {
  id: string;
  kind: JobKind;
  label: string;
  projectId?: string;
  clipId?: string;
  modelId?: string;
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

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  transcriptionMode: "local",
  whisperModel: "base.en",
  whisperLanguage: "auto",
  deepgramLanguage: "en",
  exportDir: null,
  lastProjectId: null,
};

interface AppStore {
  booted: boolean;
  view: View;
  settings: Settings;
  keys: KeyStatus;
  sidecars: SidecarStatus | null;
  models: WhisperModel[];
  library: ProjectMeta[];
  jobs: Record<string, JobState>;
  toasts: Toast[];
  /** Project waiting on the delete confirmation, from whichever view asked. */
  pendingDelete: ProjectMeta | null;

  setView: (view: View) => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  refreshKeys: () => Promise<void>;
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
  view: "home",
  settings: DEFAULT_SETTINGS,
  keys: { deepgram: null },
  sidecars: null,
  models: [],
  library: [],
  jobs: {},
  toasts: [],
  pendingDelete: null,

  setView: (view) => set({ view }),

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      await ipc.saveSettings(settings);
    } catch (err) {
      get().toast({ tone: "error", title: "Settings not saved", body: errorMessage(err) });
    }
  },

  refreshKeys: async () => set({ keys: await ipc.keyStatus() }),
  refreshModels: async () => set({ models: await ipc.listWhisperModels() }),
  refreshLibrary: async () => set({ library: await ipc.listProjects() }),

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
    void ipc.cancelJob(id);
    set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], stage: "Cancelling" } } } : s));
  },
}));

export async function bootApp() {
  const { refreshKeys, refreshModels, refreshLibrary } = useApp.getState();
  await onJobProgress((e) => {
    useApp.setState((s) => {
      const job = s.jobs[e.jobId];
      if (!job || job.stage === "Cancelling") return s;
      return {
        jobs: {
          ...s.jobs,
          [e.jobId]: { ...job, stage: e.stage, progress: e.progress, detail: e.detail },
        },
      };
    });
  });
  const [settings, sidecars] = await Promise.all([
    ipc.loadSettings().catch(() => DEFAULT_SETTINGS),
    ipc.sidecarStatus().catch(() => null),
  ]);
  if (!settings.exportDir) {
    settings.exportDir = await ipc.defaultExportDir().catch(() => null);
  }
  useApp.setState({ settings, sidecars });
  await Promise.all([refreshKeys(), refreshModels(), refreshLibrary()].map((p) => p.catch(() => undefined)));
  useApp.setState({ booted: true });
}

/** Report a failed action unless the user cancelled it. */
export function reportError(title: string, err: unknown) {
  if (isCancelled(err)) return;
  const body = errorMessage(err);
  const toast = useApp.getState().toast;
  if (err instanceof AppError && (err.kind === "missing_key" || err.kind === "missing_sidecar")) {
    toast({
      tone: "error",
      title,
      body,
      action: { label: "Open Settings", run: () => useApp.getState().setView("settings") },
    });
    return;
  }
  toast({ tone: "error", title, body });
}

export const jobsFor = (jobs: Record<string, JobState>, pred: (j: JobState) => boolean) => Object.values(jobs).filter(pred);
