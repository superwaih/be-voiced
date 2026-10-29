"use client";

/**
 * Captions: a recording's own words, on the picture.
 *
 * This is video work, not text work. The whole recording is treated as one clip — the render path
 * is written in terms of clips, so captioning a full video is the same job with the handles at the
 * ends — and nothing is stored under the recording's clips, which belong to the moment finder.
 */

import { ClosedCaptioning, Export, FilmStrip, TextAa, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ProjectCover } from "@/components/Covers";
import { CaptionOverlay } from "@/components/CaptionOverlay";
import { ImportButton } from "@/components/ImportButton";
import { JobCard } from "@/components/JobCard";
import { MediaElement } from "@/components/media";
import { Button, EmptyState, Field, Segmented, Select, Slider, Switch } from "@/components/ui";
import { Transport } from "@/components/workspace/PlayerPanel";
import { TranscribeModal } from "@/components/workspace/TranscribeModal";
import { exportClipCaptions, exportClipVideo, loadProject, outputFrame } from "@/lib/actions";
import { serviceCan } from "@/lib/api";
import { cx } from "@/lib/cx";
import { CAPTION_PRESETS, defaultCaptionStyle } from "@/lib/engine/captions";
import { clock, duration } from "@/lib/engine/format";
import { flattenWords } from "@/lib/engine/transcript";
import type { AspectRatio, CaptionStyle, Clip, Project, Resolution } from "@/lib/engine/types";
import { player, usePlayerTime } from "@/lib/player";
import { useApp } from "@/store/app";
import { usePeaks } from "@/store/peaks";
import { useProject } from "@/store/project";

const FRAMES: { value: AspectRatio; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "9:16", label: "9:16" },
];

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

