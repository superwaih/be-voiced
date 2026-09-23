import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowsInLineHorizontal,
  Export,
  Pause,
  Play,
  SkipBack,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MediaElement, Waveform } from "../../components/media";
import { Button, IconButton, InlineEdit, Segmented } from "../../components/ui";
import { ensurePeaks, outputFrame, usePeaks } from "../../lib/actions";
import { groupCaptions, previewVars, type CaptionGroup } from "../../lib/captions";
import { clock } from "../../lib/format";
import { player, usePlayerState, usePlayerTime } from "../../lib/player";
import { flattenWords, snapToWord, wordsInRange, type FlatWord } from "../../lib/transcript";
import type { CaptionStyle, Clip } from "../../lib/types";
import { useProject } from "../../store/project";
import { openWorkspace } from "../ProjectView";
import { CaptionsPanel, ClipPanel, ExportPanel } from "./EditorPanels";

type Tab = "clip" | "captions" | "export";

export function ClipEditor({ clipId }: { clipId: string }) {
  const project = useProject((s) => s.project)!;
  const clip = project.clips.find((c) => c.id === clipId)!;
  const updateClip = useProject((s) => s.updateClip);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const saving = useProject((s) => s.saving);
  const [tab, setTab] = useState<Tab>("clip");

  const words = useMemo(() => flattenWords(project.transcript), [project.transcript]);
  const clipWords = useMemo(() => wordsInRange(words, clip.start, clip.end), [words, clip.start, clip.end]);

  useEffect(() => {
    void ensurePeaks(project);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    player.setLoopRange({ start: clip.start, end: clip.end });
    const t = player.time;
    if (t < clip.start - 0.05 || t > clip.end + 0.05) player.seek(clip.start);
  }, [clip.start, clip.end]);

  useEffect(() => () => player.setLoopRange(null), []);

  return (
    <div className="editor">
      <header className="ws-header">
        <div className="ws-title">
          <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={openWorkspace}>
            {project.name}
          </Button>
          <span className="faint" aria-hidden="true">
            /
          </span>
          <InlineEdit label="Clip title" className="ws-name" value={clip.title} onCommit={(title) => updateClip(clip.id, { title })} />
        </div>
        <div className="ws-actions">
          <span className="save-state faint">{saving ? "Saving" : "Saved"}</span>
          <IconButton label="Undo" disabled={!canUndo} onClick={() => useProject.getState().undo()}>
            <ArrowCounterClockwise />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={() => useProject.getState().redo()}>
            <ArrowClockwise />
          </IconButton>
          <Button variant="primary" icon={<Export />} onClick={() => setTab("export")}>
            Export
          </Button>
        </div>
      </header>

      <div className="editor-body">
        <div className="editor-main">
          <ClipStage clip={clip} clipWords={clipWords} />
          <EditorTransport clip={clip} />
          <TrimTimeline clip={clip} words={words} />
        </div>
        <aside className="editor-side">
          <div className="editor-tabs">
            <Segmented<Tab>
              label="Editor panel"
              value={tab}
              onChange={setTab}
              options={[
                { value: "clip", label: "Clip" },
                { value: "captions", label: "Captions" },
                { value: "export", label: "Export" },
              ]}
            />
          </div>
          <div className="editor-panel">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                {tab === "clip" && <ClipPanel clip={clip} clipWords={clipWords} />}
                {tab === "captions" && <CaptionsPanel clip={clip} />}
                {tab === "export" && <ExportPanel clip={clip} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </aside>
      </div>
    </div>
  );
}

// --- Stage -------------------------------------------------------------------------------------

function ClipStage({ clip, clipWords }: { clip: Clip; clipWords: FlatWord[] }) {
  const project = useProject((s) => s.project)!;
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
    <div className="stage" ref={wrapRef}>
      <div className="stage-frame" style={{ width: box.w, height: box.h }}>
        <MediaElement
          videoStyle={{ objectFit: "cover", objectPosition: `${clip.framing * 100}% 50%` }}
          audioBackdrop={<div className="stage-audio-bg" />}
        >
          {clip.captionsEnabled && <CaptionOverlay style={clip.captions} words={clipWords} />}
        </MediaElement>
      </div>
    </div>
  );
}

