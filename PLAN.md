# Be Voiced as a service — build plan

How the desktop app becomes a commercial web product without rewriting it, and without spending
money until the last phase.

Everything up to Phase 8 runs on a laptop: Postgres and MinIO in Docker, Stripe in test mode, mail
caught locally. No cloud account is needed to build or test any of it.

---

## Where things stand

- **Desktop app** — working: import or paste a link, transcribe locally with whisper.cpp or through
  Deepgram, find moments, trim, caption, export. Ships for Windows and macOS from CI.
- **Monorepo** — done. `packages/engine` holds the transcript model, moment finder, answer engine and
  caption renderers, with no Tauri, DOM or network code, so the web app and the server worker import
  the same logic the desktop runs.
- **Next** — Phase 0.

---

## The shape of it

Two products, one engine.

| | Desktop | Web |
| --- | --- | --- |
| Runs on | the user's machine | our infrastructure |
| Transcription | whisper.cpp locally, or Deepgram | whisper on our workers |
| Link ingestion | yes (yt-dlp) | no — uploads only |
| Privacy | audio never leaves the machine | audio is processed by us |
| Price | one-off or free | subscription |

The privacy difference is a feature of the desktop product, not a weakness of the web one. They are
sold as different things.

### Why uploads only on the web

yt-dlp on a user's own machine is their business. A paid service that downloads from video sites on
request is a different legal posture, and the server's IP gets rate-limited and blocked at any
volume. Link ingestion stays desktop-only.

---

## Architecture

The scaling requirement is that users never wait behind each other. That rules out a fixed pool of
workers draining a shared queue, because a shared queue is what a fixed pool forces on you.

```
Browser ──presigned PUT──────────────► Object storage   (bytes never touch the API)
   │
   └──POST /jobs──► Control plane (small, always on)
                         │ starts one container per job
                         ▼
                    Job container (ephemeral, per-second billing, scales to zero)
                    pull input → whisper / ffmpeg → write output → report status
                         │
   ◄────progress─────────┘
```

**Control plane** — accounts, sessions, subscriptions, media records, job records, presigned URLs.
Holds no media and does no transcoding, so it stays small and cheap.

**Job container** — takes one job, does it, exits. One per job means fifty simultaneous uploads start
fifty containers; concurrency is bounded by a spend cap, not by hardware. Locally this is a
long-lived process with the same entrypoint, so containerising it later is a packaging change.

**Storage** — behind a trait: MinIO locally, Cloudflare R2 in production. R2 because egress is free;
on S3 the playback traffic alone would cost more than all the compute.

Two deployables, not microservices. More services at this scale would add network hops and failure
modes for nothing.

### Long files

Split the audio at silence boundaries, transcribe the chunks in parallel across containers, stitch
the results by their absolute word timings. A 60-minute recording finishes in roughly the time of a
5-minute one.

### Decisions already taken

| Decision | Why |
| --- | --- |
| Whisper on our own workers, not Deepgram | no per-minute fee; ~5¢ per 10-minute video all in |
| Serverless job containers, not a VPS pool | no shared queue, no idle cost, scales with revenue |
| Keep Rust, don't rewrite in Node | the work is whisper and FFmpeg subprocesses; the wrapper language is irrelevant, and Rust is shared with the desktop |
| Cloudflare R2, not S3 | free egress |
| Our own auth, not Clerk or Supabase | the user wants to own the flow |
| Stripe Checkout and Customer Portal | no billing UI to build, no PCI scope |

---

## Phases

Ordered easiest to hardest. Each ends with something demonstrable.

### Phase 0 — Decouple the Rust from Tauri · 1.5 days

`AppHandle` is used for two things: resolving the data directory and emitting job progress. Replace
it with a `Ctx` carrying a data root and a progress sink, move the modules into `crates/core`, and
set up the Cargo workspace. The Tauri app keeps thin `#[tauri::command]` wrappers.

**Done when** clippy is clean and the desktop app imports, transcribes and exports exactly as before.

This is the gate. Every later phase runs the same code from a server instead of a window.

### Phase 1 — Local stack · 1 day

Docker compose with Postgres, MinIO and Mailpit. Axum skeleton with migrations, config, structured
logging and `/health`. Storage behind a trait.

**Done when** `docker compose up` gives a working API and a file that round-trips through the bucket.

### Phase 2 — Accounts · 5 days

Tables: `users`, `identities`, `sessions`, `email_tokens`.

