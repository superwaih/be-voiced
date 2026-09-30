import { open, save } from "@tauri-apps/plugin-dialog";
import { reportError, useApp } from "../store/app";
import { usePeaks } from "../store/peaks";
import { useProject } from "../store/project";
import { buildAss, groupCaptions, toSrt, toVtt, transcriptSubtitles, transcriptText } from "./captions";
import { joinPath, safeFileName } from "./format";
import { errorMessage, ipc, isCancelled } from "./ipc";
import { findMoments as findMomentsLocal } from "./moments";
import { applyAnalysis, newClip, newProject, projectMeta, suggestionCount } from "./project";
import { buildUnits, flattenWords, snapToSentences, wordsInRange } from "./transcript";
import type { Clip, ExportKind, ExportRecord, Project, Resolution, TextIntelligence } from "./types";

export const MEDIA_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "mp3", "wav", "m4a"];

// --- Waveform peaks ----------------------------------------------------------------------------

export { usePeaks };

export async function ensurePeaks(project: Project) {
  const current = usePeaks.getState().byProject[project.id];
  if (current) return;
  usePeaks.setState((s) => ({ byProject: { ...s.byProject, [project.id]: "loading" } }));
  try {
    let peaks = await ipc.loadPeaks(project.id);
    if (!peaks) {
      peaks = await useApp.getState().runJob(
        { kind: "peaks", label: "Waveform", projectId: project.id },
        (jobId) =>
          ipc.generatePeaks({ jobId, projectId: project.id, sourcePath: project.source.path, duration: project.source.duration }),
      );
    }
    usePeaks.setState((s) => ({ byProject: { ...s.byProject, [project.id]: Uint8Array.from(peaks!) } }));
    // Refresh the library summary so project and clip tiles get waveform art.
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

// --- Import & open ---------------------------------------------------------------------------

export async function pickMediaFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Video or audio", extensions: MEDIA_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function importFile(path: string) {
  const app = useApp.getState();
  try {
    const imported = await app.runJob({ kind: "import", label: "Importing", stage: "Reading media" }, () => ipc.importMedia(path));
    const project = newProject(imported);
    await useProject.getState().close();
    useProject.getState().open(project);
    await useProject.getState().flush();
    app.setView("project");
    void ensurePeaks(project);
  } catch (err) {
    reportError("Could not import that file", err);
  }
}

export async function openProject(id: string, target?: { view: "workspace" | "editor"; clipId?: string }) {
  const app = useApp.getState();
  const store = useProject.getState();
  if (store.project?.id === id) {
    if (target) store.update((p) => ({ ...p, ui: { ...p.ui, view: target.view, clipId: target.clipId ?? null } }), { history: false });
    app.setView("project");
    return;
  }
  try {
    const project = await ipc.loadProject(id);
    await store.close();
    const next = target ? { ...project, ui: { ...project.ui, view: target.view, clipId: target.clipId ?? null } } : project;
    useProject.getState().open(next);
    app.setView("project");
    void ensurePeaks(next);
  } catch (err) {
    reportError("Could not open project", err);
  }
}

/**
 * Removes the project folder in app data: transcript, moments, clips, captions and export history.
 * The imported recording and any files already exported are left where they are.
 */
export async function deleteProject(id: string) {
  const app = useApp.getState();
  const name = app.library.find((m) => m.id === id)?.name ?? "Project";
  try {
    if (useProject.getState().project?.id === id) {
      // Let any pending autosave land first, then drop the project so nothing writes the folder back.
      await useProject.getState().flush();
      useProject.setState({ project: null, past: [], future: [] });
      void app.updateSettings({ lastProjectId: null });
      if (app.view === "project") app.setView("projects");
    }
    await ipc.deleteProject(id);
    app.removeMeta(id);
    usePeaks.setState((s) => {
      const byProject = { ...s.byProject };
      delete byProject[id];
      return { byProject };
    });
    app.toast({ tone: "neutral", title: `Deleted ${name}`, body: "Your recording is still on disk." });
  } catch (err) {
    reportError("Could not delete project", err);
  } finally {
    useApp.getState().askDelete(null);
  }
}

export async function relinkSource() {
  const project = useProject.getState().project;
  if (!project) return;
  const path = await pickMediaFile();
  if (!path) return;
  try {
    const media = await ipc.relinkSource(path);
    if (Math.abs(media.duration - project.source.duration) > 2) {
      useApp.getState().toast({
        tone: "neutral",
        title: "Durations differ",
        body: "The new file is a different length, so transcript timings may not line up.",
      });
    }
    useProject.getState().update((p) => ({ ...p, source: media, previewPath: null }), { history: false });
    useApp.getState().upsertMeta({ ...useApp.getState().library.find((m) => m.id === project.id)!, sourceMissing: false });
  } catch (err) {
    reportError("Could not relink the source", err);
  }
}

export async function createPreview() {
  const project = useProject.getState().project;
  if (!project) return;
  try {
    const path = await useApp.getState().runJob(
      { kind: "proxy", label: "Preview copy", projectId: project.id },
      (jobId) => ipc.createPreviewProxy({ jobId, projectId: project.id, sourcePath: project.source.path, duration: project.source.duration }),
    );
    useProject.getState().update((p) => ({ ...p, previewPath: path }), { history: false });
  } catch (err) {
    reportError("Could not create a preview copy", err);
  }
}

// --- Transcribe ------------------------------------------------------------------------------

export async function transcribe(engine: "local" | "cloud") {
  const project = useProject.getState().project;
  if (!project) return;
  const { settings, runJob } = useApp.getState();
  try {
    const transcript = await runJob(
      {
        kind: "transcribe",
        label: engine === "local" ? "Transcribing locally" : "Transcribing with Deepgram",
        projectId: project.id,
        stage: "Preparing audio",
      },
      (jobId) =>
        ipc.transcribe({
          jobId,
          projectId: project.id,
          sourcePath: project.source.path,
          duration: project.source.duration,
          engine,
          whisperModel: settings.whisperModel,
          language: engine === "local" ? settings.whisperLanguage : settings.deepgramLanguage,
        }),
    );
    const store = useProject.getState();
    if (store.project?.id !== project.id) {
      // User switched projects while this ran: persist into the original project file.
      const stored = await ipc.loadProject(project.id);
      const next = { ...stored, transcript, topics: [], analysis: null, updatedAt: new Date().toISOString() };
      await ipc.saveProject(next, projectMeta(next, null, useApp.getState().library.find((m) => m.id === project.id)));
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
      body: transcript.diarized
        ? `${transcript.speakers.length} speakers detected.`
        : "Local transcripts have one speaker label. Reassign turns from the transcript.",
    });
  } catch (err) {
    reportError("Transcription failed", err);
  }
}

