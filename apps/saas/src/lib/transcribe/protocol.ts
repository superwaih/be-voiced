/** What the page and the transcription worker say to each other. */

export interface RawWord {
  text: string;
  start: number;
  end: number;
  /** Which speaker said it, when something worked that out. Stable across the recording. */
  speaker?: number;
}

export type ToWorker =
  | {
      type: "start";
      /** 16 kHz mono samples. Transferred, not copied. */
      audio: Float32Array;
      model: string;
      /** "auto" to let the model decide. */
      language: string;
      /** Seconds per window. Progress is reported per window, so this also sets how often. */
      window: number;
      /** Seconds of overlap between windows, split down the middle when stitching. */
      overlap: number;
      /** Work out who is speaking as well as what was said. */
      diarize: boolean;
    }
  | { type: "cancel" };

export type FromWorker =
  | { type: "loading"; progress: number | null; detail: string | null }
  | { type: "progress"; progress: number }
  | { type: "stage"; stage: string }
  | { type: "done"; words: RawWord[]; language: string | null; diarized: boolean }
  | { type: "failed"; message: string }
  | { type: "cancelled" };
