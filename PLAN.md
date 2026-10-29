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
- **apps/web** — a Vite build of the desktop app in a browser: same views, `lib/ipc.ts` swapped for
  a browser bridge, a URL per tab. Complete and working, and now superseded.
- **apps/saas** — the product, and Phase 0 is done. A standalone Next.js app, meant to be lifted out
  of this repo and hosted on its own: every screen works, with Tailwind on the existing design
  tokens and a URL per screen.
- **Transcription runs in the browser**, through ONNX Runtime on WebGPU. This is a change of plan
  and a large one — see below.
- **Next** — Phase 1.

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

## Whisper in the browser changes the sums

The original plan put transcription on a worker and priced it at roughly 5¢ per 10-minute video.
It now runs in the browser instead, through ONNX Runtime on WebGPU, and that removes the largest
cost line in the business entirely.

| | Worker | In the browser |
| --- | --- | --- |
| Cost per video, transcribe and render | ~5¢ | nothing |
| Waiting behind others | a queue to size and pay for | never |
| Audio leaves the machine | yes | no |
| First use | instant | 75–240 MB model, downloaded once |
| Long files on a weak device | fine | slow without WebGPU |

The privacy line is worth more than the money: "your recording never leaves your computer" is a
claim most competitors cannot make, and it is now simply true.

What it does not solve is the last row. A browser with no WebGPU falls back to the processor and a
long recording becomes an afternoon. So the worker is not cancelled, it is **demoted**: the browser
is the default, and the worker is there for long files and weak devices. That turns Phase 3 from a
blocker into an upgrade, and lets the thing ship before any of it exists.

**Rendering went the same way.** Captions are burned into the picture with WebCodecs — the browser
decodes, we draw, the browser encodes — which removes the other half of the per-video cost.

ffmpeg.wasm was the obvious candidate and cannot do it: the published core is built with no
`--enable-lib*` flags and `--disable-autodetect`, so it has no libass, no libfreetype and no
libx264. A custom core could be built with all three, at a 40 MB-plus download and an Emscripten
toolchain to maintain. WebCodecs is hardware-accelerated, already in the browser, and free.

## Architecture

The scaling requirement is that users never wait behind each other. That rules out a fixed pool of
workers draining a shared queue, because a shared queue is what a fixed pool forces on you.

```
Browser ──presigned PUT──────────────► Object storage   (bytes never touch the app)
   │
   └──POST /api/jobs──► Next.js (app + API, one deployable)
                         │ writes a row
                         ▼
                    jobs table in Postgres
                         │ claimed with FOR UPDATE SKIP LOCKED
                         ▼
                    Worker container (ffmpeg + whisper.cpp, scales separately)
                    pull input → transcribe → write output → update the row
                         │
   ◄────progress─────────┘
```

**Next.js** — the interface and the control plane in one app: accounts, sessions, subscriptions,
media records, job records, presigned URLs, and the marketing pages. Holds no media and does no
transcoding, so it stays small and cheap.

Same-origin is the reason it is one app rather than two. A separate API means the app and the API
must be subdomains of one registrable domain, with CORS and cookie-domain rules to match. At `/api`
on the same origin that problem does not exist.

**Worker** — a container with ffmpeg and whisper.cpp in it, claiming jobs from the table and running
them to completion. It is not a serverless function: these jobs run for minutes and are CPU-bound,
which is the one shape serverless is worst at. Run one worker, or fifty; concurrency is bounded by a
spend cap, not by hardware.

**No Redis.** At a thousand jobs a month a queue server is a second thing to run, pay for and
monitor, and Postgres already does the job correctly with `SKIP LOCKED`.

**Storage** — behind one module: MinIO locally, Cloudflare R2 in production. R2 because egress is
free; on S3 the playback traffic alone would cost more than all the compute.

Two deployables, not microservices. More services at this scale would add network hops and failure
modes for nothing.

### Long files

Split the audio at silence boundaries, transcribe the chunks in parallel across containers, stitch
the results by their absolute word timings. A 60-minute recording finishes in roughly the time of a
5-minute one.

### Decisions already taken

| Decision | Why |
| --- | --- |
| Whisper in the browser first, a worker second | no per-minute fee at all, nothing to queue, and the audio never leaves the machine |
| Whisper on our own workers, not Deepgram, for what the browser cannot do | no per-minute fee; ~5¢ per 10-minute video all in |
| Next.js for the app and the API, not an SPA plus a service | one deployable, same-origin cookies, and static marketing pages a search engine can read |
| A worker container, never a serverless function for media | minutes-long CPU-bound jobs are the one thing serverless handles worst |
| Postgres as the queue, not Redis | `SKIP LOCKED` is enough at this volume; a queue server is another thing to run and pay for |
| Node for the worker, not the existing Rust | the work is whisper and FFmpeg subprocesses, so the wrapper language barely matters, and one language is one language to maintain alone |
| Cloudflare R2, not S3 | free egress |
| Our own auth, not Clerk or Supabase | the user wants to own the flow |
| Stripe Checkout and Customer Portal | no billing UI to build, no PCI scope |

