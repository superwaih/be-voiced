# core (not extracted yet)

The Rust that probes media, runs whisper and FFmpeg, normalises transcripts and renders captioned
video. Today it lives in `apps/desktop/src-tauri/src` and is coupled to Tauri through `AppHandle`.

Phase 0 replaces `AppHandle` with a `Ctx` (a data root plus a progress sink) and moves the modules
here, so the same code serves a desktop window and a server job.