// --- Find moments ----------------------------------------------------------------------------

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
      { kind: "analyze", label: mode === "initial" ? "Finding moments" : "Finding more moments", projectId: project.id, stage: "Reading the transcript" },
      async (jobId) => {
        // Deepgram topics, intents and sentiment sharpen the result when a key is saved.
        // They are cached on the transcript so "find more" does not call Deepgram again.
        let intel = intelCache.get(transcript) ?? null;
        const language = transcript.language ?? "en";
        if (!intel && app.keys.deepgram && (language.startsWith("en") || language === "multi")) {
          try {
            intel = await ipc.analyzeText({ jobId, text: flattenWords(transcript).map((w) => w.text).join(" "), language });
            if (intel) intelCache.set(transcript, intel);
          } catch (err) {
            if (isCancelled(err)) throw err;
            app.toast({ tone: "neutral", title: "Topics unavailable", body: `Finding moments from the transcript alone. ${errorMessage(err)}` });
          }
        }
        // Yield so the progress state paints before the scoring pass on long transcripts.
        await new Promise((r) => setTimeout(r, 30));
        return findMomentsLocal(transcript, {
          count: mode === "initial" ? suggestionCount(project.source.duration) : 5,
          existing,
          focus,
          intel,
          duration: project.source.duration,
        });
      },
    );
    const store = useProject.getState();
    if (store.project?.id !== project.id) return;
    store.update((p) => {
      const next = applyAnalysis(p, result, mode);
      // A follow-up run keeps topics from the first run unless it produced none.
      return mode === "more" && !p.topics.length ? { ...next, topics: applyAnalysis(p, result, "initial").topics } : next;
    });
    const n = result.highlights.length;
    app.toast({
      tone: n ? "success" : "neutral",
      title: n ? `${n} ${n === 1 ? "moment" : "moments"} found` : "No new moments",
      body: n ? undefined : "Nothing else stands out enough on its own. Try asking for something specific.",
    });
  } catch (err) {
    reportError("Could not find moments", err);
  }
}

const intelCache = new WeakMap<object, TextIntelligence>();

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

// --- Export ----------------------------------------------------------------------------------

