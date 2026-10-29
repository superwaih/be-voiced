"use client";

/**
 * One clip, edited.
 *
 * The workspace decides *what* is worth posting; this decides what it looks like. Trim it to the
 * sentence, choose the shape it goes out in, place the captions, and render it.
 *
 * Two details carried over from the desktop because they are what makes trimming bearable:
 * dragging a handle **snaps to the nearest word** unless Alt is held, so a clip never starts
 * halfway through one; and the timeline shows a window around the clip rather than the whole
 * recording, so a two-second adjustment is not a one-pixel movement.
 */

import { ArrowLeft, Export, FilmStrip, Minus, Play, Plus } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CaptionOverlay } from "@/components/CaptionOverlay";
import { JobCard } from "@/components/JobCard";
import { MediaElement, Waveform } from "@/components/media";
import { Button, Field, IconButton, InlineEdit, Segmented, Select, Slider, Switch } from "@/components/ui";
import { Transport } from "@/components/workspace/PlayerPanel";
import { exportClipCaptions, exportClipVideo, loadProject, outputFrame } from "@/lib/actions";
import { serviceCan } from "@/lib/api";
import { cx } from "@/lib/cx";
import { CAPTION_PRESETS, defaultCaptionStyle } from "@/lib/engine/captions";
import { clock, duration as fmtDuration } from "@/lib/engine/format";
import { buildUnits, flattenWords, nudgeBySentence, snapToWord, wordsInRange } from "@/lib/engine/transcript";
import type { AspectRatio, CaptionStyle, Clip, Resolution } from "@/lib/engine/types";
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

/** A window around the clip with room either side, so the handles have somewhere to move. */
function windowFor(clip: { start: number; end: number }, total: number) {
  const pad = Math.max(3, (clip.end - clip.start) * 0.4);
  return { start: Math.max(0, clip.start - pad), end: Math.min(total, clip.end + pad) };
}

