import { create } from "zustand";
import { errorMessage, ipc } from "../lib/ipc";
import { projectMeta } from "@be-voiced/engine/project";
import type { Clip, Project } from "@be-voiced/engine/types";
import { useApp } from "./app";
import { usePeaks } from "./peaks";

interface UpdateOptions {
  /** false for bookkeeping (exports, playhead, derived media) that should not be undoable. */
  history?: boolean;
  /** Consecutive updates with the same key within a short window collapse into one undo step. */
  coalesce?: string;
}

interface ProjectStore {
  project: Project | null;
  past: Project[];
  future: Project[];
  saving: boolean;
  saveError: string | null;
  lastSavedAt: number | null;

  open: (project: Project) => void;
  close: () => Promise<void>;
  update: (fn: (p: Project) => Project, opts?: UpdateOptions) => void;
  updateClip: (clipId: string, patch: Partial<Clip> | ((c: Clip) => Partial<Clip>), opts?: UpdateOptions) => void;
  undo: () => void;
  redo: () => void;
  flush: () => Promise<void>;
}

const HISTORY_LIMIT = 120;
let lastCoalesce: { key: string; at: number } | null = null;
let saveTimer: number | undefined;

export const useProject = create<ProjectStore>((set, get) => ({
  project: null,
  past: [],
  future: [],
  saving: false,
  saveError: null,
  lastSavedAt: null,

  open: (project) => {
    lastCoalesce = null;
    set({ project, past: [], future: [], saveError: null });
    void useApp.getState().updateSettings({ lastProjectId: project.id });
  },

  close: async () => {
    await get().flush();
    set({ project: null, past: [], future: [] });
    void useApp.getState().updateSettings({ lastProjectId: null });
  },

  update: (fn, opts = {}) => {
    const current = get().project;
    if (!current) return;
    const next = { ...fn(current), updatedAt: new Date().toISOString() };
    if (opts.history === false) {
      set({ project: next });
    } else {
      const now = Date.now();
      const merge = opts.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < 900;
      lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
      set((s) => ({
        project: next,
        past: merge ? s.past : [...s.past.slice(-HISTORY_LIMIT), current],
        future: [],
      }));
    }
    scheduleSave();
  },

  updateClip: (clipId, patch, opts) => {
    get().update(
      (p) => ({
        ...p,
        clips: p.clips.map((c) =>
          c.id === clipId ? { ...c, ...(typeof patch === "function" ? patch(c) : patch), updatedAt: new Date().toISOString() } : c,
        ),
      }),
      opts,
    );
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length || !project) return;
    const prev = past[past.length - 1];
    lastCoalesce = null;
    // Bookkeeping that happened since (exports, preview proxy) survives undo.
    const restored = { ...prev, previewPath: project.previewPath, ui: project.ui, clips: carryExports(prev.clips, project.clips) };
    set({ project: restored, past: past.slice(0, -1), future: [project, ...future] });
    scheduleSave();
  },

  redo: () => {
    const { past, project, future } = get();
    if (!future.length || !project) return;
    const next = future[0];
    lastCoalesce = null;
    const restored = { ...next, previewPath: project.previewPath, ui: project.ui, clips: carryExports(next.clips, project.clips) };
    set({ project: restored, past: [...past, project], future: future.slice(1) });
    scheduleSave();
  },

  flush: async () => {
    window.clearTimeout(saveTimer);
    await save();
  },
}));

function carryExports(target: Clip[], source: Clip[]): Clip[] {
  const exportsById = new Map(source.map((c) => [c.id, c.exports]));
  return target.map((c) => (exportsById.has(c.id) ? { ...c, exports: exportsById.get(c.id)! } : c));
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 700);
}

let saving: Promise<void> | null = null;

async function save() {
  const project = useProject.getState().project;
  if (!project) return;
  if (saving) await saving;
  const peaks = usePeaks.getState().byProject[project.id];
  const previous = useApp.getState().library.find((m) => m.id === project.id);
  const meta = projectMeta(project, peaks instanceof Uint8Array ? peaks : null, previous);
  useProject.setState({ saving: true });
  saving = ipc
    .saveProject(project, meta)
    .then(() => {
      useProject.setState({ saveError: null, lastSavedAt: Date.now() });
      useApp.getState().upsertMeta(meta);
    })
    .catch((err) => {
      useProject.setState({ saveError: errorMessage(err) });
    })
    .finally(() => {
      useProject.setState({ saving: false });
      saving = null;
    });
  await saving;
}

export const selectClip = (clipId: string | null) => (s: ProjectStore) =>
  clipId ? s.project?.clips.find((c) => c.id === clipId) ?? null : null;