export const CaptionOverlay = memo(function CaptionOverlay({ style, words }: { style: CaptionStyle; words: FlatWord[] }) {
  const groups = useMemo(() => groupCaptions(words, style.wordsPerCaption, 0), [words, style.wordsPerCaption]);
  const [pos, setPos] = useState<{ g: number; w: number }>({ g: -1, w: -1 });
  const posRef = useRef(pos);
  const { playing } = usePlayerState();

  usePlayerTime(
    (t) => {
      let g = findGroup(groups, t);
      if (g < 0 && player.el?.paused !== false && groups.length) {
        // While paused between or outside captions, show the next one so styling is never blind.
        const next = groups.findIndex((x) => x.start > t);
        g = next >= 0 ? next : groups.length - 1;
      }
      let w = -1;
      if (g >= 0) {
        const ws = groups[g].words;
        for (let i = 0; i < ws.length; i++) if (ws[i].start <= t + 0.02) w = i;
        if (w < 0) w = 0;
      }
      if (g !== posRef.current.g || w !== posRef.current.w) {
        posRef.current = { g, w };
        setPos({ g, w });
      }
    },
    [groups, playing],
  );

  const group = pos.g >= 0 ? groups[pos.g] : null;
  return (
    <div className={`cap-layer is-${style.position}`} style={previewVars(style) as React.CSSProperties} aria-hidden="true">
      {group && (
        <div className="cap-line">
          <span className="cap-text" style={{ fontWeight: style.bold ? 700 : 400 }}>
            {group.words.map((w, k) => (
              <span key={k} className={style.activeWord && k === pos.w ? "cap-word is-active" : "cap-word"}>
                {k > 0 ? " " : ""}
                {style.uppercase ? w.text.toUpperCase() : w.text}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
});

function findGroup(groups: CaptionGroup[], t: number) {
  let lo = 0;
  let hi = groups.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (groups[mid].start <= t) {
      if (groups[mid].end > t) return mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return -1;
}

// --- Transport -----------------------------------------------------------------------------------

function EditorTransport({ clip }: { clip: Clip }) {
  const { playing } = usePlayerState();
  const timeRef = useRef<HTMLSpanElement>(null);
  const length = clip.end - clip.start;
  usePlayerTime(
    (t) => {
      if (timeRef.current) timeRef.current.textContent = clock(Math.max(0, Math.min(length, t - clip.start)), { tenths: true });
    },
    [clip.start, length],
  );
  return (
    <div className="editor-transport">
      <IconButton label="Go to clip start" onClick={() => player.seek(clip.start)}>
        <SkipBack />
      </IconButton>
      <button className="play-btn" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => player.toggle()}>
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </button>
      <span className="transport-time mono">
        <span ref={timeRef}>0:00.0</span>
        <span className="faint"> / {clock(length, { tenths: true })}</span>
      </span>
    </div>
  );
}

// --- Trim timeline -------------------------------------------------------------------------------

const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

function windowFor(clip: Clip, total: number) {
  const len = clip.end - clip.start;
  const pad = Math.max(6, len * 0.35);
  return { start: Math.max(0, clip.start - pad), end: Math.min(total, clip.end + pad) };
}

function TrimTimeline({ clip, words }: { clip: Clip; words: FlatWord[] }) {
  const project = useProject((s) => s.project)!;
  const updateClip = useProject((s) => s.updateClip);
  const peaks = usePeaks((s) => s.byProject[project.id]);
  const total = project.source.duration;
  const [view, setView] = useState(() => windowFor(clip, total));
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [width, setWidth] = useState(800);
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const span = view.end - view.start;

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the clip in view when it changes from elsewhere (sentence nudges, undo).
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
    const rect = trackRef.current!.getBoundingClientRect();
    return view.start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span;
  };
  const pct = (t: number) => `${((t - view.start) / span) * 100}%`;

  const onHandleMove = (e: React.PointerEvent, edge: "start" | "end") => {
    if (dragging !== edge) return;
    let t = toTime(e.clientX);
    if (!e.altKey) t = snapToWord(words, t, edge);
    if (edge === "start") t = Math.max(0, Math.min(t, clip.end - 1));
    else t = Math.min(total, Math.max(t, clip.start + 1));
    updateClip(clip.id, { [edge]: t }, { coalesce: `trim-${clip.id}-${edge}` });
    player.seek(edge === "start" ? t : Math.max(t - 2, clip.start));
  };

  const trimRange = useMemo(() => [{ start: clip.start, end: clip.end }], [clip.start, clip.end]);
  const pxPerSec = width / span;
  const step = TICK_STEPS.find((s) => s * pxPerSec >= 72) ?? 600;
  const ticks: number[] = [];
  for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) ticks.push(t);
  const laneWords = pxPerSec > 22 ? words.filter((w) => w.end > view.start && w.start < view.end) : [];

  return (
    <div className="trim">
      <div className="trim-head">
        <span className="faint trim-hint">
          Drag the handles to trim. They snap to word boundaries; hold <kbd className="kbd">Alt</kbd> for free movement.
        </span>
        <IconButton size="sm" label="Fit clip in view" onClick={() => setView(windowFor(clip, total))}>
          <ArrowsInLineHorizontal />
        </IconButton>
      </div>
      <div className="trim-ruler mono" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {clock(t)}
          </span>
        ))}
      </div>
      <div
        ref={trackRef}
        className="trim-track"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(".trim-handle")) return;
          player.seek(toTime(e.clientX));
        }}
      >
        <Waveform
          peaks={peaks instanceof Uint8Array ? peaks : null}
          start={view.start}
          end={view.end}
          className="trim-wave"
          ranges={trimRange}
        />
        <div className="trim-region" style={{ left: pct(clip.start), width: `${((clip.end - clip.start) / span) * 100}%` }} />
        {(["start", "end"] as const).map((edge) => (
          <div
            key={edge}
            role="slider"
            tabIndex={0}
            aria-label={edge === "start" ? "Clip start" : "Clip end"}
            aria-valuetext={clock(clip[edge], { tenths: true })}
            className={`trim-handle is-${edge} ${dragging === edge ? "is-dragging" : ""}`}
            style={{ left: pct(clip[edge]) }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(edge);
            }}
            onPointerMove={(e) => onHandleMove(e, edge)}
            onPointerUp={() => setDragging(null)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              e.stopPropagation();
              const delta = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1);
              const v = clip[edge] + delta;
              if (edge === "start" && v >= 0 && v < clip.end - 1) updateClip(clip.id, { start: v }, { coalesce: `trim-${clip.id}-start` });
              if (edge === "end" && v <= total && v > clip.start + 1) updateClip(clip.id, { end: v }, { coalesce: `trim-${clip.id}-end` });
            }}
          >
            <span className="trim-grip" />
            {dragging === edge && <span className="trim-tip mono">{clock(clip[edge], { tenths: true })}</span>}
          </div>
        ))}
        <div ref={headRef} className="trim-head-line" />
      </div>
      {laneWords.length > 0 && (
        <div className="trim-words" aria-hidden="true">
          {laneWords.map((w) => (
            <span
              key={w.i}
              className={w.start >= clip.start - 0.02 && w.end <= clip.end + 0.05 ? "is-in" : ""}
              style={{ left: pct(w.start), width: `${((w.end - w.start) / span) * 100}%` }}
            >
              {w.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
