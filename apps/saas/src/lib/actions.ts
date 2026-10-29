"use client";

/**
 * The things a person can do, as functions.
 *
 * Screens call these; they talk to `api` and the stores and report their own failures. Keeping them
 * out of components means the same action can be started from the three or four places that offer
 * it without any of them knowing how it works.
 */

import { api, errorMessage, isCancelled, reportJobProgress } from "@/lib/api";
import { buildAss, groupCaptions, toSrt, toVtt, transcriptSubtitles, transcriptText } from "@/lib/engine/captions";
import { safeFileName } from "@/lib/engine/format";
import { findMoments as findMomentsLocal } from "@/lib/engine/moments";
import { applyAnalysis, newClip, newProject, projectMeta, suggestionCount } from "@/lib/engine/project";
import { buildUnits, flattenWords, snapToSentences, wordsInRange } from "@/lib/engine/transcript";
import type { Clip, ExportKind, ExportRecord, LinkInfo, Project, Resolution } from "@/lib/engine/types";
import { fileFor, pickFiles } from "@/lib/files";
import { fetchLink, LinkCancelled, probeLink } from "@/lib/links";
import { RenderCancelled, renderCaptionedVideo } from "@/lib/render";
import { reportError, useApp } from "@/store/app";
import { usePeaks } from "@/store/peaks";
import { useProject } from "@/store/project";

export const MEDIA_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "mp3", "wav", "m4a"];

// --- Waveform -------------------------------------------------------------------------------

export async function ensurePeaks(project: Project) {
  const current = usePeaks.getState().byProject[project.id];
  if (current) return;
  usePeaks.setState((s) => ({ byProject: { ...s.byProject, [project.id]: "loading" } }));
  try {
    let peaks = await api.loadPeaks(project.id);
    if (!peaks) {
      peaks = await useApp
        .getState()
        .runJob({ kind: "peaks", label: "Waveform", projectId: project.id }, (jobId) =>
          api.generatePeaks({ jobId, projectId: project.id, sourcePath: project.source.path }),
        );
    }
    usePeaks.setState((s) => ({ byProject: { ...s.byProject, [project.id]: Uint8Array.from(peaks) } }));
    // Refresh the library summary so recording tiles get their waveform art.
    const meta = useApp.getState().library.find((m) => m.id === project.id);
    if (useProject.getState().project?.id === project.id && !meta?.wave) void useProject.getState().flush();
  } catch (err) {
    usePeaks.setState((s) => {
      const byProject = { ...s.byProject };
      delete byProject[project.id];
      return { byProject };
    });
    if (!isCancelled(err)) console.warn("waveform unavailable", err);
  }
}

// --- Bringing a recording in ------------------------------------------------------------------

/** Opens the file picker and returns the chosen file's key, or null if nothing was chosen. */
export async function pickMediaFile(): Promise<string | null> {
  const picked = await pickFiles({ accept: MEDIA_EXTENSIONS.map((e) => `.${e}`).join(",") });
  return picked[0] ?? null;
}

/** Reads a chosen file and makes a recording of it. Returns its id. */
export async function importFile(path: string): Promise<string | null> {
  const app = useApp.getState();
  try {
    const imported = await app.runJob({ kind: "import", label: "Importing", stage: "Reading media" }, () => api.importMedia(path));
    const project = newProject(imported);
    await useProject.getState().close();
    useProject.getState().open(project);
    await useProject.getState().flush();
    void ensurePeaks(project);
    return project.id;
  } catch (err) {
    reportError("Could not import that file", err);
    return null;
  }
}

/**
 * Brings a link in: probe, download through the server, then the ordinary import.
 *
 * Returns the new recording's id, or null when it failed or was cancelled. The caller shows the
 * reason next to the link box rather than in a toast, because a download that stops needs to say
 * why somewhere that stays put.
 */
export type LinkResult = { ok: true; id: string } | { ok: false; error: string; cancelled: boolean };

