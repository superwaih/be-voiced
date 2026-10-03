export interface Word {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface Segment {
  id: string;
  speaker: string;
  start: number;
  end: number;
  words: Word[];
}

export interface Speaker {
  id: string;
  name: string;
}

export interface Transcript {
  engine: "whisper" | "deepgram";
  model: string;
  language: string | null;
  diarized: boolean;
  createdAt: string;
  speakers: Speaker[];
  segments: Segment[];
}

export interface MediaInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
}

export type AspectRatio = "original" | "16:9" | "1:1" | "4:5" | "9:16";
export type Resolution = 720 | 1080;
export type CaptionPosition = "top" | "middle" | "bottom";

export interface CaptionStyle {
  presetId: string;
  font: string;
  /** Pixel size on a 1080px short side; scaled for preview and render. */
  size: number;
  bold: boolean;
  uppercase: boolean;
  color: string;
  activeWord: boolean;
  highlightColor: string;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  shadowColor: string;
  background: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  position: CaptionPosition;
  /** Distance from the top or bottom edge, % of frame height. */
  offset: number;
  wordsPerCaption: number;
}

export type ExportKind = "clip" | "captioned" | "srt" | "vtt" | "transcript-txt" | "transcript-srt" | "transcript-vtt";

export interface ExportRecord {
  id: string;
  kind: ExportKind;
  path: string;
  createdAt: string;
  aspect?: AspectRatio;
  resolution?: Resolution;
  bytes?: number;
}

export type ClipStatus = "suggested" | "saved" | "rejected";

export type HighlightCategory =
  | "opinion"
  | "contrarian"
  | "explanation"
  | "insight"
  | "prediction"
  | "disagreement"
  | "story"
  | "funny"
  | "statistic"
  | "quote"
  | "answer";

export interface Clip {
  id: string;
  origin: "ai" | "manual";
  status: ClipStatus;
  title: string;
  start: number;
  end: number;
  speaker?: string;
  topic?: string;
  category?: HighlightCategory;
  summary?: string;
  why?: string;
  score?: number;
  rank?: number;
  createdAt: string;
  updatedAt: string;
  aspect: AspectRatio;
  resolution: Resolution;
  framing: number;
  captionsEnabled: boolean;
  captions: CaptionStyle;
  exports: ExportRecord[];
}

export interface Topic {
  id: string;
  name: string;
  summary: string;
  ranges: { start: number; end: number }[];
}

export interface Analysis {
  model: string;
  createdAt: string;
  runs: number;
}

/** Where a project came from when it was not a local file. */
export interface LinkInfo {
  resolver: "direct" | "feed" | "yt-dlp";
  mediaUrl: string;
  pageUrl: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  size: number | null;
  isLive: boolean;
  site: string;
}

/** A passage of the transcript an answer is built from. Always carries its place in the recording. */
export interface Citation {
  start: number;
  end: number;
  speaker: string;
  text: string;
  /** Short label for the chip, e.g. the moment title. */
  label?: string;
}

export type AnswerEngine = "local" | "deepgram" | "claude";

export interface ChatMessage {
  id: string;
  role: "you" | "app";
  text: string;
  createdAt: string;
  /** Which approach produced this answer. */
  engine?: AnswerEngine;
  citations?: Citation[];
  /** Shown under the answer when the engine fell back or found little. */
  note?: string;
  pending?: boolean;
}

export type ProjectView = "workspace" | "editor";

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: MediaInfo;
  thumbnailPath: string | null;
  previewPath: string | null;
  transcript: Transcript | null;
  topics: Topic[];
  clips: Clip[];
  analysis: Analysis | null;
  transcriptExports: ExportRecord[];
  /** Set when the project came from a pasted link rather than a local file. */
  link?: LinkInfo | null;
  /** Questions asked about this transcript, kept with the project. */
  chat?: ChatMessage[];
  ui: { view: ProjectView; clipId: string | null; time: number };
}

export interface ClipMeta {
  id: string;
  title: string;
  start: number;
  end: number;
  status: ClipStatus;
  aspect: AspectRatio;
  exportCount: number;
  lastExportPath: string | null;
  updatedAt: string;
  /** 32 values 0..99 drawn from the clip's audio, for cover art. */
  wave?: number[];
  origin?: Clip["origin"];
  category?: HighlightCategory;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sourcePath: string;
  sourceName: string;
  duration: number;
  size: number;
  hasVideo: boolean;
  thumbnailPath: string | null;
  stage: "imported" | "transcribed" | "analyzed";
  engine: Transcript["engine"] | null;
  language: string | null;
  wordCount: number;
  speakerCount: number;
  suggestionCount: number;
  clips: ClipMeta[];
  /** Best unreviewed suggestions, for the Home view. */
  topSuggestions?: ClipMeta[];
  /** 96 values 0..99 across the whole recording, for cover art. */
  wave?: number[];
  /** Opening lines of the transcript, for the reading list. */
  excerpt?: string;
  /** Present when the project came from a pasted link. */
  link?: LinkInfo | null;
  /** Number of questions asked about this transcript. */
  chatCount?: number;
  sourceMissing?: boolean;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  transcriptionMode: "local" | "cloud";
  whisperModel: string;
  whisperLanguage: string;
  deepgramLanguage: string;
  exportDir: string | null;
  lastProjectId: string | null;
}

export interface KeyStatus {
  deepgram: string | null;
}

export interface TextIntelligence {
  topics: { startWord: number; endWord: number; labels: { label: string; confidence: number }[] }[];
  intents: { startWord: number; endWord: number; labels: { label: string; confidence: number }[] }[];
  sentiments: { startWord: number; endWord: number; sentiment: string; score: number }[];
  summary: string | null;
}

export interface SidecarStatus {
  ffmpeg: boolean;
  ffprobe: boolean;
  whisper: boolean;
  ytdlp: boolean;
  folder: string;
}

export interface WhisperModel {
  id: string;
  label: string;
  size: string;
  englishOnly: boolean;
  note: string;
  installed: boolean;
}

export interface ImportedMedia {
  projectId: string;
  projectDir: string;
  media: MediaInfo;
  thumbnailPath: string | null;
}

export interface AnalyzeHighlight {
  title: string;
  startUnit: number;
  endUnit: number;
  start: number;
  end: number;
  speaker: string;
  topic: string;
  category: HighlightCategory;
  summary: string;
  why: string;
  score: number;
}

export interface AnalyzeResult {
  model: string;
  topics: { name: string; summary: string; ranges: { startUnit: number; endUnit: number; start: number; end: number }[] }[];
  highlights: AnalyzeHighlight[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface ExportResult {
  path: string;
  bytes: number;
  width: number;
  height: number;
}

export interface AppErrorPayload {
  kind: "cancelled" | "missing_sidecar" | "missing_key" | "network" | "error";
  message: string;
}
