#!/usr/bin/env node
// Build-time helper: puts FFmpeg, ffprobe and whisper-cli into src-tauri/binaries with the
// target-triple suffix Tauri expects for `bundle.externalBin`.
//
//   pnpm sidecars                      # host target
//   pnpm sidecars --target aarch64-apple-darwin
//
// FFmpeg: prebuilt static GPL builds (BtbN for Windows, martin-riedl.de for macOS). BtbN rotates its
// release branches, so the newest "nX.Y-latest" asset is looked up from the GitHub API at run time.
// whisper.cpp: built from source with CMake as a single static executable, so no DLLs or dylibs
// need to ship next to it. Requires git, CMake and a C++ toolchain (MSVC Build Tools / Xcode CLT).
//
// Override sources with FFMPEG_URL / FFPROBE_URL (zip archives) or WHISPER_CPP_REF (git tag).
// This script only runs on a developer or CI machine. The app never spawns Node.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");
const WHISPER_REF = process.env.WHISPER_CPP_REF ?? "v1.9.4";

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("Could not read host triple from rustc -vV");
  return line.slice(5).trim();
}

const argIndex = process.argv.indexOf("--target");
const triple = argIndex > -1 ? process.argv[argIndex + 1] : hostTriple();
const isWindows = triple.includes("windows");
const isMac = triple.includes("apple-darwin");
const ext = isWindows ? ".exe" : "";
const isHostWindows = process.platform === "win32";
const only = new Set(process.argv.filter((a) => ["ffmpeg", "whisper", "yt-dlp"].includes(a)));
const want = (name) => only.size === 0 || only.has(name);

/** Newest static GPL release build from BtbN, falling back to the master build. */
async function btbnAsset(platform) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "be-voiced-sidecars" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  // BtbN deletes and recreates the "latest" release on every daily build, so retry briefly on 404.
  let res;
  for (let attempt = 1; attempt <= 4; attempt++) {
    res = await fetch("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest", { headers });
    if (res.ok || (res.status !== 404 && res.status < 500)) break;
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  if (!res.ok) throw new Error(`Could not list BtbN FFmpeg builds (${res.status}). Set FFMPEG_URL to a zip to skip the lookup.`);
  const { assets } = await res.json();
  const pattern = new RegExp(String.raw`^ffmpeg-n(\d+)\.(\d+)-latest-${platform}-gpl-\d+\.\d+\.zip$`);
  const releases = assets
    .map((a) => ({ a, m: a.name.match(pattern) }))
    .filter((x) => x.m)
    .sort((x, y) => Number(y.m[1]) - Number(x.m[1]) || Number(y.m[2]) - Number(x.m[2]));
  const pick = releases[0]?.a ?? assets.find((a) => a.name === `ffmpeg-master-latest-${platform}-gpl.zip`);
  if (!pick) throw new Error(`No ${platform} GPL build found in BtbN's latest release.`);
  return pick.browser_download_url;
}

async function reachable(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return res.ok;
}

async function ffmpegSources() {
  if (process.env.FFMPEG_URL) return { ffmpeg: process.env.FFMPEG_URL, ffprobe: process.env.FFPROBE_URL ?? process.env.FFMPEG_URL };
  if (triple === "x86_64-pc-windows-msvc" || triple === "aarch64-pc-windows-msvc") {
    const url = await btbnAsset(triple.startsWith("aarch64") ? "winarm64" : "win64");
    return { ffmpeg: url, ffprobe: url };
  }
  if (isMac) {
    const arch = triple.startsWith("aarch64") ? "arm64" : "amd64";
    // The release channel occasionally lacks one binary for an architecture; use the snapshot build then.
    const pick = async (name) => {
      const release = `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/release/${name}.zip`;
      if (await reachable(release)) return release;
      console.log(`  ${name} release build unavailable for ${arch}, using the latest snapshot`);
      return `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/snapshot/${name}.zip`;
    };
    return { ffmpeg: await pick("ffmpeg"), ffprobe: await pick("ffprobe") };
  }
  throw new Error(`No FFmpeg source configured for ${triple}. Set FFMPEG_URL and FFPROBE_URL.`);
}

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  using cached ${dest}`);
    return;
  }
  console.log(`  downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const partial = `${dest}.partial`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
  renameSync(partial, dest);
}

/**
 * Extract a zip archive. On Windows, call the bundled bsdtar by absolute path: Git Bash puts GNU tar
 * first on PATH, and GNU tar treats "C:" in an archive path as a remote host.
 */
function extractZip(zip, dir) {
  if (isHostWindows) {
    const bsdtar = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "tar.exe");
    if (existsSync(bsdtar)) {
      try {
        execFileSync(bsdtar, ["-xf", zip, "-C", dir], { stdio: "inherit" });
        return;
      } catch {
        console.log("  bsdtar failed, falling back to PowerShell Expand-Archive");
      }
    }
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("tar", ["-xf", zip, "-C", dir], { stdio: "inherit" });
}

function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const found = findFile(p, name);
      if (found) return found;
    } else if (entry === name) return p;
  }
  return null;
}

/**
 * Ad-hoc code signature, which costs nothing and needs no Apple account.
 *
 * Apple Silicon refuses to run a binary with no signature at all, and anything fetched from the web
 * or stitched together with lipo arrives either unsigned or with its signature invalidated. Signing
 * with "-" satisfies that requirement. It is not notarization: Gatekeeper still warns on first run.
 */
function adhocSign(file) {
  if (process.platform !== "darwin") return;
  try {
    execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", file], { stdio: "pipe" });
  } catch (err) {
    console.log(`  could not sign ${file}: ${String(err.message).split(String.fromCharCode(10))[0]}`);
  }
}

