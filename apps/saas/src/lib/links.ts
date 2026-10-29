"use client";

/**
 * Pasting a link.
 *
 * Two steps, so the interface can show what it found before committing to a download: a probe that
 * reads the link, then a fetch that pulls the media through the server and hands it over as a
 * file. From there it is an ordinary recording — the same import, the same transcription, the same
 * everything.
 */

import type { LinkInfo } from "@/lib/engine/types";
import { remember } from "@/lib/files";

export class LinkCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "LinkCancelled";
  }
}

/** Reads a link without downloading it. */
export async function probeLink(url: string, signal?: AbortSignal): Promise<LinkInfo> {
  const res = await fetch(`/api/link?url=${encodeURIComponent(url)}`, { signal });
  const body = (await res.json()) as LinkInfo & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Could not read that link.");
  return body;
}

const EXTENSION: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function fileNameFor(info: LinkInfo, type: string): string {
  const fromUrl = info.mediaUrl.split("?")[0].split("/").pop() ?? "";
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(fromUrl);
  if (hasExtension) return decodeURIComponent(fromUrl);
  const ext = EXTENSION[type.split(";")[0].trim().toLowerCase()] ?? "m4a";
  const safe = info.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Recording";
  return `${safe}.${ext}`;
}

/**
 * Downloads what the probe found and returns it as a file.
 *
 * Progress is only honest when the server knows the length; a yt-dlp stream does not, so that
 * reports bytes so far rather than a percentage.
 */
export async function fetchLink(
  info: LinkInfo,
  onProgress: (p: { progress: number | null; detail: string | null }) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(
    `/api/link/media?url=${encodeURIComponent(info.mediaUrl)}&resolver=${encodeURIComponent(info.resolver)}`,
    { signal },
  );
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not download that link.");
  }

  const declared = Number(res.headers.get("content-length")) || info.size || 0;
  const type = res.headers.get("content-type") ?? "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (signal?.aborted) {
      await reader.cancel();
      throw new LinkCancelled();
    }
    chunks.push(value);
    received += value.length;
    // Reporting every chunk would be hundreds of renders a second on a fast connection.
    if (received - lastReport > 400_000) {
      lastReport = received;
      const mb = `${(received / 1_048_576).toFixed(1)} MB`;
      onProgress({
        progress: declared ? Math.min(1, received / declared) : null,
        detail: declared ? `${mb} of ${(declared / 1_048_576).toFixed(1)} MB` : mb,
      });
    }
  }

  if (!received) throw new Error("That link returned nothing. It may need yt-dlp on the server.");

  const blob = new Blob(chunks as BlobPart[], { type: type || "application/octet-stream" });
  const file = new File([blob], fileNameFor(info, type), { type: blob.type });
  return remember(file);
}
