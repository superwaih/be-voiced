# Be Voiced

Find the parts of long conversations worth publishing.

Import a podcast, interview, webinar, meeting or X Space, transcribe it locally with whisper.cpp or
in the cloud with Deepgram, let Be Voiced find the strongest moments, then trim, caption and export
clips.

```
Import or paste a link  ->  Transcribe  ->  Read, ask and edit  ->  Find moments  ->  Trim  ->  Caption  ->  Export
```

## Repository layout

```
apps/
  desktop/     Tauri desktop app (React + TypeScript, Rust backend, bundled sidecars)
  web/         SaaS front end                                    (planned, phase 4)
  admin/       operations panel                                  (planned, phase 7)
packages/
  engine/      transcript model, moment finder, answer engine, caption renderers
services/
  api/         control plane: accounts, subscriptions, jobs      (planned, phase 1-3)
  worker/      one job per container                             (planned, phase 3)
crates/
  core/        shared Rust: media, whisper, FFmpeg               (planned, phase 0)
```

`packages/engine` is the part that matters for consistency: it has no Tauri, no DOM and no network,
so a caption previewed in a browser and one burned into a video by the server come from the same
code. Everything platform-specific lives in the app or service that needs it.

The desktop app is documented in [apps/desktop/README.md](apps/desktop/README.md).

## Working on the desktop app

```bash
pnpm install
pnpm -C apps/desktop sidecars   # FFmpeg, ffprobe, yt-dlp; builds whisper-cli
pnpm -C apps/desktop app:dev
```

From the repository root, `pnpm dev`, `pnpm build`, `pnpm sidecars` and `pnpm app:dev` delegate to
the desktop app, so the familiar commands still work.