/** The video at its export shape, with the subtitles over it exactly as they will burn in. */
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
    <div ref={wrapRef} className="grid min-h-0 flex-1 place-items-center">
      <div style={{ width: box.w, height: box.h }} className="relative overflow-hidden rounded-[10px] bg-stage">
        <MediaElement
          className="size-full rounded-[10px]"
          videoStyle={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${clip.framing * 100}% 50%` }}
          audioBackdrop={<div className="absolute inset-0 bg-gradient-to-br from-cover to-cover-2" />}
        >
          {enabled && <CaptionOverlay style={clip.captions} words={words} onMove={onMove} />}
        </MediaElement>
      </div>
    </div>
  );
}

function Scrubber() {
  const project = useProject((s) => s.project)!;
  const peaks = usePeaks((s) => s.byProject[project.id]);
  const total = project.source.duration || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  usePlayerTime(
    (t) => {
      if (headRef.current) headRef.current.style.left = `${(t / total) * 100}%`;
    },
    [total],
  );

  const seek = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    player.seek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total);
  };

  return (
    <div className="flex flex-none flex-col gap-1">
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
        className="relative h-7 cursor-pointer touch-none overflow-hidden rounded-full bg-sunken"
      >
        {peaks instanceof Uint8Array && (
          <div className="absolute inset-0 flex items-center gap-px px-1">
            {Array.from({ length: 120 }).map((_, i) => {
              const at = Math.floor((i / 120) * peaks.length);
              const h = Math.max(8, (peaks[at] / 255) * 100);
              return <span key={i} className="flex-1 rounded-full bg-line-strong" style={{ height: `${h}%` }} />;
            })}
          </div>
        )}
        <div ref={headRef} className="pointer-events-none absolute inset-y-0 w-px bg-accent" />
      </div>
      <div className="mono flex justify-between text-[11px] text-faint">
        <span>0:00</span>
        <span>{clock(total)}</span>
      </div>
    </div>
  );
}

export function CaptionsScreen() {
  const library = useApp((s) => s.library);
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>("original");
  const [resolution, setResolution] = useState<Resolution>(1080);
  const renderJob = useApp((s) =>
    Object.values(s.jobs).find((j) => j.kind === "export" && j.projectId === project?.id),
  );
  const sourceMissing = useApp((s) => !!s.library.find((m) => m.id === project?.id)?.sourceMissing);

  const style = project?.captions ?? defaultCaptionStyle();
  const enabled = !!project?.transcript;

  const setStyle = (patch: Partial<CaptionStyle>) =>
    update((p) => ({ ...p, captions: { ...(p.captions ?? defaultCaptionStyle()), ...patch } }), { coalesce: "captions" });

  // Leaving the screen should not leave audio playing behind it.
  useEffect(() => () => player.pause(), []);

  if (!library.length) {
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={<ClosedCaptioning />}
          title="Nothing to caption yet"
          body="Import a recording, transcribe it, and its own words can go on the picture."
          action={<ImportButton />}
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <h1 className="mb-1 text-[23px] font-bold tracking-[-0.035em] lg:text-[28px]">Captions</h1>
        <p className="mb-5 text-sm text-muted">Pick a recording to put its words on the picture.</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {library.map((m) => (
            <button key={m.id} type="button" onClick={() => void loadProject(m.id)} className="group flex min-w-0 flex-col gap-2 text-left">
              <ProjectCover
                thumbnailPath={m.thumbnailPath}
                wave={m.wave}
                name={m.name}
                size="lg"
                className="aspect-video w-full transition-transform group-hover:-translate-y-0.5"
              />
              <span className="truncate font-semibold">{m.name}</span>
              <span className="flex items-center justify-between gap-2 text-xs">
                <span className="mono text-faint">{duration(m.duration)}</span>
                <span
                  className={cx(
                    m.sourceMissing ? "text-danger" : m.stage === "imported" ? "text-muted" : "text-accent-text",
                  )}
                >
                  {m.sourceMissing ? "File not open" : m.stage === "imported" ? "Needs a transcript" : "Ready"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const clip = wholeVideo(project, style, aspect, 0.5, enabled);
  const frame = outputFrame(project, aspect, resolution);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 lg:px-5 lg:py-3.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate text-[17px] font-bold tracking-[-0.03em] lg:text-xl">{project.name}</h1>
          <span className="mono text-xs text-faint">{duration(project.source.duration)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Segmented<AspectRatio> label="Frame" size="sm" value={aspect} onChange={setAspect} options={FRAMES} />
          <Button size="sm" icon={<UploadSimple />} onClick={() => void useProject.getState().close()}>
            Change
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:px-5 lg:pb-5">
        <section className="flex min-h-0 min-w-0 flex-col gap-2 rounded-[22px] bg-surface p-3.5 dark:inset-ring dark:inset-ring-line">
          <CaptionStage clip={clip} enabled={enabled} onMove={(x, y) => setStyle({ x, y })} />
          <div className="flex justify-center">
            <Transport />
          </div>
          <Scrubber />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto rounded-[22px] bg-surface p-4 dark:inset-ring dark:inset-ring-line">
          {!project.transcript ? (
            <EmptyState
              icon={<TextAa />}
              title="Transcribe it first"
              body={
                serviceCan.transcribe
                  ? "Captions are the recording's own words, so there has to be a transcript before they can go on the picture."
                  : "Captions are the recording's own words, and this browser cannot run transcription."
              }
              action={
                <Button variant="primary" onClick={() => setTranscribeOpen(true)}>
                  Transcribe
                </Button>
              }
            />
          ) : (
            <>
              <div>
                <h2 className="mb-2 text-[12.5px] font-semibold text-muted">Style</h2>
                <div className="grid grid-cols-2 gap-2">
                  {CAPTION_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setStyle({ ...p.style, x: undefined, y: undefined })}
                      aria-pressed={style.presetId === p.id}
                      className={cx(
                        "flex flex-col gap-1 rounded-panel border p-2.5 text-left transition-colors",
                        style.presetId === p.id ? "border-accent-line bg-accent-surface" : "border-line-strong hover:bg-hover",
                      )}
                    >
                      <span className="text-[12.5px] font-bold">{p.name}</span>
                      <span className="text-[11px] text-faint">{p.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Field label="Placement" hint="Drag the caption on the video to put it anywhere in the frame.">
                <Segmented
                  label="Placement"
                  size="sm"
                  value={style.position}
                  onChange={(position) => setStyle({ position, x: undefined, y: undefined })}
                  options={[
                    { value: "top", label: "Top" },
                    { value: "middle", label: "Middle" },
                    { value: "bottom", label: "Bottom" },
                  ]}
                />
              </Field>

              <Field label="Text height">
                <Slider
                  label="Text height"
                  min={28}
                  max={110}
                  value={style.size}
                  onChange={(size) => setStyle({ size })}
                  format={(v) => `${v}px`}
                />
              </Field>

              <Field label="Line width">
                <Slider
                  label="Words per caption"
                  min={1}
                  max={9}
                  value={style.wordsPerCaption}
                  onChange={(wordsPerCaption) => setStyle({ wordsPerCaption })}
                  format={(v) => `${v}w`}
                />
              </Field>

              <Field label="Highlight the word being said" inline>
                <Switch label="Highlight the active word" checked={style.activeWord} onChange={(activeWord) => setStyle({ activeWord })} />
              </Field>

              <Field label="Upper case" inline>
                <Switch label="Upper case" checked={style.uppercase} onChange={(uppercase) => setStyle({ uppercase })} />
              </Field>

              <Field label="Font">
                <Select
                  label="Font"
                  value={style.font}
                  options={["Arial", "Arial Black", "Verdana", "Trebuchet MS", "Tahoma", "Georgia", "Impact"].map((f) => ({
                    value: f,
                    label: f,
                  }))}
                  onChange={(font) => setStyle({ font })}
                />
              </Field>

              {(style.x !== undefined || style.y !== undefined) && (
                <Button size="sm" onClick={() => setStyle({ x: undefined, y: undefined })}>
                  Back to {style.position}
                </Button>
              )}

              <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
                <h2 className="text-[12.5px] font-semibold text-muted">Export</h2>

                <Field label="Resolution">
                  <Segmented<Resolution>
                    label="Resolution"
                    size="sm"
                    value={resolution}
                    onChange={setResolution}
                    options={[
                      { value: 720, label: "720p" },
                      { value: 1080, label: "1080p" },
                    ]}
                  />
                </Field>

                {renderJob ? (
                  <JobCard job={renderJob} title="Rendering video" />
                ) : (
                  <Button
                    variant="primary"
                    icon={<FilmStrip />}
                    disabled={!serviceCan.renderVideo || sourceMissing}
                    onClick={() => void exportClipVideo(clip, { burnCaptions: true, resolution })}
                  >
                    Export video with captions
                  </Button>
                )}

                <p className="text-xs text-faint">
                  {serviceCan.renderVideo
                    ? `Rendered here, on your graphics card: ${frame.width}×${frame.height} MP4, with the captions drawn into the picture exactly where you put them.`
                    : "This browser cannot encode video. A current version of Chrome or Edge can."}
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Export />} onClick={() => void exportClipCaptions(clip, "srt")}>
                    Subtitle file (SRT)
                  </Button>
                  <Button size="sm" icon={<Export />} onClick={() => void exportClipCaptions(clip, "vtt")}>
                    VTT
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <TranscribeModal open={transcribeOpen} onClose={() => setTranscribeOpen(false)} />
    </div>
  );
}
