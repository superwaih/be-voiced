/**
 * Captions, painted onto a canvas.
 *
 * This has one job and a hard requirement: draw exactly what the preview draws. The preview is CSS
 * sized in container units; this is a canvas sized in pixels. Both derive from the same caption
 * style, so every number here has a counterpart in `previewVars` in the engine, and the comments
 * say which. Get one wrong and the export quietly disagrees with what someone laid out by hand.
 */

import { captionAnchor, type CaptionGroup } from "@/lib/engine/captions";
import type { CaptionStyle } from "@/lib/engine/types";

/**
 * Caption sizes are given in pixels against a 1080-pixel short side, which is what `1cqmin` means
 * in the preview. Everything else scales from this.
 */
const scaleFor = (width: number, height: number) => Math.min(width, height) / 1080;

/** Text sits within 84% of the frame when placed by hand, and inside an 8% gutter otherwise. */
const maxTextWidth = (width: number, free: boolean) => (free ? width * 0.84 : width * 0.84);

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Token {
  text: string;
  /** The word's own start, so the one being said can be coloured. */
  start: number;
}

interface Line {
  tokens: Token[];
  width: number;
}

/** Wraps tokens into lines that fit, measuring with the font already set on the context. */
function layout(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, tokens: Token[], max: number): Line[] {
  const space = ctx.measureText(" ").width;
  const lines: Line[] = [];
  let current: Token[] = [];
  let width = 0;

  for (const token of tokens) {
    const w = ctx.measureText(token.text).width;
    const next = current.length ? width + space + w : w;
    if (current.length && next > max) {
      lines.push({ tokens: current, width });
      current = [token];
      width = w;
    } else {
      current.push(token);
      width = next;
    }
  }
  if (current.length) lines.push({ tokens: current, width });
  return lines;
}

export interface PaintOptions {
  group: CaptionGroup;
  style: CaptionStyle;
  width: number;
  height: number;
  /** Time within the recording, for colouring the word being said. */
  time: number;
}

/**
 * Draws one caption onto the frame.
 *
 * Returns without drawing when the group is empty, so a frame between captions is left clean.
 */
export function paintCaption(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  { group, style, width, height, time }: PaintOptions,
): void {
  if (!group.words.length) return;

  const scale = scaleFor(width, height);
  const size = style.size * scale;
  const lineHeight = size * 1.28;
  const free = captionAnchor(style);

  ctx.save();
  ctx.font = `${style.bold ? 700 : 400} ${size}px "${style.font}", Arial, sans-serif`;
  ctx.textBaseline = "alphabetic";

  const tokens: Token[] = group.words.map((w) => ({
    text: style.uppercase ? w.text.toUpperCase() : w.text,
    start: w.start,
  }));
  const lines = layout(ctx, tokens, maxTextWidth(width, !!free));
  const blockHeight = lines.length * lineHeight;

  // Where the block sits. Placed by hand, the anchor is its centre — the same point libass uses,
  // and the same point the preview drags. Otherwise it is the edge plus the offset.
  let centreX: number;
  let topY: number;
  if (free) {
    centreX = free.x * width;
    topY = free.y * height - blockHeight / 2;
  } else {
    centreX = width / 2;
    const offset = (style.offset / 100) * height;
    topY =
      style.position === "top"
        ? offset
        : style.position === "middle"
          ? (height - blockHeight) / 2
          : height - offset - blockHeight;
  }

  // Padding matches the preview's `--cap-pad`, and the background is drawn per line because the
  // preview clones its box for each one.
  const padY = style.background ? size * 0.12 : 0;
  const padX = style.background ? size * 0.28 : 0;

  const activeAt = (() => {
    let at = -1;
    for (let i = 0; i < group.words.length; i++) if (group.words[i].start <= time + 0.02) at = i;
    return at;
  })();
  const activeToken = style.activeWord && activeAt >= 0 ? group.words[activeAt].start : null;

  lines.forEach((line, i) => {
    const baseline = topY + i * lineHeight + size;
    const left = centreX - line.width / 2;

    if (style.background) {
      ctx.save();
      ctx.fillStyle = hexWithAlpha(style.backgroundColor, style.backgroundOpacity);
      ctx.fillRect(left - padX, baseline - size + padY * -1, line.width + padX * 2, lineHeight + padY * 2 - (lineHeight - size));
      ctx.restore();
    }

    let x = left;
    const space = ctx.measureText(" ").width;

    for (const token of line.tokens) {
      const w = ctx.measureText(token.text).width;
      const colour = activeToken !== null && token.start === activeToken ? style.highlightColor : style.color;

      // Shadow applies to the text only, and only when there is no background behind it —
      // the same condition the preview uses.
      if (style.shadow && !style.background) {
        ctx.shadowColor = style.shadowColor;
        ctx.shadowOffsetX = size * 0.05;
        ctx.shadowOffsetY = size * 0.05;
        ctx.shadowBlur = 0;
      } else {
        ctx.shadowColor = "transparent";
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = 0;
      }

      // Stroke first, then fill: `paint-order: stroke fill` in the preview, so the outline sits
      // behind the letter rather than eating into it.
      if (style.outline && !style.background) {
        ctx.lineWidth = style.outlineWidth * 2 * scale;
        ctx.strokeStyle = style.outlineColor;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.strokeText(token.text, x, baseline);
      }

      ctx.shadowColor = "transparent";
      ctx.fillStyle = colour;
      ctx.fillText(token.text, x, baseline);

      x += w + space;
    }
  });

  ctx.restore();
}
