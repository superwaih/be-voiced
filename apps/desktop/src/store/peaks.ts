import { create } from "zustand";

/** Waveform peaks per project, kept out of the project document (they are derived from media). */
export const usePeaks = create<{ byProject: Record<string, Uint8Array | "loading"> }>(() => ({ byProject: {} }));
