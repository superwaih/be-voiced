"use client";

/**
 * Cover art for a recording or a clip.
 *
 * A recording with video shows its thumbnail, with its own waveform along the lower edge. One
 * without shows the waveform itself on graphite — the shape of that particular conversation. Before
 * a waveform exists, a monogram stands in, so a tile never looks broken.
 */

import { memo } from "react";
import { cx } from "@/lib/cx";
import { fileSrc } from "@/lib/api";
import { unpackWave } from "@/lib/engine/wave";

export const WaveArt = memo(function WaveArt({
  values,
  className,
  gap = 0.35,
  min = 0.06,
  align = "center",
  highlight,
}: {
  values: number[];
  className?: string;
  /** Gap between bars, as a fraction of the slot each bar sits in. */
  gap?: number;
  /** Shortest a bar can be, so silence still reads as a line. */
  min?: number;
  align?: "center" | "bottom";
  /** Range of bar indexes drawn in the accent colour. */
  highlight?: [number, number];
}) {
  if (!values.length) return <div className={cx("block size-full", className)} aria-hidden="true" />;
  const n = values.length;
  const w = 1 - gap;
  return (
    <svg
      viewBox={`0 0 ${n} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cx("block size-full fill-current", className)}
    >
      {values.map((v, i) => {
        const h = Math.max(min, Math.min(1, v)) * 100;
        const y = align === "bottom" ? 100 - h : (100 - h) / 2;
        const hot = highlight && i >= highlight[0] && i <= highlight[1];
        return (
          <rect
            key={i}
            x={i + gap / 2}
            y={y}
            width={w}
            height={h}
            rx={Math.min(w / 2, 0.45)}
            fill={hot ? "var(--wave-hot)" : undefined}
          />
        );
      })}
    </svg>
  );
});

function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  return (words[0]?.[0] ?? "B").toUpperCase() + (words[1]?.[0] ?? "").toUpperCase();
}

const COVER_SIZE = {
  sm: "rounded-[12px]",
  md: "rounded-[14px]",
  lg: "rounded-[18px]",
};

export function ProjectCover({
  thumbnailPath,
  wave,
  name = "",
  className,
  size = "md",
}: {
  thumbnailPath: string | null;
  wave?: number[];
  name?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const values = unpackWave(wave);
  const shell = cx("relative block shrink-0 overflow-hidden bg-cover", COVER_SIZE[size], className);

  if (thumbnailPath) {
    return (
      <span className={shell}>
        {/* eslint-disable-next-line @next/next/no-img-element -- blob URLs, not remote images */}
        <img src={fileSrc(thumbnailPath)} alt="" loading="lazy" className="size-full object-cover" />
        {values.length > 0 && size !== "sm" && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 block h-1/3 px-1.5 pb-1 text-cover-bar/70">
            <WaveArt values={values} align="bottom" gap={0.45} min={0.08} />
          </span>
        )}
      </span>
    );
  }

  return (
    <span className={cx(shell, "grid place-items-center bg-gradient-to-br from-cover to-cover-2")}>
      {values.length ? (
        <span className="block size-full p-[14%] text-cover-bar/60">
          <WaveArt values={size === "sm" ? values.filter((_, i) => i % 4 === 0) : values} gap={0.4} min={0.1} />
        </span>
      ) : (
        <span aria-hidden="true" className="text-cover-ink/70 text-[1.4em] font-bold tracking-[-0.04em]">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

/** A clip's own waveform, in the shape of the frame it exports to. */
export function ClipCover({
  wave,
  className,
  exported,
  aspect,
}: {
  wave?: number[];
  className?: string;
  exported?: boolean;
  aspect?: string;
}) {
  const values = unpackWave(wave);
  const ratio = aspect && aspect !== "original" ? aspect.replace(":", " / ") : undefined;
  return (
    <span
      style={ratio ? { aspectRatio: ratio } : undefined}
      className={cx(
        "relative grid place-items-center overflow-hidden rounded-[14px] bg-gradient-to-br from-cover to-cover-2",
        exported && "ring-1 ring-accent-line",
        className,
      )}
    >
      {values.length ? (
        <span className="block size-full p-[12%] text-cover-bar/60">
          <WaveArt values={values} gap={0.38} min={0.12} />
        </span>
      ) : (
        <span className="h-px w-1/2 bg-cover-bar/40" />
      )}
    </span>
  );
}
