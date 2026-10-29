"use client";

/**
 * The one media element on screen, and the waveform drawn beside it.
 *
 * A browser cannot play every container people upload. When it cannot, the recording says so
 * plainly rather than showing a black rectangle — making a playable copy is the worker's job.
 */

import { FileAudio, VideoCameraSlash, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { fileSrc } from "@/lib/api";
import { relinkSource } from "@/lib/actions";
import { cx } from "@/lib/cx";
import { player, usePlayerState } from "@/lib/player";
import { useApp } from "@/store/app";
import { useProject } from "@/store/project";

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
  const ref = useRef<HTMLVideoElement>(null);
  const { error } = usePlayerState();
  const src = fileSrc(project.source.path);
  const startTime = useRef(project.ui.time);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    player.attach(el);
    player.seek(startTime.current);
    return () => {
      const t = player.time;
      player.detach();
      // Remember the playhead, so reopening this recording lands in the same place.
      useProject.getState().update((p) => ({ ...p, ui: { ...p.ui, time: t } }), { history: false });
    };
  }, [src]);

  return (
    <div className={cx("relative grid min-h-0 place-items-center overflow-hidden rounded-[14px] bg-stage", className)}>
      <video
        ref={ref}
        key={src}
        src={src}
        preload="auto"
        playsInline
        className="max-h-full max-w-full"
        style={{ ...videoStyle, visibility: project.source.hasVideo && !error ? "visible" : "hidden" }}
      />

      {!project.source.hasVideo &&
        !error &&
        (audioBackdrop ?? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stage-ink/60">
            <FileAudio size={28} />
            <span className="text-xs">Audio only</span>
          </div>
        ))}

      {sourceMissing ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-stage/90 p-6 text-center text-stage-ink">
          <WarningCircle size={22} />
          <strong>This file is not open any more</strong>
          <span className="max-w-[34ch] text-xs text-stage-ink/70">
            A browser forgets files when the page reloads. Choose it again to keep working.
          </span>
          <Button size="sm" className="mt-2" onClick={() => void relinkSource()}>
            Locate file
          </Button>
        </div>
      ) : error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-stage/90 p-6 text-center text-stage-ink">
          <VideoCameraSlash size={22} />
          <strong>This format will not play here</strong>
          <span className="max-w-[36ch] text-xs text-stage-ink/70">
            Your browser cannot decode this container. The transcript and captions still work.
          </span>
        </div>
      ) : null}

      {children}
    </div>
  );
}

/** Canvas waveform for a window of time. Redraws on resize and theme change only. */
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
  /** Time ranges whose bars are drawn in the accent colour — clips, or a trimmed region. */
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
      const color = styles.getPropertyValue("--text-3").trim() || "#9aa392";
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
        const inRange = ranges?.some((r) => tm >= r.start && tm <= r.end);
        ctx.fillStyle = inRange ? hot : color;
        ctx.globalAlpha = inRange ? 1 : 0.5;
        ctx.fillRect(c * step, mid - h / 2, bar, h);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, start, end, theme, peakRate, ranges]);

  return <canvas ref={canvasRef} aria-hidden="true" className={cx("block h-full w-full", className)} />;
}
