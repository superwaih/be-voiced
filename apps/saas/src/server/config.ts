import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the server's media tools live.
 *
 * Three places, in order: an explicit environment variable, a `bin/` folder beside the app, then
 * whatever is on PATH. The first is for deployment, the second for a developer who ran the setup
 * script, the third for a machine that already has ffmpeg installed.
 */
function find(envVar: string, name: string): string {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;

  const ext = process.platform === "win32" ? ".exe" : "";
  const local = join(process.cwd(), "bin", `${name}${ext}`);
  if (existsSync(local)) return local;

  return name;
}

export const ffmpeg = () => find("FFMPEG_PATH", "ffmpeg");
export const whisperCli = () => find("WHISPER_PATH", "whisper-cli");

/** What turns a pasted link into media, for links that are not a direct file or a podcast feed. */
export const ytdlp = () => find("YTDLP_PATH", "yt-dlp");

/**
 * The model file whisper.cpp loads.
 *
 * Nothing is downloaded at request time: a model fetched on a cold start multiplies the cost of
 * every short job. It is baked into the image, or put in `models/` by the setup script.
 */
export function whisperModel(): string {
  const fromEnv = process.env.WHISPER_MODEL_PATH;
  if (fromEnv) return fromEnv;
  const name = process.env.WHISPER_MODEL || "ggml-base.en.bin";
  return join(process.cwd(), "models", name);
}

/** Whether this model was trained to mark speaker turns (whisper.cpp's tinydiarize). */
export const modelMarksSpeakers = () => /tdrz/i.test(whisperModel());

/** How many threads whisper may use. Left to the box unless told otherwise. */
export function threads(): number {
  const fromEnv = Number(process.env.WHISPER_THREADS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  return 4;
}

/** Everything that has to be present before the server can transcribe anything. */
export function serverCanTranscribe(): boolean {
  return existsSync(whisperModel());
}
