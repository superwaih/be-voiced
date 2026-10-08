import { ClosedCaptioning, Export, FolderOpen, TextAa, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProjectCover } from "../components/Covers";
import { JobCard } from "../components/JobCard";
import { MediaElement, Waveform } from "../components/media";
import { Button, EmptyState, Field, Segmented, Select, TextInput } from "../components/ui";
import {
  ensurePeaks,
  exportClipCaptions,
  exportClipVideo,
  importFile,
  loadProjectQuietly,
  outputFrame,
  pickMediaFile,
  usePeaks,
} from "../lib/actions";
import { captionAnchor, defaultCaptionStyle } from "@be-voiced/engine/captions";
import { clock, duration, relativeDate, safeFileName } from "@be-voiced/engine/format";
import { player, usePlayerTime } from "../lib/player";
import { flattenWords } from "@be-voiced/engine/transcript";
import type { AspectRatio, CaptionStyle, Clip, ProjectMeta, Project, Resolution } from "@be-voiced/engine/types";
import { useApp } from "../store/app";
import { useProject } from "../store/project";
import { CaptionOverlay } from "./editor/ClipEditor";
import { CaptionsPanel } from "./editor/EditorPanels";
import { Transport } from "./workspace/PlayerPanel";
import { TranscribeModal } from "./workspace/TranscribeModal";

const FRAMES: { value: AspectRatio; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "9:16", label: "9:16" },
];

/**
 * The whole recording as one clip. The render pipeline is written in terms of clips, so captioning a
 * full video is the same job with the handles pushed to the ends; nothing is stored under the
 * project's own clips, which belong to the moment finder.
 */
function wholeVideo(project: Project, style: CaptionStyle, aspect: AspectRatio, framing: number, enabled: boolean): Clip {
  const t = new Date().toISOString();
  return {
    id: "captions",
    origin: "manual",
    status: "saved",
    title: project.name,
    start: 0,
    end: project.source.duration,
    createdAt: t,
    updatedAt: t,
    aspect,
    resolution: 1080,
    framing,
    captionsEnabled: enabled,
    captions: style,
    exports: [],
  };
}

/** The video at its export shape, with the subtitles drawn over it exactly as they will burn in. */
function CaptionStage({ clip, enabled, onMove }: { clip: Clip; enabled: boolean; onMove: (x: number, y: number) => void }) {
  const project = useProject((s) => s.project)!;
  const words = useMemo(() => flattenWords(project.transcript), [project.transcript]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const frame = outputFrame(project, clip.aspect, 1080);
  const ratio = frame.width / frame.height;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.min(width, height * ratio);
      setBox({ w: Math.floor(w), h: Math.floor(w / ratio) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);

  return (
    <div className="cap-stage" ref={wrapRef}>
      <div className="stage-frame" style={{ width: box.w, height: box.h }}>
        <MediaElement
          videoStyle={{ objectFit: "cover", objectPosition: `${clip.framing * 100}% 50%` }}
          audioBackdrop={<div className="stage-audio-bg" />}
        >
          {enabled && <CaptionOverlay style={clip.captions} words={words} onMove={onMove} />}
        </MediaElement>
      </div>
    </div>
  );
}

/** Scrub bar for the whole recording. Clicking or dragging moves the playhead. */
function Scrubber() {
  const project = useProject((s) => s.project)!;
  const peaks = usePeaks((s) => s.byProject[project.id]);
  const total = project.source.duration || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  usePlayerTime((t) => {
    if (headRef.current) headRef.current.style.left = `${(t / total) * 100}%`;
  }, [total]);

  const seek = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    player.seek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total);
  };

  return (
    <div className="cap-scrub">
      <div
        ref={trackRef}
        className="cap-scrub-track"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
      >
        <Waveform peaks={peaks instanceof Uint8Array ? peaks : null} start={0} end={total} />
        <div ref={headRef} className="cap-scrub-head" />
      </div>
      <div className="cap-scrub-scale mono faint">
        <span>0:00</span>
        <span>{clock(total)}</span>
      </div>
    </div>
  );
}

