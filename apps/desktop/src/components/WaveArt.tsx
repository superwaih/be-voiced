import { memo } from "react";

/**
 * Waveform drawn from a recording's real audio peaks. Used as cover art for projects and clips,
 * so every tile shows the shape of its own conversation.
 */
export const WaveArt = memo(function WaveArt({
  values,
  className = "",
  gap = 0.35,
  min = 0.06,
  align = "center",
  highlight,
}: {
  values: number[];
  className?: string;
  /** Gap between bars as a fraction of the bar slot. */
  gap?: number;
  /** Minimum bar height so silence still reads as a line. */
  min?: number;
  align?: "center" | "bottom";
  /** Range of bar indexes drawn in the accent colour. */
  highlight?: [number, number];
}) {
  if (!values.length) return <div className={`wave-art is-empty ${className}`} aria-hidden="true" />;
  const n = values.length;
  const w = 1 - gap;
  return (
    <svg className={`wave-art ${className}`} viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(min, Math.min(1, v)) * 100;
        const y = align === "bottom" ? 100 - h : (100 - h) / 2;
        const hot = highlight && i >= highlight[0] && i <= highlight[1];
        return <rect key={i} x={i + gap / 2} y={y} width={w} height={h} rx={Math.min(w / 2, 0.45)} className={hot ? "is-hot" : undefined} />;
      })}
    </svg>
  );
});
