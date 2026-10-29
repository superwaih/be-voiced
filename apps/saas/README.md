# Be Voiced

Upload a recording, read what was said, ask it questions and caption it.

```bash
pnpm -C apps/saas dev     # http://localhost:1500
```

## This folder is the product

It is a standalone Next.js app and it is meant to leave. Nothing here imports from anywhere else in
this repository — the transcript model, moment finder, answer engine and caption renderers were
copied into `src/lib/engine`, not linked — so the folder can be moved to its own repository and
hosted without changing a line.

Where the other apps in this repository are concerned, the relationship is one-way: `apps/desktop`
is the Tauri app this all started as, and `apps/web` is that same app running in a browser. Screens
are being moved across from `apps/web` into this one, converted to Tailwind as they come.

## Why Next, and not an SPA with an API behind it

The work splits into three jobs that have nothing to do with each other: the interface, the control
plane (accounts, billing, job records, presigned URLs), and the media work. Only the first two
belong together, and they belong together strongly:

- **Same-origin cookies.** A separate API means the app and the API must be subdomains of one
  registrable domain, with CORS and cookie-scope rules to match. At `/api` that problem does not
  exist.
- **A marketing site Google can read.** A SaaS needs a landing page, pricing and docs. An SPA
  cannot render those; this can, statically, in the same app.
- **One deployable.** One thing to build, deploy, roll back and reason about.

The media work used to be the thing that could not live in the app. It now does: transcription
through ONNX Runtime, rendering through WebCodecs, both on the graphics card. A worker is still
worth having for long files and weak devices, but nothing is blocked on it. See PLAN.md.

## Shape

```
src/app/(app)/            the product: home, projects, transcripts, captions, ask, settings
src/app/(app)/layout.tsx  the frame — rail, top bar, drawer, content sheet
src/app/layout.tsx        fonts, metadata, and the pre-paint theme script
src/app/globals.css       Tailwind, wired to the design tokens
src/styles/tokens.css     the plum palette, light and dark
src/components/           shared pieces
src/lib/engine/           transcript, moments, answers, captions — pure TypeScript, no platform code
src/lib/transcribe/       Whisper in a worker: models, audio, stitching, normalising
src/lib/render/           burning captions into video with WebCodecs
src/store/                client state
```

## Styling

Tailwind v4, mapped to the existing design tokens with `@theme inline`, so `bg-surface` compiles to
`var(--surface)` and follows the theme without a `dark:` on every element. The tokens are the same
plum palette the desktop app uses; `data-theme` on `<html>` switches them, and an inline script in
the root layout sets it before the first paint so there is no flash of the wrong theme.

`dark:` is still there for the few cases where dark mode needs a different *rule* rather than a
different value — a hairline where light mode has a shadow, usually.

## Navigation

One element, two shapes. From 1024px up it is the rail down the left, which collapses to icons. Below
that the same element is a drawer: off the left edge, slid in over a scrim when the top bar's menu is
tapped, closed by the scrim, the X, Escape, or going somewhere. Closed, it is `inert`, so the
keyboard cannot reach what is off-screen.

## What works

All of it, against browser storage:

- **Import** by picker or by dropping a file on the page; duration, dimensions and a thumbnail are
  read from the media itself, and the waveform is decoded from the real audio with WebAudio
- **Transcribe** — Whisper, in the browser, with word-level timings, speaker detection, real
  progress and a Cancel that actually stops it
- **Read** the transcript: it follows playback word by word, searches, corrects, splits turns and
  renames speakers, and a text selection becomes a clip
- **Find moments** — the real engine, reading the whole transcript and ranking what is worth posting
- **Caption** — presets, placement, drag-anywhere, live preview at the export frame size, SRT and
  VTT download, and an MP4 with the captions burned in
- **Ask** — real answers from the transcript, each with citations you can click to hear
- Recordings, conversations and settings persist; a URL per screen; light and dark

## Transcription runs here, not on a server

Whisper runs in the browser through ONNX Runtime — on the GPU where WebGPU exists, on the CPU
otherwise. `src/lib/transcribe` holds it: a worker so the interface stays responsive, audio decoded
to 16 kHz mono by the browser's own resampler, and the audio walked in two-minute windows so
progress is real rather than a bar that cannot say. Windows overlap by four seconds and the overlap
is split down the middle when stitching, so no word is counted twice or lost at a seam.

This is the decision that changes the economics. There is no per-minute bill, no queue, no upload,
and the recording never leaves the machine — which is a feature to sell, not a limitation.

What it costs instead is the first run: **about 75 MB** for Standard or **240 MB** for Careful,
plus **26 MB** for the runtime, downloaded once and cached by the browser. Weights are eight-bit on
both backends; full precision is roughly three times the download for no difference you can hear.

Measured on the JFK sample: 22 words, correct text and punctuation, word timings monotonic and
spanning the audio, with the pause after "Americans" showing up as a real 1.6-second gap.

## Rendering runs here too