function VideoPicker({ items, onPick }: { items: ProjectMeta[]; onPick: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <section className="ask-picker">
      <h2 className="section-title">Or caption one you already have</h2>
      <div className="ask-picker-list">
        {items.slice(0, 6).map((m) => (
          <button key={m.id} className="ask-pick" onClick={() => onPick(m.id)}>
            <ProjectCover thumbnailPath={m.thumbnailPath} wave={m.wave} name={m.name} size="sm" className="ask-pick-cover" />
            <span className="ask-pick-text">
              <span className="truncate">{m.name}</span>
              <span className="faint truncate">
                {duration(m.duration)}, {relativeDate(m.updatedAt)}
                {m.stage === "imported" ? ", no transcript yet" : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CaptionsView() {
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const library = useApp((s) => s.library);
  const job = useApp((s) =>
    Object.values(s.jobs).find((j) => j.projectId === project?.id && (j.kind === "transcribe" || j.kind === "export")),
  );

  const [aspect, setAspect] = useState<AspectRatio>("original");
  const [framing, setFraming] = useState(0.5);
  const [enabled, setEnabled] = useState(true);
  const [resolution, setResolution] = useState<Resolution>(1080);
  const [fileName, setFileName] = useState("");
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (project) {
      setFileName(`${project.name} captioned`);
      void ensurePeaks(project);
    }
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = project?.captions ?? defaultCaptionStyle();
  const anchor = captionAnchor(style);
  const clip = project ? wholeVideo(project, style, aspect, framing, enabled) : null;

  const setStyle = (patch: Partial<CaptionStyle>) =>
    update((p) => ({ ...p, captions: { ...(p.captions ?? defaultCaptionStyle()), ...patch, presetId: patch.presetId ?? "custom" } }), {
      history: false,
    });

  const addVideo = async () => {
    setImporting(true);
    try {
      const path = await pickMediaFile();
      if (!path) return;
      const id = await importFile(path, { stay: true });
      if (id) setTranscribeOpen(true);
    } finally {
      setImporting(false);
    }
  };

  const pick = async (id: string) => {
    if (await loadProjectQuietly(id)) useApp.getState().setView("captions");
  };

  // Nothing open: the tab is the drop point for a video.
  if (!project || !clip) {
    return (
      <div className="page">
        <div className="page-inner">
          <header className="page-header">
            <div>
              <h1 className="page-title">Captions</h1>
              <p className="page-sub">Put a video's own words on screen, then burn them in.</p>
            </div>
            <Button variant="primary" icon={<UploadSimple />} disabled={importing} onClick={() => void addVideo()}>
              {importing ? "Reading" : "Add video"}
            </Button>
          </header>
          {library.length === 0 ? (
            <EmptyState
              icon={<ClosedCaptioning />}
              title="No videos yet"
              body="Add a video and transcribe it. Its words become subtitles you can style and burn into the picture."
              action={
                <Button variant="primary" icon={<UploadSimple />} onClick={() => void addVideo()}>
                  Add video
                </Button>
              }
            />
          ) : (
            <VideoPicker items={library} onPick={(id) => void pick(id)} />
          )}
        </div>
      </div>
    );
  }

  const cropped = aspect !== "original";
  const frame = outputFrame(project, aspect, resolution);

  return (
    <div className="captions">
      <header className="captions-header">
        <div className="captions-title">
          <h1 className="truncate">{project.name}</h1>
          <span className="faint mono">{duration(project.source.duration)}</span>
        </div>
        <Segmented<AspectRatio> label="Export frame" size="sm" value={aspect} onChange={setAspect} options={FRAMES} />
        <div className="captions-actions">
          <Button icon={<UploadSimple />} disabled={importing} onClick={() => void addVideo()}>
            Add video
          </Button>
          <Button
            variant="primary"
            icon={<Export />}
            disabled={!project.transcript || !!job}
            onClick={() => void exportClipVideo(clip, { burnCaptions: enabled, resolution, fileName: fileName || project.name })}
          >
            Export video
          </Button>
        </div>
      </header>

      <div className="captions-body">
        <section className="captions-main">
          <CaptionStage clip={clip} enabled={enabled && !!project.transcript} onMove={(x, y) => setStyle({ x, y })} />
          <Transport />
          <Scrubber />
        </section>

        <aside className="captions-side">
          {!project.transcript ? (
            <div className="cap-need-transcript">
              <EmptyState
                icon={<TextAa />}
                title="No transcript yet"
                body="Subtitles come from the transcript. Make one here and the words appear on the video."
                action={
                  <Button variant="primary" icon={<TextAa />} onClick={() => setTranscribeOpen(true)}>
                    Transcribe
                  </Button>
                }
              />
            </div>
          ) : (
            <CaptionsPanel style={style} enabled={enabled} onStyle={setStyle} onEnabled={setEnabled} />
          )}

          {project.transcript && (
            <div className="block">
              <div className="block-head">
                <h3>Placement</h3>
                <span className="block-value mono">
                  {anchor ? `${Math.round(anchor.x * 100)}%, ${Math.round(anchor.y * 100)}%` : style.position}
                </span>
              </div>
              <p className="block-note faint">Drag the caption on the video to put it anywhere in the frame.</p>
              <div className="control-row">
                <label htmlFor="cap-size">Text height</label>
                <span className="mono faint">{style.size}px</span>
                <input
                  id="cap-size"
                  type="range"
                  min={20}
                  max={140}
                  step={2}
                  value={style.size}
                  onChange={(e) => setStyle({ size: Number(e.target.value) })}
                />
              </div>
              <div className="control-row">
                <label htmlFor="cap-width">Line width</label>
                <span className="mono faint">{style.wordsPerCaption}w</span>
                <input
                  id="cap-width"
                  type="range"
                  min={1}
                  max={12}
                  step={1}
                  value={style.wordsPerCaption}
                  onChange={(e) => setStyle({ wordsPerCaption: Number(e.target.value) })}
                />
              </div>
              <div className="button-row">
                <Button size="sm" variant="ghost" onClick={() => setStyle({ x: undefined, y: undefined })}>
                  Back to {style.position}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStyle({ x: 0.5, y: 0.5 })}>
                  Centre
                </Button>
              </div>
            </div>
          )}

          {job && <JobCard job={job} />}

          {cropped && (
            <div className="block">
              <div className="block-head">
                <h3>Framing</h3>
                <span className="block-value mono">{Math.round(framing * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={framing}
                aria-label="Horizontal framing"
                onChange={(e) => setFraming(Number(e.target.value))}
              />
              <p className="block-note faint">{FRAMES.find((f) => f.value === aspect)?.label} crops the picture. Slide to choose what stays in frame.</p>
            </div>
          )}

          <div className="block">
            <div className="block-head">
              <h3>Export</h3>
              <span className="block-value mono">
                {frame.width}×{frame.height}
              </span>
            </div>
            <div className="field-grid">
              <Field label="Resolution">
                <Select<Resolution>
                  value={resolution}
                  options={[
                    { value: 720, label: "720p" },
                    { value: 1080, label: "1080p" },
                  ]}
                  onChange={setResolution}
                />
              </Field>
              <Field label="File name">
                <TextInput value={fileName} onChange={(e) => setFileName(e.target.value)} />
              </Field>
            </div>
            <p className="block-note faint">
              Saved as {safeFileName(fileName || project.name)}.mp4 in your export folder, with the subtitles drawn into the picture.
            </p>
            <div className="button-row">
              <Button size="sm" disabled={!project.transcript} onClick={() => void exportClipCaptions(clip, "srt")}>
                Subtitle file (SRT)
              </Button>
              <Button size="sm" disabled={!project.transcript} onClick={() => void exportClipCaptions(clip, "vtt")}>
                VTT
              </Button>
            </div>
          </div>

          {project.source.hasVideo === false && (
            <p className="faint cap-note">
              <WarningCircle /> This is audio only, so captions render over a dark frame.
            </p>
          )}

          <button className="link-btn cap-reveal" onClick={() => void useApp.getState().setView("projects")}>
            <FolderOpen /> All recordings
          </button>
        </aside>
      </div>

      {transcribeOpen && <TranscribeModal open onClose={() => setTranscribeOpen(false)} />}
    </div>
  );
}
