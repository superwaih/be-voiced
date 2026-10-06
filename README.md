# Be Voiced

A desktop app for finding the parts of long conversations worth publishing.

Import a podcast, interview, webinar, meeting or X Space, transcribe it locally with whisper.cpp or in the cloud with Deepgram, let Be Voiced find the strongest moments, then trim, caption and export clips.

```
Import or paste a link  ->  Transcribe  ->  Read, ask and edit  ->  Find moments  ->  Trim  ->  Caption  ->  Export
```

## Stack

| Layer | Choice |
| --- | --- |
| Shell | Tauri v2 (Rust) |
| UI | React 19, TypeScript, Vite, zustand, Motion, Phosphor icons, Manrope and IBM Plex Mono |
| Media | FFmpeg and ffprobe sidecars |
| Links | yt-dlp sidecar, plus direct media URLs and podcast feeds handled in Rust |
| Local transcription | whisper.cpp (`whisper-cli`) sidecar |
| Cloud transcription | Deepgram `nova-3` (diarization, punctuation, word timings, confidence) |
| Topics and signals | Deepgram Text Intelligence (`/v1/read`: topics, intents, sentiment), optional |
| Moment finder | Local transcript analysis in `src/lib/moments.ts` |
| Answers | Local retrieval over the transcript in `src/lib/ask.ts` |

No LLM API is used. All processing runs through Rust commands. The webview never spawns processes and never sees the Deepgram key.

## Getting started

Prerequisites: Node 20+, pnpm, Rust (stable). Building whisper.cpp also needs git, CMake and a C++ toolchain (Visual Studio Build Tools on Windows, Xcode Command Line Tools on macOS).

```bash
pnpm install
pnpm sidecars            # downloads FFmpeg/ffprobe and yt-dlp, builds whisper-cli for this machine
pnpm tauri dev
```

`pnpm sidecars` writes to `src-tauri/binaries/` using the target-triple names Tauri requires (for example `ffmpeg-x86_64-pc-windows-msvc.exe`). It can fetch one part at a time: `pnpm sidecars ffmpeg`, `pnpm sidecars yt-dlp` or `pnpm sidecars whisper`. Downloads are cached in `src-tauri/target/sidecar-cache`.

Tauri refuses to compile while any `externalBin` entry is missing, so there are variants for partial setups:

| Command | Needs | Use when |
| --- | --- | --- |
| `pnpm tauri dev` | FFmpeg, ffprobe, whisper-cli, yt-dlp | Everything is installed |
| `pnpm app:dev:no-whisper` | FFmpeg, ffprobe, yt-dlp | whisper.cpp is not built yet. Import, links, Deepgram transcription, moments and export all work |
| `pnpm app:dev:ui` | nothing | Interface work only. Media features report the missing engine |

In the running app, open **Settings** to:

1. Download a Whisper model (fetched once from Hugging Face, then used offline).
2. Optionally add a Deepgram key. It goes straight to the OS credential store (Windows Credential Manager or macOS Keychain). The UI can save, test or remove the key, never read it back.

### Visual QA without the native shell

`pnpm dev`, then open `http://localhost:1420/?qa` (add `&theme=dark` and `&open`). This loads a sample project through Tauri's official IPC mocks. It exists only in dev builds and is not part of the production bundle.

## How it works

**Import.** Drag a file onto the window or use the file picker. ffprobe reads duration, streams and rotation; FFmpeg grabs a thumbnail and decodes a waveform. Source media plays in place through Tauri's asset protocol, scoped to files you imported. If the webview cannot decode a container (common for MKV), the player offers a 720p H.264 preview copy; exports always use the original.

**Links.** Paste a URL in **Ask a link** and the media is fetched into a new project, so everything downstream behaves exactly as an imported file. Three resolvers are tried in order: a direct media URL is streamed with Rust, a podcast feed has its newest enclosure pulled, and anything else goes to the bundled yt-dlp (X and Twitter videos, YouTube, Vimeo, SoundCloud, show pages). Video is capped at 720p and merged to MP4 with the bundled FFmpeg, which is also what makes X's HLS streams work. The link is probed before anything downloads, so you see the title, uploader and length first, and the download reports real progress and cancels. Podcast and direct links work even in a build without the yt-dlp sidecar. Fetching media you do not have the rights to may breach a site's terms; that call is yours.

