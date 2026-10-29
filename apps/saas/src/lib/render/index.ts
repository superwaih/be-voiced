"use client";

/**
 * Burning captions into the picture, in the browser.
 *
 * ffmpeg.wasm cannot do this: its published core is built with no `--enable-lib*` flags at all, so
 * there is no libass for subtitles, no libfreetype for drawn text, and no libx264 to encode H.264
 * with. WebCodecs can, and does it on the graphics card — the browser decodes each frame, we draw
 * the caption on it, and the browser encodes the result. Mediabunny handles reading the container
 * and writing the MP4 around that.
 *
 * The caption is painted by `paint.ts`, from the same style the preview uses, so what comes out is
 * what was laid out.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  QUALITY_HIGH,
  type VideoSample,
} from "mediabunny";
import { findGroup, groupCaptions, type CaptionGroup } from "@/lib/engine/captions";
import type { FlatWord } from "@/lib/engine/transcript";
import type { CaptionStyle } from "@/lib/engine/types";
import { paintCaption } from "./paint";

export class RenderCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "RenderCancelled";
  }
}

/** Whether this browser can encode video at all. */
export function canRenderHere(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

/** Whether it can encode the codec we actually want to hand someone. */
export async function canRenderH264(width = 1280, height = 720): Promise<boolean> {
  if (!canRenderHere()) return false;
  try {
    const r = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001f",
      width,
      height,
      bitrate: 4_000_000,
      framerate: 30,
    });
    return !!r.supported;
  } catch {
    return false;
  }
}

export interface RenderOptions {
  file: File;
  /** Word timings for the whole recording. Captions are grouped from these. */
  words: FlatWord[];
  style: CaptionStyle;
  /** Seconds into the recording. The whole thing, for the Captions screen. */
  start: number;
  end: number;
  /** Output frame, already worked out from the aspect and resolution. */
  width: number;
  height: number;
  /** 0 to 1, where to take the crop from horizontally when the shape changes. */
  framing: number;
  captionsEnabled: boolean;
  onProgress: (p: { stage: string; progress: number | null }) => void;
  signal?: AbortSignal;
}

export async function renderCaptionedVideo(opts: RenderOptions): Promise<Blob> {
  if (!canRenderHere()) throw new Error("This browser cannot encode video.");
  if (opts.signal?.aborted) throw new RenderCancelled();

  const { width, height } = opts;
  opts.onProgress({ stage: "Preparing", progress: null });

  const groups: CaptionGroup[] = opts.captionsEnabled
    ? groupCaptions(
        opts.words.filter((w) => w.end > opts.start && w.start < opts.end),
        opts.style.wordsPerCaption,
        0,
      )
    : [];

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(opts.file) });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  // One canvas for the whole render. Made on demand because its size is only certain once the
  // first frame arrives, and reused after that.
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;

  const process = (sample: VideoSample) => {
    if (opts.signal?.aborted) throw new RenderCancelled();

    if (!canvas) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("This browser would not give us a canvas to draw on.");
    }
    const c = ctx!;

    // Cover crop: fill the output frame, taking the overflow from where `framing` says. This is
    // the same rule as `object-fit: cover` with `object-position` in the preview.
    const sw = sample.displayWidth;
    const sh = sample.displayHeight;
    const scale = Math.max(width / sw, height / sh);
    const cropW = Math.min(sw, width / scale);
    const cropH = Math.min(sh, height / scale);
    const sx = (sw - cropW) * opts.framing;
    const sy = (sh - cropH) / 2;

    c.fillStyle = "#000";
    c.fillRect(0, 0, width, height);
    sample.draw(c, sx, sy, cropW, cropH, 0, 0, width, height);

    if (groups.length) {
      // The sample's timestamp is in the source's own timeline; captions were grouped from the
      // same timeline, so they line up without any offset arithmetic.
      const at = sample.timestamp;
      const index = findGroup(groups, at);
      if (index >= 0) paintCaption(c, { group: groups[index], style: opts.style, width, height, time: at });
    }

    return canvas;
  };

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: opts.start, end: opts.end },
    video: {
      width,
      height,
      fit: "fill",
      codec: "avc",
      quality: QUALITY_HIGH,
      process,
    },
    audio: { codec: "aac", quality: new Quality(128_000) },
  });

  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((t) => t.reason).join(", ");
    throw new Error(why ? `This file cannot be re-encoded here: ${why}` : "This file cannot be re-encoded here.");
  }

  conversion.onProgress = (progress) => opts.onProgress({ stage: "Rendering", progress });

  const stop = () => conversion.cancel();
  opts.signal?.addEventListener("abort", stop, { once: true });

  try {
    await conversion.execute();
  } catch (err) {
    if (opts.signal?.aborted) throw new RenderCancelled();
    throw err;
  } finally {
    opts.signal?.removeEventListener("abort", stop);
  }

  if (opts.signal?.aborted) throw new RenderCancelled();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Rendering finished without producing a file.");
  opts.onProgress({ stage: "Finishing", progress: 1 });
  return new Blob([buffer], { type: "video/mp4" });
}
