/**
 * The quality settings, and the models behind them.
 *
 * Named for what someone is choosing — how careful, how long to wait — rather than for a file.
 * The `_timestamped` variants carry the alignment heads that give word-level timings, which this
 * app needs everywhere: the transcript follows playback word by word, captions highlight the word
 * being said, and a clip snaps to word boundaries.
 */

export interface Quality {
  id: string;
  label: string;
  /** What it downloads the first time, measured. Cached by the browser afterwards. */
  size: string;
  note: string;
  model: string;
  englishOnly: boolean;
}

/**
 * The runtime itself, downloaded once however many qualities are used.
 *
 * Worth saying out loud somewhere, because the first transcription of all pays for it and no
 * later one does.
 */
export const RUNTIME_SIZE = "about 26 MB";

export const QUALITIES: Quality[] = [
  {
    id: "base",
    label: "Standard",
    size: "about 75 MB",
    note: "Good quality and the quickest. Right for clear speech and interviews.",
    model: "onnx-community/whisper-base_timestamped",
    englishOnly: false,
  },
  {
    id: "small",
    label: "Careful",
    size: "about 240 MB",
    note: "More accurate with accents, crosstalk and difficult audio. Takes noticeably longer.",
    model: "onnx-community/whisper-small_timestamped",
    englishOnly: false,
  },
];

export const qualityFor = (id: string): Quality => QUALITIES.find((q) => q.id === id) ?? QUALITIES[0];
