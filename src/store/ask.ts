import { create } from "zustand";
import { errorMessage, ipc } from "../lib/ipc";
import type { AskEntry, ChatMessage, Project, ProjectMeta } from "../lib/types";
import { useApp } from "./app";

/**
 * Ask history: the conversations, owned by the Ask tab rather than by projects.
 *
 * An entry points at the recording it is about by id and keeps a copy of what that recording was
 * called, so a conversation stays readable after the recording is deleted. Clearing history removes
 * conversations only.
 */
interface AskStore {
  entries: AskEntry[];
  /** The conversation on screen, if the open recording has one. */
  currentId: string | null;

  load: () => Promise<void>;
  /** The entry for a recording, creating one the first time a question is asked about it. */
  entryFor: (projectId: string) => AskEntry | undefined;
  open: (project: Project, meta?: ProjectMeta) => AskEntry;
  addMessage: (entryId: string, message: ChatMessage) => void;
  remove: (entryId: string) => Promise<void>;
  clear: () => Promise<void>;
}

const now = () => new Date().toISOString();

function save(entry: AskEntry) {
  void ipc.saveAskEntry(entry).catch((err) => {
    useApp.getState().toast({ tone: "error", title: "History not saved", body: errorMessage(err) });
  });
}

export const useAsk = create<AskStore>((set, get) => ({
  entries: [],
  currentId: null,

  load: async () => {
    try {
      set({ entries: await ipc.loadAskHistory() });
    } catch {
      // History is a convenience: a tab that cannot read it still works.
      set({ entries: [] });
    }
  },

  entryFor: (projectId) => get().entries.find((e) => e.projectId === projectId),

  open: (project, meta) => {
    const existing = get().entries.find((e) => e.projectId === project.id);
    if (existing) {
      set({ currentId: existing.id });
      return existing;
    }
    const entry: AskEntry = {
      id: crypto.randomUUID(),
      projectId: project.id,
      title: project.name,
      site: project.link?.site ?? null,
      url: project.link?.pageUrl ?? null,
      duration: project.source.duration,
      thumbnailPath: project.thumbnailPath,
      wave: meta?.wave,
      createdAt: now(),
      updatedAt: now(),
      // Conversations held in project.json before history existed come across on first open.
      messages: project.chat ?? [],
    };
    set((s) => ({ entries: [entry, ...s.entries], currentId: entry.id }));
    save(entry);
    return entry;
  },

  addMessage: (entryId, message) => {
    let saved: AskEntry | undefined;
    set((s) => {
      const entries = s.entries.map((e) => {
        if (e.id !== entryId) return e;
        saved = { ...e, messages: [...e.messages, message], updatedAt: now() };
        return saved;
      });
      return { entries };
    });
    if (saved) save(saved);
  },

  remove: async (entryId) => {
    const previous = get().entries;
    set((s) => ({ entries: s.entries.filter((e) => e.id !== entryId), currentId: s.currentId === entryId ? null : s.currentId }));
    try {
      await ipc.deleteAskEntry(entryId);
    } catch (err) {
      set({ entries: previous });
      useApp.getState().toast({ tone: "error", title: "Could not remove that conversation", body: errorMessage(err) });
    }
  },

  clear: async () => {
    const previous = get().entries;
    set({ entries: [], currentId: null });
    try {
      await ipc.clearAskHistory();
      useApp.getState().toast({ tone: "neutral", title: "History cleared", body: "Your recordings are untouched." });
    } catch (err) {
      set({ entries: previous });
      useApp.getState().toast({ tone: "error", title: "Could not clear history", body: errorMessage(err) });
    }
  },
}));
