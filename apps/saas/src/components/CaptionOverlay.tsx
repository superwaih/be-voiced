"use client";

/**
 * Captions drawn over the picture, exactly where they will be burned in.
 *
 * Sizes are in container units against the video box, so what you place here is what the worker
 * renders. Dragging moves the line's centre — the same anchor libass uses — rather than a corner,
 * which is why the grab offset is measured from where the line actually sits rather than from the
 * preset's nominal position.
 */

import { memo, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { captionAnchor, findGroup, groupCaptions, previewVars } from "@/lib/engine/captions";
import type { CaptionStyle } from "@/lib/engine/types";
import type { FlatWord } from "@/lib/engine/transcript";
import { cx } from "@/lib/cx";
import { player, usePlayerState, usePlayerTime } from "@/lib/player";

export const CaptionOverlay = memo(function CaptionOverlay({
  style,
  words,
  onMove,
}: {
  style: CaptionStyle;
  words: FlatWord[];
  /** Supplied where the caption can be dragged. Receives the new centre as fractions of the frame. */
  onMove?: (x: number, y: number) => void;
}) {
  const groups = useMemo(() => groupCaptions(words, style.wordsPerCaption, 0), [words, style.wordsPerCaption]);
  const layerRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ g: number; w: number }>({ g: -1, w: -1 });
  const posRef = useRef(pos);
  const { playing } = usePlayerState();

  usePlayerTime(
    (t) => {
      let g = findGroup(groups, t);
      if (g < 0 && player.el?.paused !== false && groups.length) {
        // Paused between captions, show the next one, so styling is never done blind.
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

  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const frame = () => layerRef.current!.getBoundingClientRect();

  const startDrag = (e: ReactPointerEvent) => {
    if (!onMove || !layerRef.current) return;
    const r = frame();
    const line = e.currentTarget.getBoundingClientRect();
    const at = {
      x: (line.left + line.width / 2 - r.left) / r.width,
      y: (line.top + line.height / 2 - r.top) / r.height,
    };
    grab.current = { dx: (e.clientX - r.left) / r.width - at.x, dy: (e.clientY - r.top) / r.height - at.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onDrag = (e: ReactPointerEvent) => {
    if (!grab.current || !onMove || e.buttons !== 1) return;
    const r = frame();
    onMove(clamp((e.clientX - r.left) / r.width - grab.current.dx), clamp((e.clientY - r.top) / r.height - grab.current.dy));
  };

  const group = pos.g >= 0 ? groups[pos.g] : null;
  const free = captionAnchor(style);

  return (
    <div
      ref={layerRef}
      aria-hidden="true"
      style={previewVars(style) as CSSProperties}
      className={cx("cap-layer", free ? "is-free" : `is-${style.position}`, onMove && "is-draggable")}
    >
      {group && (
        <div
          className="cap-line"
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={() => (grab.current = null)}
          title={onMove ? "Drag to move the captions" : undefined}
        >
          <span className="cap-text" style={{ fontWeight: style.bold ? 700 : 400 }}>
            {group.words.map((w, k) => (
              <span key={k} className={cx("cap-word", style.activeWord && k === pos.w && "is-active")}>
                {style.uppercase ? w.text.toUpperCase() : w.text}
                {k < group.words.length - 1 ? " " : ""}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
});