---

## Phases

Ordered easiest to hardest. Each ends with something demonstrable.

### Phase 0 — The standalone app · done

`apps/saas`: Next.js, app router, Tailwind wired to the plum tokens so nothing changed to look at.
Navigation is a rail on a laptop and a top bar with a drawer on a phone. Home, Projects,
Transcripts, Captions, Ask, Settings and the workspace all work, against browser storage: import,
waveform, transcript with playback following it, moment finding, captions with live preview, and
answers with citations. The engine is copied in at `src/lib/engine`; there are no workspace imports,
so the folder can be lifted out of this repo and hosted on its own.

One module, `src/lib/api.ts`, stands between the interface and its data. It is the only thing phases
1 to 3 have to replace.

Transcription and rendering are both already real, and both run on the graphics card:
`src/lib/transcribe` runs Whisper in a worker, verified on a known sample down to the word timings,
and `src/lib/render` burns captions into an MP4 with WebCodecs, verified frame by frame against the
preview. Phases 3 and 5 are now about the files a laptop should not be asked to handle, not about
whether any of it works.

### Phase 1 — Local stack · 1 day

Docker compose with Postgres, MinIO and Mailpit. Migrations, config, and a `/api/health` route.
Storage behind one module, so MinIO and R2 are a config change apart.

**Done when** `docker compose up` gives a working app and a file that round-trips through the bucket.

### Phase 2 — Accounts · 5 days

Tables: `users`, `identities`, `sessions`, `email_tokens`.

- Argon2id passwords, email verification, reset that invalidates every session
- Google sign-in over OIDC with PKCE, the id_token verified server side against Google's JWKS
- Opaque session cookies — `HttpOnly`, `Secure`, `SameSite=Lax` — not JWTs, so sessions can be
  revoked and no token is reachable from JavaScript
- Rate limits on login and reset; no leaking whether an email exists

Auth.js handles the Google side and the session plumbing. It is a library inside the app talking to
our own Postgres, not a hosted service, so the flow stays ours.

**Done when** you can register, verify in Mailpit, log in, reset, and sign in with a real Google
account against localhost.

### Phase 3 — The media pipeline · 5 days

Now an upgrade rather than a gate: the browser already transcribes, so this is for the files it
should not be asked to — hours long, or a device with no WebGPU.

Presigned upload, probe for duration and dimensions, thumbnail, waveform peaks. Job records with
state and progress. The worker: a loop claiming rows with `SKIP LOCKED`, running ffmpeg and
whisper.cpp, writing the results back. Progress streamed to the browser. The interface already
reports these stages, because the in-browser path reports the same ones.

The whisper invocation, the JSON parsing and the chunk stitching already exist in Rust in this repo;
porting them to the Node worker is mostly moving command lines across.

**Done when** a file uploaded through the app returns a transcript identical to the desktop's.

### Phase 4 — Wire the interface to the service · 2 days

The screens exist by now; this phase is the seam behind them. One module stands between the
interface and its data — browser storage and a sample transcript today, the API after this — so this
is a rewrite of that module and little else.

- point it at the real endpoints instead of localStorage and the sample transcript
- auth screens, and the session cookie from Phase 2
- presigned upload with real progress, and job state polled from the server
- the Captions tab against streamed video rather than a local blob

**Done when** the whole flow works in a browser against the local stack.

### Phase 5 — Rendering at scale · 3 days

Done in the browser already, with WebCodecs. What is left here is the same job on a worker, for
files too long to ask a laptop to encode.


Burn-in through the same FFmpeg and ASS arguments the desktop uses, output to the bucket, download
link. The ASS builder is pure TypeScript and already copied into the app, so the worker and the
preview agree on where a caption sits.
Parallel chunked transcription for long files.

**Done when** an exported MP4 is indistinguishable from the desktop's, captions in the same place.

Rendering is the expensive half on a server — roughly four times the cost of transcribing the same
video — so it must be an explicit action, never automatic. In the browser it costs nothing, which is
why that is the default.

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
| App and API | Fly.io or Hetzner, Docker, `output: "standalone"` | ~$5-10/mo |
| Database | Neon Postgres | free → $19 |
| Files | R2 with lifecycle rules | ~$5/mo |
| Workers | Fly machines, or Modal / Cloud Run with GPU | per second |
| Errors, uptime | Sentry, Better Stack | free tier |

Vercel is the fastest path and works unchanged, but it is also the one whose bill surprises people.
The app builds as a container so that stays a choice rather than a dependency.

Dockerfiles, GitHub Actions, DNS, secrets, retention rules, monitoring. **Bake the whisper model into
the worker image** — downloading it on every cold start multiplies the cost of short jobs.

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
3. **Domain**, for the session cookie and the Google OAuth callback [2]
4. **Free tier** — keep it, or trial with a card? Compute-heavy free tiers get mined [6]
5. **GPU or CPU** job containers — GPU is ~5× faster at similar cost per job, CPU runs anywhere [8]

---

## Totals

About **six weeks** of focused work to a product that can take money, with something to look at after
every phase and nothing to pay for until the last one.