- Argon2id passwords, email verification, reset that invalidates every session
- Google sign-in over OIDC with PKCE, the id_token verified server side against Google's JWKS
- Opaque session cookies — `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to the parent domain — not
  JWTs, so sessions can be revoked and no token is reachable from JavaScript
- Rate limits on login and reset; no leaking whether an email exists

App and API must live on subdomains of the same registrable domain, or cookies and CORS become
painful. Decide the domain before this phase.

**Done when** you can register, verify in Mailpit, log in, reset, and sign in with a real Google
account against localhost.

### Phase 3 — The media pipeline · 5 days

Presigned upload, probe for duration and dimensions, thumbnail, waveform peaks. Job records with
state and progress. A worker process standing in for the container. Whisper transcription through
`crates/core`. Progress streamed to the browser.

**Done when** a file uploaded through the API returns a transcript identical to the desktop's.

### Phase 4 — Web front end · 4 days

A web implementation of `ipc.ts` behind a build flag; the views, stores and engines are unchanged.
Auth screens, upload with progress, job state. The Captions tab works end to end: the video streams
from the server, captions draw over it in CSS, dragging and styling behave as they do on the desktop.
No video processing in the browser — preview is an HTML video element with text on top.

The moment finder and the answer engine come across free; they are already pure TypeScript.

**Done when** the whole flow works in a browser against the local stack.

### Phase 5 — Rendering · 3 days

Burn-in through the same FFmpeg and ASS path the desktop uses, output to the bucket, download link.
Parallel chunked transcription for long files.

**Done when** an exported MP4 is indistinguishable from the desktop's, captions in the same place.

Rendering is the expensive half — roughly four times the cost of transcribing the same video — so it
must be an explicit action, never automatic.

### Phase 6 — Plans and billing · 4 days

Plan limits in config, usage metered per billing period, entitlement checked **before** a job starts.
Stripe Checkout and the Customer Portal in test mode, webhooks through the Stripe CLI.

Rules that matter:

- Entitlement comes from webhooks, never from the browser's post-checkout redirect
- Store the Stripe event id and ignore duplicates; events arrive more than once and out of order
- Yearly plans still get a monthly allowance — granting twelve months up front invites a year of
  video in week one
- Meter transcription and rendering separately; they cost very different amounts

**Done when** you can subscribe with a test card, hit a quota and be stopped cleanly, then cancel and
go read-only.

### Phase 7 — Admin and cost telemetry · 5 days

Record `compute_ms`, GPU flag, bytes in and out, and model per job; roll up nightly into
`daily_costs` with a rate card from config. **Collect this from Phase 3 onwards** — telemetry cannot
be backfilled.

Then the panel: live jobs, revenue against compute cost per user, user search with actions, job list
with retry, storage. Audit log of every admin action. TOTP on admin accounts. Metabase on a read
replica for ad-hoc questions rather than hand-built charts.

Admin sees metadata, not customer media. Playback is gated behind an explicit support flow that logs
loudly.

### Phase 8 — Deployment · 3 days, plus accounts

The only phase that spends money.

| Piece | Where | Cost |
| --- | --- | --- |
| Web front end | Cloudflare Pages | free |
| Control plane | Fly.io, 512 MB | ~$5/mo |
| Database | Neon Postgres | free → $19 |
| Files | R2 with lifecycle rules | ~$5/mo |
| Job containers | Modal or Cloud Run with GPU | per second |
| Errors, uptime | Sentry, Better Stack | free tier |

Dockerfiles, GitHub Actions, DNS, secrets, retention rules, monitoring. **Bake the whisper model into
the job image** — downloading it on every cold start multiplies the cost of short jobs.

---

## Costs

Measured anchor: 118 seconds of audio transcribed with `base.en` in 22.8 seconds on an i7-1365U —
**5.2× realtime** on a low-power laptop chip. A dedicated cloud vCPU does better; a GPU does far
better.

Per 1000 videos a month, with 7-day retention:

| Average length | Transcribe | Render | Storage | Total |
| --- | --- | --- | --- | --- |
| 3 min | $3 | $9 | $2 | **~$22** |
| 10 min | $6 | $24 | $5 | **~$40** |
| 30 min | $12 | $69 | $15 | **~$105** |

Plus ~$8/month for the always-on API. Idle costs nothing.

**≈ 5¢ per 10-minute video.**

---

## Pricing

| | Monthly | Yearly | Included |
| --- | --- | --- | --- |
| Free | — | — | 5 min/month, watermarked |
| Creator | $15 | $144 | 120 min/month, 1080p, no watermark |
| Pro | $39 | $374 | 600 min/month, priority processing, API |

Top-up at $5 per extra 60 minutes. Meter by video-minutes uploaded per month, counted once per
upload, with a quiet cap on re-exports.

Creator costs about $0.60/month to serve. Priority processing on Pro is real, not a flag: one
always-warm worker means those jobs skip the cold start.

---

## Open questions

Needed before the phase in brackets:

1. **Maximum file duration and size** [3]
2. **Retention window** for uploads and outputs [3]
3. **Domain**, since app and API must be subdomains of it [2]
4. **Free tier** — keep it, or trial with a card? Compute-heavy free tiers get mined [6]
5. **GPU or CPU** job containers — GPU is ~5× faster at similar cost per job, CPU runs anywhere [8]

---

## Totals

About **six weeks** of focused work to a product that can take money, with something to look at after
every phase and nothing to pay for until the last one.