function record(kind: ExportKind, path: string, extra: Partial<ExportRecord> = {}): ExportRecord {
  return { id: crypto.randomUUID(), kind, path, createdAt: new Date().toISOString(), ...extra };
}

async function exportDir(): Promise<string> {
  const { settings } = useApp.getState();
  return settings.exportDir ?? (await ipc.defaultExportDir());
}

async function uniquePath(dir: string, base: string, ext: string) {
  let candidate = joinPath(dir, `${base}.${ext}`);
  for (let i = 2; await ipc.pathExists(candidate); i++) candidate = joinPath(dir, `${base} (${i}).${ext}`);
  return candidate;
}

export async function exportClipVideo(clip: Clip, opts: { burnCaptions: boolean; resolution: Resolution; fileName: string }) {
  const project = useProject.getState().project;
  if (!project) return null;
  const dir = await exportDir();
  const outputPath = await uniquePath(dir, safeFileName(opts.fileName), "mp4");
  const words = wordsInRange(flattenWords(project.transcript), clip.start, clip.end);

  let ass: string | null = null;
  if (opts.burnCaptions && words.length) {
    const { width, height } = outputFrame(project, clip.aspect, opts.resolution);
    ass = buildAss(groupCaptions(words, clip.captions.wordsPerCaption, clip.start), clip.captions, width, height);
  }

  try {
    const result = await useApp.getState().runJob(
      { kind: "export", label: `Exporting "${clip.title}"`, projectId: project.id, clipId: clip.id, stage: "Rendering" },
      (jobId) =>
        ipc.exportClip({
          jobId,
          projectId: project.id,
          sourcePath: project.source.path,
          outputPath,
          start: clip.start,
          end: clip.end,
          aspect: clip.aspect,
          resolution: opts.resolution,
          framing: clip.framing,
          hasVideo: project.source.hasVideo,
          sourceWidth: project.source.width,
          sourceHeight: project.source.height,
          background: "#14131A",
          ass,
        }),
    );
    const rec = record(ass ? "captioned" : "clip", result.path, { aspect: clip.aspect, resolution: opts.resolution, bytes: result.bytes });
    addExportRecord(project.id, clip.id, rec);
    useApp.getState().toast({
      tone: "success",
      title: "Export finished",
      body: result.path,
      action: { label: "Show in folder", run: () => void ipc.revealPath(result.path) },
    });
    return rec;
  } catch (err) {
    reportError("Export failed", err);
    return null;
  }
}

function addExportRecord(projectId: string, clipId: string, rec: ExportRecord) {
  const store = useProject.getState();
  if (store.project?.id === projectId) {
    store.updateClip(clipId, (c) => ({ exports: [...c.exports, rec], status: c.status === "suggested" ? "saved" : c.status }), {
      history: false,
    });
  }
}

export async function exportClipCaptions(clip: Clip, format: "srt" | "vtt") {
  const project = useProject.getState().project;
  if (!project?.transcript) return;
  const words = wordsInRange(flattenWords(project.transcript), clip.start, clip.end);
  const groups = groupCaptions(words, clip.captions.wordsPerCaption, clip.start);
  const path = await save({
    defaultPath: joinPath(await exportDir(), `${safeFileName(clip.title)}.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return;
  try {
    await ipc.writeTextFile(path, format === "srt" ? toSrt(groups, clip.captions) : toVtt(groups, clip.captions));
    addExportRecord(project.id, clip.id, record(format, path));
    useApp.getState().toast({ tone: "success", title: `${format.toUpperCase()} saved`, body: path });
  } catch (err) {
    reportError("Could not save captions", err);
  }
}

export async function exportTranscript(format: "txt" | "srt" | "vtt") {
  const project = useProject.getState().project;
  if (!project?.transcript) return;
  const path = await save({
    defaultPath: joinPath(await exportDir(), `${safeFileName(project.name)} transcript.${format}`),
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return;
  const contents =
    format === "txt" ? transcriptText(project.transcript, project.name) : transcriptSubtitles(project.transcript, format);
  try {
    await ipc.writeTextFile(path, contents);
    useProject
      .getState()
      .update((p) => ({ ...p, transcriptExports: [...p.transcriptExports, record(`transcript-${format}` as ExportKind, path)] }), {
        history: false,
      });
    useApp.getState().toast({
      tone: "success",
      title: "Transcript saved",
      body: path,
      action: { label: "Show in folder", run: () => void ipc.revealPath(path) },
    });
  } catch (err) {
    reportError("Could not save transcript", err);
  }
}

/** Mirrors `output_size` in export.rs so captions are laid out on the real render size. */
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