export async function importLink(url: string, probed?: LinkInfo | null): Promise<LinkResult> {
  const app = useApp.getState();
  try {
    const info = probed ?? (await probeLink(url));
    if (info.isLive) {
      return { ok: false, error: "That is a live stream, which has no end to transcribe.", cancelled: false };
    }

    const path = await app.runJob(
      { kind: "import", label: info.title || "Downloading", stage: "Downloading" },
      (jobId) => {
        const abort = new AbortController();
        const watch = window.setInterval(() => {
          if (!useApp.getState().jobs[jobId]) abort.abort();
        }, 150);
        return fetchLink(
          info,
          (p) => reportJobProgress(jobId, "Downloading", p.progress, p.detail),
          abort.signal,
        ).finally(() => window.clearInterval(watch));
      },
    );

    const imported = await app.runJob({ kind: "import", label: "Importing", stage: "Reading media" }, () =>
      api.importMedia(path),
    );
    const base = newProject(imported);
    const project: Project = {
      ...base,
      name: (info.title || base.name).slice(0, 120),
      link: info,
    };
    await useProject.getState().close();
    useProject.getState().open(project);
    await useProject.getState().flush();
    void ensurePeaks(project);
    return { ok: true, id: project.id };
  } catch (err) {
    if (err instanceof LinkCancelled || isCancelled(err)) {
      return { ok: false, error: "Cancelled", cancelled: true };
    }
    return { ok: false, error: errorMessage(err), cancelled: false };
  }
}

/** Picks a file and imports it, which is what every "Import recording" button does. */
export async function chooseAndImport(): Promise<string | null> {
  const path = await pickMediaFile();
  return path ? importFile(path) : null;
}

/** Makes a recording current without changing screens. */
export async function loadProject(id: string): Promise<boolean> {
  const store = useProject.getState();
  if (store.project?.id === id) return true;
  try {
    const project = await api.loadProject(id);
    await store.close();
    useProject.getState().open(project);
    void ensurePeaks(project);
    return true;
  } catch (err) {
    reportError("Could not open that recording", err);
    return false;
  }
}

/**
 * Removes the recording: its transcript, moments, clips, captions and export history.
 *
 * The file itself is the browser's, and conversations about it stay in Ask history.
 */
export async function deleteProject(id: string) {
  const app = useApp.getState();
  const name = app.library.find((m) => m.id === id)?.name ?? "Recording";
  try {
    if (useProject.getState().project?.id === id) {
      // Let any pending save land first, then drop it so nothing writes the record back.
      await useProject.getState().flush();
      useProject.setState({ project: null, past: [], future: [] });
    }
    await api.deleteProject(id);
    app.removeMeta(id);
    usePeaks.setState((s) => {
      const byProject = { ...s.byProject };
      delete byProject[id];
      return { byProject };
    });
    app.toast({ tone: "neutral", title: `Deleted ${name}` });
  } catch (err) {
    reportError("Could not delete that recording", err);
  } finally {
    useApp.getState().askDelete(null);
  }
}

/** Points a recording at a file again, after a reload lost the browser's handle on it. */
export async function relinkSource() {
  const project = useProject.getState().project;
  if (!project) return;
  const path = await pickMediaFile();
  if (!path) return;
  try {
    const media = await api.relinkSource(path);
    if (Math.abs(media.duration - project.source.duration) > 2) {
      useApp.getState().toast({
        tone: "neutral",
        title: "Durations differ",
        body: "The new file is a different length, so transcript timings may not line up.",
      });
    }
    useProject.getState().update((p) => ({ ...p, source: media, previewPath: null }), { history: false });
    const meta = useApp.getState().library.find((m) => m.id === project.id);
    if (meta) useApp.getState().upsertMeta({ ...meta, sourceMissing: false });
  } catch (err) {
    reportError("Could not relink that file", err);
  }
}

// --- Transcribe -------------------------------------------------------------------------------

export async function transcribe(): Promise<boolean> {
  const project = useProject.getState().project;
  if (!project) return false;
  const { settings, runJob } = useApp.getState();
  try {
    const transcript = await runJob(
      { kind: "transcribe", label: "Transcribing", projectId: project.id, stage: "Preparing audio" },
      (jobId) =>
        api.transcribe({
          jobId,
          projectId: project.id,
          sourcePath: project.source.path,
          duration: project.source.duration,
          model: settings.whisperModel,
          language: settings.whisperLanguage,
        }),
    );
    const store = useProject.getState();
    if (store.project?.id !== project.id) {
      // Someone switched recordings while this ran: write it into the one it belongs to.
      const stored = await api.loadProject(project.id);
      const next = { ...stored, transcript, topics: [], analysis: null, updatedAt: new Date().toISOString() };
      await api.saveProject(next, projectMeta(next, null, useApp.getState().library.find((m) => m.id === project.id)));
      await useApp.getState().refreshLibrary();
    } else {
      store.update((p) => ({
        ...p,
        transcript,
        topics: [],
        analysis: null,
        clips: p.clips.filter((c) => c.status !== "suggested"),
      }));
    }
    useApp.getState().toast({
      tone: "success",
      title: "Transcript ready",
      body: `${transcript.speakers.length} ${transcript.speakers.length === 1 ? "speaker" : "speakers"} detected.`,
    });
    return true;
  } catch (err) {
    if (!isCancelled(err)) reportError("Transcription failed", err);
    return false;
  }
}