**Answers.** The **Ask a link** tab answers questions about a recording from its transcript (`src/lib/ask.ts`). It reads the question's intent, retrieves the passages that answer it (rare words weighted, loose stemming, phrase bonus, neighbour smoothing so answers come out as passages rather than clipped sentences) and replies with a short lead plus the passages themselves, each with a timestamp that plays that moment. "Top moments" reuses the moment finder, "what is this about" uses the topics, and questions about speakers or length are answered from the transcript's own facts. It runs on this computer, needs no key, and never paraphrases past what was said: when nothing matches, it says so rather than inventing an answer. Engines are pluggable (`Engine` in `ask.ts`), so a cloud engine can be added without touching the interface.

Conversations are kept apart from recordings, in `ask-history.json` under app data (`src-tauri/src/history.rs`). The two flows only refer to each other by id: clearing history leaves every recording in place, deleting a recording leaves its conversation readable, and a new link takes over the tab while the previous conversation drops into History.

**Transcription.** Both engines produce the same shape (`src-tauri/src/transcript.rs`): timed words grouped into speaker segments.
- Local: FFmpeg extracts 16 kHz mono WAV, `whisper-cli` runs with full JSON output, tokens are merged into words with timings and probabilities. Whisper does not separate speakers; select text and use **Split turn**, then set the speaker from its label.
- Cloud: FFmpeg encodes compact Opus audio (FLAC fallback), Rust streams it to Deepgram with upload progress.

**Transcript.** Click any word to seek. The spoken word is highlighted during playback. Search across word boundaries, rename and reassign speakers, edit text inline. Edits keep exact timings for unchanged words and interpolate new ones. Select text to create a clip.

**Moments.** `src/lib/moments.ts` asks: if someone could only watch a few minutes of this conversation, which moments would they choose? It scores every sentence-aligned window of roughly 30 to 90 seconds, so clips always start and end on sentence boundaries, on:
- what is said: strong or contrarian opinions, explanations, advice, predictions, disagreements, stories, humour, statistics and quotable lines
- structure: a question answered at length by another speaker, endings that land, one clear voice
- delivery: speaking energy relative to the rest of the conversation
- penalties: filler, housekeeping (sponsor reads, "subscribe"), intros and outros, low-confidence transcription

With a Deepgram key, Deepgram Text Intelligence adds sentiment strength, intents and topic coherence to the score and names the topics. Without one, everything still runs on this computer, and topics come from distinctive phrases in each passage. Non-overlapping winners are kept only while they are close in quality to the best one. Each moment gets a title (its most quotable standalone sentence), range, speaker, topic, category, summary, a reason built from the signals that picked it, and a score. **Find more** skips existing clips and can favour words you type.

**Editor.** One column for the work and one for the settings. The clip plays in its target frame (Original, 16:9, 1:1, 4:5, 9:16, chosen in the header) above a waveform trim timeline whose handles snap to word boundaries (hold Alt for free movement) and the clip's own words. The side column holds length (sentence-level extend and shorten, plus a framing control when the frame crops), why the moment was picked, and captions (three presets, with the full style controls behind **Customize style**). Export opens as a dialog: frame, length, resolution, captions, file name and folder, with progress, the finished file and subtitle side files. Undo and redo cover every edit.

**Captions tab.** A video and its own words: add a file, transcribe it, and the transcript plays as
subtitles over the picture in the frame it will export to. Captions are dragged into place on the video itself
and sized with a slider, and the placement is written as a fraction of the frame so the preview and
the burned-in render agree exactly (libass gets `\an5\pos()`, the preview the same anchor in CSS).
Styling is the same engine the clip editor uses, so presets and every control behave identically, and the whole recording renders with the
subtitles burned in, or exports as an SRT or VTT beside it. This surface is about the video, not the
text: editing the words themselves belongs in the workspace transcript.

**Caption engine.** One engine (`src/lib/captions.ts`) drives the live preview, SRT and VTT files, and the ASS document FFmpeg burns in, including per-word active highlighting. Three presets: Studio, Punch and Subtitle. Font, size, weight, case, colours, outline, shadow, background box, position and words per caption are all adjustable.

**Export.** H.264/AAC MP4 at 720p or 1080p with real FFmpeg progress and cancel, plus SRT/VTT for a clip and TXT/SRT/VTT for the full transcript. Finished exports can be opened or revealed in Finder or File Explorer. Audio-only sources render captions over a dark frame.

**Storage.** Projects live in the app data folder (`%APPDATA%\org.buildsystems.bevoiced\projects` on Windows, `~/Library/Application Support/org.buildsystems.bevoiced/projects` on macOS). Each project folder holds `project.json` (source, transcript, speakers, topics, clips, caption settings, export history), a small `meta.json` for library views (including waveform cover art), the thumbnail, waveform peaks and any preview copy. Edits autosave after a short pause and on window close; the last open project is restored at launch.

