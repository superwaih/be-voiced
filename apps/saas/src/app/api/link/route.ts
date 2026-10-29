/**
 * Looking at a link without downloading it.
 *
 * Three kinds, tried in order, the same order the desktop app uses:
 *
 *   1. a direct media URL (`…/episode.mp3`) — a HEAD request is enough
 *   2. a podcast feed — the newest `<enclosure>` is the episode
 *   3. everything else — yt-dlp, when it is installed
 *
 * This runs on the server for two reasons that are not negotiable in a browser: a page cannot
 * fetch arbitrary cross-origin media, and it certainly cannot run yt-dlp.
 *
 * Worth knowing before pointing this at YouTube in production: a service that downloads from video
 * sites on request is a different legal posture from a person doing it on their own machine, and
 * the server's IP gets rate-limited and blocked at any volume. The first two resolvers have
 * neither problem.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import type { LinkInfo } from "@/lib/engine/types";
import { ytdlp } from "@/server/config";

export const runtime = "nodejs";
export const maxDuration = 60;

const run = promisify(execFile);
const UA = "Mozilla/5.0 (compatible; BeVoiced/0.1)";
const MEDIA = /\.(mp4|mov|mkv|webm|mp3|wav|m4a|aac|ogg|opus|flac)(\?|$)/i;

// Re-exported so the media route uses exactly the same resolution: env, then ./bin, then PATH.
export const ytdlpPath = ytdlp;

/** Only http and https, and no addresses inside our own network. */
function safeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https links work here.");
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|::1$)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("That address is not reachable from here.");
  return url;
}

function titleFromPath(path: string): string {
  const name = path.split("?")[0].split("/").pop() || "Recording";
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  const cleaned = decodeURIComponent(stem).replace(/[_-]+/g, " ").trim();
  return cleaned || "Recording";
}

const tag = (xml: string, name: string) => {
  const open = xml.indexOf(`<${name}`);
  if (open < 0) return undefined;
  const gt = xml.indexOf(">", open);
  const close = xml.indexOf(`</${name}>`, gt);
  if (gt < 0 || close < 0) return undefined;
  return xml
    .slice(gt + 1, close)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .trim();
};

/** The newest episode of a podcast feed: the first item's enclosure. */
function feedEpisode(xml: string): { url: string; title: string; duration: number | null; author?: string } | null {
  const start = xml.indexOf("<item");
  if (start < 0) return null;
  const end = xml.indexOf("</item>", start);
  const item = xml.slice(start, end < 0 ? undefined : end);

  const enc = item.indexOf("<enclosure");
  if (enc < 0) return null;
  const encEnd = item.indexOf(">", enc);
  const urlMatch = /url="([^"]+)"/.exec(item.slice(enc, encEnd));
  if (!urlMatch) return null;

  const raw = tag(item, "itunes:duration");
  let duration: number | null = null;
  if (raw) {
    const parts = raw.split(":").map((p) => Number(p.trim()));
    if (parts.every((n) => Number.isFinite(n))) {
      duration = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
    }
  }

  return {
    url: urlMatch[1].replace(/&amp;/g, "&"),
    title: tag(item, "title") ?? "Podcast episode",
    duration,
    author: tag(xml, "itunes:author") ?? tag(xml, "title"),
  };
}

async function probeWithYtdlp(url: string, host: string): Promise<LinkInfo> {
  let stdout: string;
  try {
    ({ stdout } = await run(ytdlpPath(), ["-J", "--no-warnings", "--no-playlist", url], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 45_000,
    }));
  } catch {
    throw new Error(
      `That link needs yt-dlp, which this server cannot find (looked for "${ytdlp()}"). ` +
        "Direct media links and podcast feeds work without it.",
    );
  }

  const info = JSON.parse(stdout) as {
    title?: string;
    uploader?: string;
    duration?: number;
    thumbnail?: string;
    filesize?: number;
    filesize_approx?: number;
    is_live?: boolean;
    webpage_url?: string;
    extractor_key?: string;
  };

  return {
    resolver: "yt-dlp",
    mediaUrl: url,
    pageUrl: info.webpage_url ?? url,
    title: info.title ?? "Recording",
    uploader: info.uploader ?? null,
    duration: info.duration ?? null,
    thumbnail: info.thumbnail ?? null,
    size: info.filesize ?? info.filesize_approx ?? null,
    isLive: !!info.is_live,
    site: info.extractor_key ?? host,
  };
}

/**
 * Whether yt-dlp is on this box, asked once and remembered.
 *
 * The interface asks before offering, so pasting a YouTube link into a server that cannot fetch it
 * says so up front instead of after the attempt.
 */
let ytdlpReady: boolean | null = null;

async function hasYtdlp(): Promise<boolean> {
  if (ytdlpReady !== null) return ytdlpReady;
  try {
    await run(ytdlp(), ["--version"], { timeout: 10_000 });
    ytdlpReady = true;
  } catch {
    ytdlpReady = false;
  }
  return ytdlpReady;
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");

  // No link: the caller is asking what this server can fetch.
  if (!raw) {
    return NextResponse.json({ ytdlp: await hasYtdlp() });
  }

  let url: URL;
  try {
    url = safeUrl(raw.trim());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That link is not valid." }, { status: 400 });
  }

  // 1. A media file we can stream straight off the web.
  if (MEDIA.test(url.pathname)) {
    let size: number | null = null;
    try {
      const head = await fetch(url, { method: "HEAD", headers: { "user-agent": UA } });
      const length = head.headers.get("content-length");
      if (head.ok && length) size = Number(length);
    } catch {
      // A HEAD that fails is not fatal; the size is a nicety.
    }
    const info: LinkInfo = {
      resolver: "direct",
      mediaUrl: url.toString(),
      pageUrl: url.toString(),
      title: titleFromPath(url.pathname),
      uploader: null,
      duration: null,
      thumbnail: null,
      size,
      isLive: false,
      site: url.hostname,
    };
    return NextResponse.json(info);
  }

  // 2. A podcast feed.
  try {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    if (res.ok && (type.includes("xml") || url.pathname.endsWith(".rss"))) {
      const body = await res.text();
      const episode = feedEpisode(body);
      if (episode) {
        const info: LinkInfo = {
          resolver: "feed",
          mediaUrl: episode.url,
          pageUrl: url.toString(),
          title: episode.title,
          uploader: episode.author ?? null,
          duration: episode.duration,
          thumbnail: null,
          size: null,
          isLive: false,
          site: url.hostname,
        };
        return NextResponse.json(info);
      }
    }
  } catch {
    // Not a feed, or unreachable. Fall through to yt-dlp.
  }

  // 3. Everything else.
  try {
    return NextResponse.json(await probeWithYtdlp(url.toString(), url.hostname));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read that link." }, { status: 422 });
  }
}