// --- Moments ----------------------------------------------------------------------------------

export async function findMoments(mode: "initial" | "more", focus: string | null = null) {
  const project = useProject.getState().project;
  if (!project?.transcript) return;
  const transcript = project.transcript;
  const app = useApp.getState();
  const existing = project.clips
    .filter((c) => (mode === "more" ? true : c.status !== "suggested"))
    .map((c) => ({ start: c.start, end: c.end }));
  try {
    const result = await app.runJob(
      {
        kind: "analyze",
        label: mode === "initial" ? "Finding moments" : "Finding more moments",
        projectId: project.id,
        stage: "Reading the transcript",
      },
      async () => {
        // Let the progress state paint before the scoring pass on a long transcript.
        await new Promise((r) => setTimeout(r, 30));
        return findMomentsLocal(transcript, {
          count: mode === "initial" ? suggestionCount(project.source.duration) : 5,
          existing,
          focus,
          intel: null,
          duration: project.source.duration,
        });
      },
    );
    const store = useProject.getState();
    if (store.project?.id !== project.id) return;
    store.update((p) => {
      const next = applyAnalysis(p, result, mode);
      // A follow-up run keeps the first run's topics unless it found none of its own.
      return mode === "more" && !p.topics.length ? { ...next, topics: applyAnalysis(p, result, "initial").topics } : next;
    });
    const n = result.highlights.length;
    app.toast({
      tone: n ? "success" : "neutral",
      title: n ? `${n} ${n === 1 ? "moment" : "moments"} found` : "No new moments",
      body: n ? undefined : "Nothing else stands out on its own. Try asking for something specific.",
    });
  } catch (err) {
    reportError("Could not find moments", err);
  }
}

/** Turns a selection in the transcript into a clip, snapped to whole sentences. */
export function clipFromSelection(start: number, end: number, snap = true) {
  const store = useProject.getState();
  const project = store.project;
  if (!project?.transcript) return null;
  const units = buildUnits(project.transcript);
  const range = snap ? snapToSentences(units, start, end) : { start, end };
  const words = wordsInRange(flattenWords(project.transcript), range.start, range.end);
  const preview = words
    .slice(0, 8)
    .map((w) => w.text)
    .join(" ")
    .replace(/[.,;:!?]+$/, "");
  const clip = newClip(project, {
    title: preview ? `${preview}${words.length > 8 ? "..." : ""}` : "New clip",
    start: range.start,
    end: range.end,
  });
  store.update((p) => ({ ...p, clips: [...p.clips, clip] }));
  return clip;
}

// --- Exports ----------------------------------------------------------------------------------

function record(kind: ExportKind, path: string, extra: Partial<ExportRecord> = {}): ExportRecord {
  return { id: crypto.randomUUID(), kind, path, createdAt: new Date().toISOString(), ...extra };
}

export async function exportClipCaptions(clip: Clip, format: "srt" | "vtt") {
  const project = useProject.getState().project;
  if (!project?.transcript) return;
  const words = wordsInRange(flattenWords(project.transcript), clip.start, clip.end);
  const groups = groupCaptions(words, clip.captions.wordsPerCaption, clip.start);
  const name = `${safeFileName(clip.title)}.${format}`;
  try {
    await api.saveTextFile(name, format === "srt" ? toSrt(groups, clip.captions) : toVtt(groups, clip.captions));
    useProject
      .getState()
      .updateClip(clip.id, (c) => ({ exports: [...c.exports, record(format, name)] }), { history: false });
    useApp.getState().toast({ tone: "success", title: `${format.toUpperCase()} downloaded`, body: name });
  } catch (err) {
    reportError("Could not save those captions", err);
  }
}