function install(src, name) {
  const dest = join(outDir, `${name}-${triple}${ext}`);
  copyFileSync(src, dest);
  if (!isWindows) chmodSync(dest, 0o755);
  if (isMac) adhocSign(dest);
  console.log(`  installed ${dest}`);
}

/** Architectures inside a Mach-O file, so an already-universal binary is not lipo'd again. */
function machoArchs(file) {
  try {
    return execFileSync("lipo", ["-archs", file], { encoding: "utf8" }).trim().split(/\s+/);
  } catch {
    return [];
  }
}

async function fetchFfmpeg() {
  console.log(`FFmpeg for ${triple}`);
  const sources = await ffmpegSources();
  const work = join(tmpdir(), `bevoiced-ffmpeg-${Date.now()}`);
  const cache = join(root, "src-tauri", "target", "sidecar-cache");
  mkdirSync(work, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const archives = new Map();
  for (const [name, url] of Object.entries(sources)) {
    if (!archives.has(url)) {
      const zip = join(cache, `${triple}-${name}-${decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "archive.zip")}`);
      await download(url, zip);
      const dir = join(work, `x${archives.size}`);
      mkdirSync(dir);
      extractZip(zip, dir);
      archives.set(url, dir);
    }
    const bin = findFile(archives.get(url), `${name}${ext}`);
    if (!bin) throw new Error(`${name}${ext} not found in ${url}`);
    install(bin, name);
  }
  rmSync(work, { recursive: true, force: true });
}

/**
 * yt-dlp resolves a pasted link (X, YouTube, podcast pages) to a media stream. It ships as a single
 * self-contained binary per platform, so there is nothing to build.
 */
async function fetchYtDlp() {
  console.log(`yt-dlp for ${triple}`);
  const asset = isWindows
    ? triple.startsWith("aarch64")
      ? null
      : "yt-dlp.exe"
    : isMac
      ? "yt-dlp_macos"
      : triple.startsWith("aarch64")
        ? "yt-dlp_linux_aarch64"
        : "yt-dlp_linux";
  if (!asset) throw new Error(`yt-dlp has no prebuilt binary for ${triple}. Links cannot be imported on this target.`);
  const cache = join(root, "src-tauri", "target", "sidecar-cache");
  mkdirSync(cache, { recursive: true });
  const dest = join(cache, asset);
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, dest);
  install(dest, "yt-dlp");
}

function buildWhisper() {
  console.log(`whisper.cpp ${WHISPER_REF} for ${triple}`);
  const cacheDir = join(root, "src-tauri", "target", "whisper.cpp");
  if (!existsSync(join(cacheDir, ".git"))) {
    execFileSync("git", ["clone", "--depth", "1", "--branch", WHISPER_REF, "https://github.com/ggml-org/whisper.cpp.git", cacheDir], {
      stdio: "inherit",
    });
  }
  const buildDir = join(cacheDir, `build-${triple}`);
  const args = [
    "-S", cacheDir,
    "-B", buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_SDL2=OFF",
    // Portable CPU code: a build tuned to this machine's AVX-512 would crash on older CPUs.
    "-DGGML_NATIVE=OFF",
  ];
  if (isWindows) {
    args.push("-DCMAKE_POLICY_DEFAULT_CMP0091=NEW", "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded");
    if (triple.startsWith("aarch64")) args.push("-A", "ARM64");
  }
  if (isMac) {
    args.push(
      `-DCMAKE_OSX_ARCHITECTURES=${triple.startsWith("aarch64") ? "arm64" : "x86_64"}`,
      "-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0",
      "-DGGML_METAL=ON",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
    );
  }
  execFileSync("cmake", args, { stdio: "inherit" });
  execFileSync("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-cli", "-j"], { stdio: "inherit" });
  const bin = [join(buildDir, "bin", "Release", `whisper-cli${ext}`), join(buildDir, "bin", `whisper-cli${ext}`)].find(existsSync);
  if (!bin) throw new Error("whisper-cli was not produced by the build");
  install(bin, "whisper-cli");
}

function universalMac() {
  // Tauri resolves `<name>-universal-apple-darwin` for universal builds: build both slices, then lipo.
  for (const t of ["aarch64-apple-darwin", "x86_64-apple-darwin"]) {
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), "--target", t, ...only], { stdio: "inherit" });
  }
  for (const name of ["ffmpeg", "ffprobe", "whisper-cli", "yt-dlp"]) {
    const parts = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((t) => join(outDir, `${name}-${t}`));
    if (!parts.every(existsSync)) continue;
    const dest = join(outDir, `${name}-universal-apple-darwin`);
    const already = parts.find((p) => machoArchs(p).includes("arm64") && machoArchs(p).includes("x86_64"));
    if (already) {
      // yt-dlp ships one binary that already carries both slices; lipo refuses to merge those.
      copyFileSync(already, dest);
    } else {
      execFileSync("lipo", ["-create", ...parts, "-output", dest], { stdio: "inherit" });
    }
    chmodSync(dest, 0o755);
    // lipo and copy both drop the signature the parts had, so sign the result, not the parts.
    adhocSign(dest);
    console.log(`  installed ${dest}`);
  }
}

mkdirSync(outDir, { recursive: true });
try {
  if (triple === "universal-apple-darwin") {
    universalMac();
    console.log("Sidecars ready.");
    process.exit(0);
  }
  if (want("ffmpeg")) await fetchFfmpeg();
  if (want("yt-dlp")) await fetchYtDlp();
  if (want("whisper")) buildWhisper();
  console.log("Sidecars ready.");
} catch (err) {
  console.error(`\n${err.message}`);
  process.exit(1);
}
