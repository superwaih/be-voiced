/**
 * Handing the media itself to the browser.
 *
 * The browser cannot fetch it directly: the sites these links point at do not send CORS headers,
 * so a page is not allowed to read the bytes even though it can play them. This passes them
 * through, which also keeps the browser out of the business of following redirects and signing
 * anything.
 *
 * The response is streamed rather than buffered. A podcast episode is a hundred megabytes and
 * holding one in the server's memory per listener is how a small box falls over.
 */

import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { ytdlp as ytdlpPath } from "@/server/config";

export const runtime = "nodejs";
export const maxDuration = 300;

const UA = "Mozilla/5.0 (compatible; Soundbite/0.1)";

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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("url");
  const resolver = params.get("resolver") ?? "direct";
  if (!raw) return NextResponse.json({ error: "No link was given." }, { status: 400 });

  let url: URL;
  try {
    url = safeUrl(raw.trim());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That link is not valid." }, { status: 400 });
  }

  // Sites yt-dlp handles: it works out the real media URL, and writes the file to stdout so
  // nothing has to land on the server's disk.
  if (resolver === "yt-dlp") {
    const child = spawn(
      ytdlpPath(),
      ["--no-warnings", "--no-playlist", "-f", "bestaudio[ext=m4a]/bestaudio/best", "-o", "-", url.toString()],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      // Reported through the empty body; the client treats a short read as a failure.
      console.error("yt-dlp could not start. Is it installed?");
    });
    child.on("close", (code) => {
      if (code !== 0) console.error("yt-dlp failed", code, stderr.slice(0, 500));
    });

    request.signal.addEventListener("abort", () => child.kill("SIGKILL"));

    return new Response(Readable.toWeb(child.stdout) as ReadableStream, {
      headers: {
        "content-type": "audio/mp4",
        "cache-control": "no-store",
      },
    });
  }

  // Direct files and podcast enclosures: pass the bytes through as they arrive.
  let upstream: Response;
  try {
    upstream = await fetch(url, { headers: { "user-agent": UA }, signal: request.signal });
  } catch {
    return NextResponse.json({ error: "Could not reach that link." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `That link returned ${upstream.status}.` }, { status: 502 });
  }

  const headers = new Headers({ "cache-control": "no-store" });
  const type = upstream.headers.get("content-type");
  const length = upstream.headers.get("content-length");
  if (type) headers.set("content-type", type);
  if (length) headers.set("content-length", length);

  return new Response(upstream.body, { headers });
}