export async function exportTranscript(format: "txt" | "srt" | "vtt") {
  const project = useProject.getState().project;
  if (!project?.transcript) return;
  const name = `${safeFileName(project.name)} transcript.${format}`;
  const contents =
    format === "txt" ? transcriptText(project.transcript, project.name) : transcriptSubtitles(project.transcript, format);
  try {
    await api.saveTextFile(name, contents);
    useProject
      .getState()
      .update((p) => ({ ...p, transcriptExports: [...p.transcriptExports, record(`transcript-${format}` as ExportKind, name)] }), {
        history: false,
      });
    useApp.getState().toast({ tone: "success", title: "Transcript downloaded", body: name });
  } catch (err) {
    reportError("Could not save that transcript", err);
  }
}

/**
 * Burns the captions into the picture and hands back an MP4.
 *
 * This runs on the graphics card through WebCodecs, in this browser — see `lib/render` for why
 * ffmpeg.wasm cannot do it. Long recordings take a while, so it runs as a job like any other:
 * progress in the tray, and a Cancel that stops it.
 */
export async function exportClipVideo(clip: Clip, opts: { burnCaptions: boolean; resolution: Resolution }) {
  const project = useProject.getState().project;
  if (!project) return null;

  const file = fileFor(project.source.path);
  if (!file) {
    reportError("Cannot export", new Error("That file is no longer open in this browser. Choose it again."));
    return null;
  }

  const { width, height } = outputFrame(project, clip.aspect, opts.resolution);
  const name = `${safeFileName(clip.title || project.name)}.mp4`;

  try {
    const blob = await useApp.getState().runJob(
      { kind: "export", label: `Rendering "${clip.title}"`, projectId: project.id, clipId: clip.id, stage: "Preparing" },
      (jobId) => {
        const abort = new AbortController();
        const watch = window.setInterval(() => {
          if (!useApp.getState().jobs[jobId]) abort.abort();
        }, 150);
        return renderCaptionedVideo({
          file,
          words: flattenWords(project.transcript),
          style: clip.captions,
          start: clip.start,
          end: clip.end,
          width,
          height,
          framing: clip.framing,
          captionsEnabled: opts.burnCaptions,
          signal: abort.signal,
          onProgress: (p) =>
            reportJobProgress(jobId, p.stage, p.progress, `${width}×${height}`),
        }).finally(() => window.clearInterval(watch));
      },
    );

    await api.saveFile(name, blob);
    const rec = record("captioned", name, { aspect: clip.aspect, resolution: opts.resolution, bytes: blob.size });
    useProject.getState().updateClip(clip.id, (c) => ({ exports: [...c.exports, rec] }), { history: false });
    useApp.getState().toast({
      tone: "success",
      title: "Video downloaded",
      body: `${name}, ${(blob.size / 1_048_576).toFixed(1)} MB`,
    });
    return rec;
  } catch (err) {
    if (err instanceof RenderCancelled) return null;
    reportError("Could not render that video", err);
    return null;
  }
}

/** The subtitle track as libass reads it, for a server-side render when there is one. */
export function clipAss(clip: Clip, project: Project, resolution: Resolution): string | null {
  const words = wordsInRange(flattenWords(project.transcript), clip.start, clip.end);
  if (!words.length) return null;
  const { width, height } = outputFrame(project, clip.aspect, resolution);
  return buildAss(groupCaptions(words, clip.captions.wordsPerCaption, clip.start), clip.captions, width, height);
}

/** Mirrors the worker's output size, so captions are laid out on the frame they will be drawn on. */
export function outputFrame(project: Project, aspect: Clip["aspect"], res: Resolution) {
  const even = (v: number) => {
    const r = Math.round(v);
    return Math.max(2, r + (r % 2));
  };
  const effective = !project.source.hasVideo && aspect === "original" ? "16:9" : aspect;
  switch (effective) {
    case "16:9":
      return { width: even((res * 16) / 9), height: even(res) };
    case "9:16":
      return { width: even(res), height: even((res * 16) / 9) };
    case "1:1":
      return { width: even(res), height: even(res) };
    case "4:5":
      return { width: even(res), height: even((res * 5) / 4) };
    default: {
      const w = project.source.width ?? 1920;
      const h = project.source.height ?? 1080;
      const ar = w / h;
      return ar >= 1 ? { width: even(res * ar), height: even(res) } : { width: even(res), height: even(res / ar) };
    }
  }
}

export { errorMessage, isCancelled };