function TrimTimeline({ clip }: { clip: Clip }) {
  const project = useProject((s) => s.project)!;
  const updateClip = useProject((s) => s.updateClip);
  const peaks = usePeaks((s) => s.byProject[project.id]);
  const total = project.source.duration;
  const words = useMemo(() => flattenWords(project.transcript), [project.transcript]);

  const [view, setView] = useState(() => windowFor(clip, total));
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const span = view.end - view.start;

  // Keep the clip in view when it is changed from elsewhere — a sentence nudge, or undo.
  useEffect(() => {
    if (dragging) return;
    if (clip.start < view.start || clip.end > view.end) setView(windowFor(clip, total));
  }, [clip.start, clip.end]); // eslint-disable-line react-hooks/exhaustive-deps

  usePlayerTime(
    (t) => {
      if (!headRef.current) return;
      const x = ((t - view.start) / span) * 100;
      headRef.current.style.left = `${x}%`;
      headRef.current.style.visibility = x < 0 || x > 100 ? "hidden" : "visible";
    },
    [view.start, span],
  );

  const toTime = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return view.start;
    return view.start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span;
  };
  const pct = (t: number) => `${((t - view.start) / span) * 100}%`;

  const moveHandle = (e: React.PointerEvent, edge: "start" | "end") => {
    if (dragging !== edge) return;
    let t = toTime(e.clientX);
    // Alt is the escape hatch for the rare cut that genuinely falls mid-word.
    if (!e.altKey && words.length) t = snapToWord(words, t, edge);
    if (edge === "start") t = Math.max(0, Math.min(t, clip.end - 1));
    else t = Math.min(total, Math.max(t, clip.start + 1));
    updateClip(clip.id, { [edge]: t }, { coalesce: `trim-${clip.id}-${edge}` });
    player.seek(edge === "start" ? t : Math.max(t - 2, clip.start));
  };

  const trimRange = useMemo(() => [{ start: clip.start, end: clip.end }], [clip.start, clip.end]);

  return (
    <div className="flex flex-none flex-col gap-1.5">
      <div
        ref={trackRef}
        className="relative h-20 touch-none rounded-[10px] bg-sunken"
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
        onPointerMove={(e) => dragging && moveHandle(e, dragging)}
      >
        <Waveform
          peaks={peaks instanceof Uint8Array ? peaks : null}
          start={view.start}
          end={view.end}
          ranges={trimRange}
        />

        {/* Everything outside the clip is dimmed, so what will be exported is what is bright. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/60" style={{ width: pct(clip.start) }} />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-bg/60"
          style={{ left: pct(clip.end) }}
        />

        {(["start", "end"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            aria-label={edge === "start" ? "Drag the start" : "Drag the end"}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDragging(edge);
            }}
            style={{ left: pct(clip[edge]) }}
            className={cx(
              "absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize touch-none",
              "before:absolute before:inset-y-0 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:bg-accent",
              "after:absolute after:top-1/2 after:left-1/2 after:size-4 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-accent",
            )}
          />
        ))}

        <div ref={headRef} className="pointer-events-none absolute inset-y-0 w-px bg-accent-text" />
      </div>

      <div className="mono flex justify-between text-[11px] text-faint">
        <span>{clock(view.start)}</span>
        <span className="text-accent-text">
          {clock(clip.start, { tenths: true })} – {clock(clip.end, { tenths: true })} ·{" "}
          {fmtDuration(clip.end - clip.start)}
        </span>
        <span>{clock(view.end)}</span>
      </div>
    </div>
  );
}

function Stage({ clip }: { clip: Clip }) {
  const project = useProject((s) => s.project)!;
  const clipWords = useMemo(
    () => wordsInRange(flattenWords(project.transcript), clip.start, clip.end),
    [project.transcript, clip.start, clip.end],
  );
  const updateClip = useProject((s) => s.updateClip);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const frame = outputFrame(project, clip.aspect, clip.resolution);
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
          videoStyle={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: `${clip.framing * 100}% 50%`,
          }}
          audioBackdrop={<div className="absolute inset-0 bg-gradient-to-br from-cover to-cover-2" />}
        >
          {clip.captionsEnabled && (
            <CaptionOverlay
              style={clip.captions}
              words={clipWords}
              onMove={(x, y) =>
                updateClip(clip.id, (c) => ({ captions: { ...c.captions, x, y } }), { coalesce: `cap-${clip.id}` })
              }
            />
          )}
        </MediaElement>
      </div>
    </div>
  );
}

export function ClipEditorScreen({ id, clipId }: { id: string; clipId: string }) {
  const project = useProject((s) => s.project);
  const booted = useApp((s) => s.booted);
  const updateClip = useProject((s) => s.updateClip);
  const router = useRouter();

  const exportJob = useApp((s) =>
    Object.values(s.jobs).find((j) => j.kind === "export" && j.clipId === clipId),
  );

  useEffect(() => {
    if (booted) void loadProject(id);
  }, [booted, id]);

  useEffect(() => () => player.setLoopRange(null), []);

  const clip = project?.clips.find((c) => c.id === clipId);

  // Playback is kept inside the clip, so pressing play previews what will be exported.
  useEffect(() => {
    if (!clip) return;
    player.setLoopRange({ start: clip.start, end: clip.end });
  }, [clip?.start, clip?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  const units = useMemo(() => buildUnits(project?.transcript ?? null), [project?.transcript]);

  if (!project || project.id !== id) return <div className="flex-1" aria-busy="true" />;
  if (!clip) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <strong>That clip is not in this recording any more.</strong>
          <Button className="mt-2" onClick={() => router.push(`/project/${id}`)}>
            Back to the recording
          </Button>
        </div>
      </div>
    );
  }

  const style = clip.captions ?? defaultCaptionStyle();
  const setStyle = (patch: Partial<CaptionStyle>) =>
    updateClip(clip.id, (c) => ({ captions: { ...c.captions, ...patch } }), { coalesce: `cap-${clip.id}` });
  const nudge = (edge: "start" | "end", dir: -1 | 1) =>
    updateClip(clip.id, nudgeBySentence(units, clip.start, clip.end, edge, dir), { coalesce: `nudge-${clip.id}` });

  const frame = outputFrame(project, clip.aspect, clip.resolution);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 lg:px-5 lg:py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/project/${id}`}
            className="grid size-8 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"
            aria-label="Back to the recording"
          >
            <ArrowLeft size={18} />
          </Link>
          <InlineEdit
            label="Clip title"
            className="text-[17px] font-bold tracking-[-0.03em] lg:text-xl"
            value={clip.title}
            onCommit={(title) => updateClip(clip.id, { title })}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton label="Preview the clip" onClick={() => player.playRange(clip.start, clip.end)}>
            <Play weight="fill" />
          </IconButton>
          <span className="mono text-xs text-faint">
            {frame.width}×{frame.height}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,340px)] lg:px-5 lg:pb-5">
        <section className="flex min-h-0 min-w-0 flex-col gap-2 rounded-[22px] bg-surface p-3.5 dark:inset-ring dark:inset-ring-line">
          <Stage clip={clip} />
          <div className="flex justify-center">
            <Transport showTenths />
          </div>
          <TrimTimeline clip={clip} />
        </section>

        <section className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto rounded-[22px] bg-surface p-4 dark:inset-ring dark:inset-ring-line">
          <div>
            <h2 className="mb-2 text-[12.5px] font-semibold text-muted">Trim by sentence</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-xs text-faint">Start</span>
                <IconButton size="sm" label="Remove the first sentence" onClick={() => nudge("start", 1)}>
                  <Minus />
                </IconButton>
                <IconButton size="sm" label="Add the sentence before" onClick={() => nudge("start", -1)}>
                  <Plus />
                </IconButton>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-faint">End</span>
                <IconButton size="sm" label="Remove the last sentence" onClick={() => nudge("end", -1)}>
                  <Minus />
                </IconButton>
                <IconButton size="sm" label="Add the sentence after" onClick={() => nudge("end", 1)}>
                  <Plus />
                </IconButton>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-faint">
              Dragging a handle snaps to the nearest word. Hold Alt to cut anywhere.
            </p>
          </div>

          <Field label="Shape">
            <Segmented<AspectRatio>
              label="Shape"
              size="sm"
              value={clip.aspect}
              onChange={(aspect) => updateClip(clip.id, { aspect })}
              options={FRAMES}
            />
          </Field>

          {clip.aspect !== "original" && project.source.hasVideo && (
            <Field label="Horizontal position" hint="Which part of the picture to keep when the shape changes.">
              <Slider
                label="Horizontal position"
                min={0}
                max={1}
                step={0.01}
                value={clip.framing}
                onChange={(framing) => updateClip(clip.id, { framing }, { coalesce: `framing-${clip.id}` })}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            </Field>
          )}

          <Field label="Captions" inline>
            <Switch
              label="Captions on"
              checked={clip.captionsEnabled}
              onChange={(captionsEnabled) => updateClip(clip.id, { captionsEnabled })}
            />
          </Field>

          {clip.captionsEnabled && (
            <>
              <div>
                <h2 className="mb-2 text-[12.5px] font-semibold text-muted">Style</h2>
                <div className="grid grid-cols-2 gap-2">
                  {CAPTION_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={style.presetId === p.id}
                      onClick={() => setStyle({ ...p.style, x: undefined, y: undefined })}
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

              <Field label="Placement" hint="Drag the caption on the video to put it anywhere.">
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

              <Field label="Words per caption">
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
                <Switch
                  label="Highlight the active word"
                  checked={style.activeWord}
                  onChange={(activeWord) => setStyle({ activeWord })}
                />
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
            </>
          )}

          <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
            <h2 className="text-[12.5px] font-semibold text-muted">Export</h2>

            <Field label="Resolution">
              <Segmented<Resolution>
                label="Resolution"
                size="sm"
                value={clip.resolution}
                onChange={(resolution) => updateClip(clip.id, { resolution })}
                options={[
                  { value: 720, label: "720p" },
                  { value: 1080, label: "1080p" },
                ]}
              />
            </Field>

            {exportJob ? (
              <JobCard job={exportJob} title="Rendering this clip" />
            ) : (
              <Button
                variant="primary"
                icon={<FilmStrip />}
                disabled={!serviceCan.renderVideo}
                onClick={() =>
                  void exportClipVideo(clip, { burnCaptions: clip.captionsEnabled, resolution: clip.resolution })
                }
              >
                Export this clip
              </Button>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={<Export />} onClick={() => void exportClipCaptions(clip, "srt")}>
                SRT
              </Button>
              <Button size="sm" icon={<Export />} onClick={() => void exportClipCaptions(clip, "vtt")}>
                VTT
              </Button>
            </div>

            {clip.exports.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[12.5px] font-semibold text-muted">Earlier exports</h3>
                <ul className="flex flex-col gap-1 text-xs">
                  {clip.exports
                    .slice()
                    .reverse()
                    .map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{e.path}</span>
                        <span className="mono shrink-0 text-faint">{e.kind}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