Captions are burned into the picture with WebCodecs: the browser decodes each frame, `lib/render`
draws the caption on it with the same style the preview uses, and the browser encodes the result.
Mediabunny reads the container and writes the MP4 around that. Output is H.264 with the audio
carried across, at 720p or 1080p in whichever shape was chosen.

**ffmpeg.wasm cannot do this job.** Its published core is built with no `--enable-lib*` flags and
`--disable-autodetect`, so there is no libass for subtitles, no libfreetype for drawn text, and no
libx264 to encode H.264 with. A custom core could be built with those, at the cost of a 40 MB-plus
download and an Emscripten toolchain — WebCodecs is hardware-accelerated, ships with the browser
and costs nothing.

`lib/render/paint.ts` is the part to be careful with: it has to draw exactly what the CSS preview
draws, so every number in it has a counterpart in `previewVars` in the engine, and the comments say
which.

## Who is speaking

Whisper says what was said and has no idea who said it, so two more models answer that:

1. **pyannote segmentation** finds where the voice changes. Its speaker numbers are only
   meaningful locally — "speaker 1" ten seconds in has nothing to do with "speaker 1" a minute
   later — so it cannot be used on its own.
2. **wespeaker embeddings** turn each stretch into a 256-dimension vector describing the voice.
   Clustering those is what makes the numbering mean the same thing across a whole recording.

Then a smoothing pass: a brief turn sitting between two stretches of the same other speaker is
given back to them. Without it a single drawn-out word can appear as an extra person.

The threshold between "same voice" and "different voice" is measured, not guessed. On four-second
slices of two known speakers:

```
same voice        0.30, 0.49
different voices  0.74, 0.80, 0.81
```

So 0.6 sits in the middle of the gap. An earlier guess of 0.42 was below the same-voice spread and
split one person into seven; it looked like a broken model and was arithmetic. The constant in
`diarize.ts` carries those numbers so nobody re-guesses it.

Two guards: a result that gives nearly every turn its own speaker is discarded rather than
published, and if the whole step fails the transcript still arrives with a single speaker label.

Verified on a recording of two speakers spliced together: two speakers found, each as one clean
turn, with the change at the right second.

## Transcription runs on the server

A recording is uploaded, whisper.cpp transcribes it here, and the words go back — the same engine
and the same invocation the desktop app uses, so the two agree on what was said. Everyone gets the
same quality whatever device they are on, and nobody downloads a model.

The upload returns a **job id**, not a transcript. These jobs run for minutes and a request held
open that long dies to a proxy timeout somewhere between here and the person waiting, so the
browser polls `/api/transcribe/<id>` and can cancel it with a `DELETE`.

```
POST /api/transcribe?language=en&duration=612&name=episode.mp3   → 202 { id, status, stage }
GET  /api/transcribe/<id>                                        → progress, then the words
DELETE /api/transcribe/<id>                                      → stops it
GET  /api/transcribe                                             → what this server can do
```

It needs three things: `whisper-cli`, `ffmpeg`, and a model file. Each is looked for in an
environment variable, then `./bin` and `./models`, then PATH. The `Dockerfile` sets all three up
and bakes the model into the image — fetching it on a cold start multiplies the cost of every
short job, and most jobs are short.

```bash
docker build -t be-voiced --build-arg WHISPER_MODEL=ggml-small.en-tdrz.bin .
```

`ggml-base.en.bin` (142 MB) is quick and good for clear speech. `ggml-small.en-tdrz.bin` (465 MB)
is slower, more accurate, and the only one that marks **where the speaker changes** — it is the
model the desktop app uses for that, and the server reads those turn markers straight out of
whisper.cpp's JSON.

**The browser is the fallback**, not the plan. A checkout with no binaries, a self-hoster who has
not installed them, or an outage: the page transcribes locally instead, so the app keeps working.
It is slower and costs the visitor a download, which is why it is second.

**Deepgram is a stand-in**, used only when whisper is not installed on the box. Set
`DEEPGRAM_API_KEY` for it or leave it unset entirely; see `.env.example`.

## Pasting links

```
GET /api/link?url=…        reads the link: title, who posted it, how long
GET /api/link/media?url=…  streams the media through, because the browser cannot fetch it
```

Three kinds, tried in order, the same as the desktop: a direct media URL, a podcast feed's newest
`<enclosure>`, then yt-dlp for everything else. The first two need nothing installed; yt-dlp is in
the container and is what YouTube and the rest go through.

Both routes refuse anything that is not http or https and anything pointing inside our own
network, so a pasted link cannot be used to read something it should not.

Worth knowing before pointing this at video sites at volume: a service that downloads from them on
request is a different legal posture from a person doing it on their own machine, and the server's
IP gets rate-limited and blocked. The first two resolvers have neither problem.

## What still waits

- **Pasting links.** Uploads only on the web, by decision; see PLAN.md.

Files chosen in a browser do not survive a reload, so a recording from an earlier visit shows as
"file not open" until you choose it again. That goes away with the upload pipeline.

Next: the local stack, accounts, the upload pipeline and the worker. PLAN.md has the order and the
reasoning.