## Packaging

```bash
pnpm app:build                   # Windows: NSIS + MSI. macOS: .app + .dmg for the host architecture
pnpm app:build:mac-universal     # macOS universal .app/.dmg (builds both sidecar slices and lipos them)
```

For another target, run `pnpm sidecars --target <triple>` first, then `pnpm tauri build --target <triple>`. App icons are generated from `src-tauri/app-icon.svg` with `pnpm tauri icon src-tauri/app-icon.svg -o src-tauri/icons`.

### Building for macOS from Windows

You cannot. A `.app`/`.dmg` needs macOS tooling, and the sidecars must be macOS binaries (whisper.cpp is compiled from source per platform). Either build on a Mac, or push the repo and run the **Build installers** workflow in
`.github/workflows/build.yml`, which produces a universal macOS bundle on `macos-14` and the Windows
MSI/NSIS installers on `windows-latest`.

- **Run it from the Actions tab** for a test build. The installers appear as *artifacts* on the run
  page: login-only, zipped by GitHub, deleted after 90 days.
- **Push a `v*` tag** (`git tag v0.1.0 && git push origin v0.1.0`) to also publish a GitHub Release
  with the same files attached, which is the permanent public link to hand to anyone else. The
  release notes carry the first-run instructions for both platforms.

### macOS without an Apple Developer account

The build is **ad-hoc signed** (`signingIdentity: "-"`), which costs nothing and needs no account,
certificate or keychain. That signature is not cosmetic: Apple Silicon refuses to run a binary with
no signature at all, so every sidecar is signed as it is installed, the lipo'd universal binaries are
signed again afterwards (merging drops the signature), and the workflow seals the finished bundle.

What ad-hoc signing does not buy is notarization, so macOS still stops the first launch. Installing
takes one extra step, which belongs in your download page:

1. Open the `.dmg` and drag **Be Voiced** to Applications, or unzip `be-voiced-macos-universal.zip`
   straight into Applications.
2. Launch it once. macOS refuses, saying the developer cannot be verified.
3. Open **System Settings → Privacy & Security**, scroll to the message about Be Voiced and choose
   **Open Anyway**. On older macOS, right-click the app and choose **Open** instead.

One command does the same thing, for anyone who prefers it:

```bash
xattr -dr com.apple.quarantine "/Applications/Be Voiced.app"
```

The quarantine flag is set by the browser on download, so a build copied over by AirDrop, a USB
stick or `scp` runs without any of this.

To remove the warning entirely you need the Apple Developer Program ($99/year): set
`APPLE_SIGNING_IDENTITY` to your Developer ID, turn `hardenedRuntime` back on in
`tauri.conf.json`, and add the notarization credentials (`APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`). Nothing else in the build changes. The sidecars keep their own signatures, which is
why `entitlements.plist` disables library validation.

**Windows** is unsigned too: SmartScreen warns until you set `bundle.windows.certificateThumbprint`
or a `signCommand`, and a certificate costs more per year than Apple's.

The bundled FFmpeg builds are GPL-licensed (they include libx264 and libass). Review the licensing implications before distributing.

## Project layout

```
src/
  App.tsx, main.tsx          shell, theme, drag and drop, session restore
  lib/                       ipc, player controller, transcript, caption, moment and answer engines, actions
  store/                     app state (settings, jobs, library), project state (autosave, undo), waveform peaks
  components/                UI primitives, waveform and cover art
  views/                     Home, Projects, Transcripts, Captions, Ask, Settings, workspace/, editor/
  styles/                    tokens.css (plum #320B35, light sheet and pure-black dark) and component styles
  dev/qa.ts                  dev-only visual QA harness
src-tauri/src/
  sidecar.rs                 resolve and run FFmpeg / ffprobe / whisper-cli with progress and cancel
  media.rs                   probe, thumbnails, waveform peaks, preview copies
  links.rs                   pasted links to local media (direct, podcast feed, yt-dlp)
  transcribe.rs, whisper.rs  Deepgram and whisper.cpp transcription
  intelligence.rs            Deepgram Text Intelligence (topics, intents, sentiment)
  transcript.rs              normalized transcript model
  export.rs                  clip rendering, file open and reveal
  projects.rs, settings.rs   local storage, keychain-backed API key
  history.rs                 ask conversations, stored apart from projects
  jobs.rs                    progress events and cancellation
scripts/sidecars.mjs         fetch FFmpeg and yt-dlp, build whisper.cpp per target
```
