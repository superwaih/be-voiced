import { FileAudio, VideoCameraSlash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPreview, relinkSource } from "../lib/actions";
import { fileSrc } from "../lib/ipc";
import { player, usePlayerState } from "../lib/player";
import { useApp } from "../store/app";
import { useProject } from "../store/project";
import { Button, Progress } from "./ui";

/** The one media element for the current view. Handles unplayable containers and missing files. */
export function MediaElement({
  className,
  videoStyle,
  children,
  audioBackdrop,
}: {
  className?: string;
  videoStyle?: CSSProperties;
  children?: ReactNode;
  audioBackdrop?: ReactNode;
}) {
  const project = useProject((s) => s.project)!;
  const sourceMissing = useApp((s) => s.library.find((m) => m.id === project.id)?.sourceMissing);
  const proxyJob = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "proxy" && j.projectId === project.id));
  const ref = useRef<HTMLVideoElement>(null);
  const { error } = usePlayerState();
  const src = fileSrc(project.previewPath ?? project.source.path);
  const startTime = useRef(project.ui.time);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    player.attach(el);
    player.seek(startTime.current);
    return () => {
      const t = player.time;
      player.detach();
      // Remember the playhead so reopening the project lands in the same place.
      useProject.getState().update((p) => ({ ...p, ui: { ...p.ui, time: t } }), { history: false });
    };
  }, [src]);

  return (
    <div className={`media ${className ?? ""}`}>
      <video
        ref={ref}
        key={src}
        src={src}
        preload="auto"
        playsInline
        style={{ ...videoStyle, visibility: project.source.hasVideo && !error ? "visible" : "hidden" }}
      />
      {!project.source.hasVideo && !error && (audioBackdrop ?? (
        <div className="media-audio">
          <FileAudio size={28} />
          <span>Audio only</span>
        </div>
      ))}
      {sourceMissing ? (
        <div className="media-message">
          <WarningCircle size={22} />
          <strong>Source file not found</strong>
          <span>It was moved, renamed or is on a disconnected drive.</span>
          <Button size="sm" onClick={() => void relinkSource()}>
            Locate file
          </Button>
        </div>
      ) : error && !project.previewPath ? (
        <div className="media-message">
          <VideoCameraSlash size={22} />
          <strong>This format cannot play in the preview</strong>
          <span>Create a lightweight preview copy. Exports still use the original file.</span>
          {proxyJob ? (
            <div className="media-proxy-progress">
              <Progress value={proxyJob.progress} label="Creating preview copy" />
              <span className="mono">{proxyJob.progress !== null ? `${Math.round(proxyJob.progress * 100)}%` : ""}</span>
            </div>
          ) : (
            <Button size="sm" variant="primary" onClick={() => void createPreview()}>
              Create preview copy
            </Button>
          )}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Canvas waveform for a time window. Redraws on resize and theme change only. */
export function Waveform({
  peaks,
  start,
  end,
  className,
  peakRate = 20,
  ranges,
}: {
  peaks: Uint8Array | null;
  start: number;
  end: number;
  className?: string;
  peakRate?: number;
  /** Time ranges whose bars are drawn in the accent colour (clips, the trimmed region). */
  ranges?: { start: number; end: number }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useApp((s) => s.settings.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!peaks || !peaks.length || end <= start) return;
      const styles = getComputedStyle(canvas);
      const color = styles.getPropertyValue("--wave").trim() || "#9aa392";
      const hot = styles.getPropertyValue("--wave-hot").trim() || color;
      const bar = Math.max(1, Math.round(2 * dpr));
      const gap = Math.max(1, Math.round(1 * dpr));
      const step = bar + gap;
      const cols = Math.floor(canvas.width / step);
      const mid = canvas.height / 2;
      for (let c = 0; c < cols; c++) {
        const t0 = start + ((end - start) * c) / cols;
        const t1 = start + ((end - start) * (c + 1)) / cols;
        const i0 = Math.max(0, Math.floor(t0 * peakRate));
        const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(t1 * peakRate)));
        let max = 0;
        for (let i = i0; i < i1; i++) if (peaks[i] > max) max = peaks[i];
        const h = Math.max(dpr, (max / 255) * canvas.height * 0.92);
        const tm = (t0 + t1) / 2;
        ctx.fillStyle = ranges?.some((r) => tm >= r.start && tm <= r.end) ? hot : color;
        ctx.fillRect(c * step, mid - h / 2, bar, h);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, start, end, theme, peakRate, ranges]);

  return <canvas ref={canvasRef} className={`waveform ${className ?? ""}`} aria-hidden="true" />;
}
