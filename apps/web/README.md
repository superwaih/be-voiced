# Web app

Be Voiced in a browser. Not a second product — the same one.

```bash
pnpm -C apps/web dev     # http://localhost:1500
```

## How it is the same app

There are no views, components or stores in here. The pages come straight from `apps/desktop/src`:
the same `App.tsx`, the same Home, Projects, Transcripts, Captions, Ask and Settings, the same ten
stylesheets. What differs is one module.

The desktop talks to Rust through `apps/desktop/src/lib/ipc.ts`. At build time Vite redirects every
import of that file to `src/platform/ipc.web.ts`, which answers the same 39 calls against the
browser instead (see `vite.config.ts`). The Tauri packages the app imports directly — the dialog
plugin, the webview's drag-and-drop, the window's close event — are substituted the same way.

`src/platform/contract.ts` compares the two module types, so a command added to the desktop bridge
and forgotten here fails the build instead of failing in front of someone.

## What runs, and what waits on the service

Real, in the browser:

- importing a file, by picker or by dropping it on the page
- duration, dimensions and a thumbnail, read from the media itself
- the waveform, decoded from the real audio with WebAudio
- the transcript, moment finder, summaries and the answer engine — all `@be-voiced/engine`, the
  same code the desktop runs, so answers and citations are genuine
- captions: styling, placement, dragging, and SRT/VTT, which download
- recordings, conversations and settings, kept in localStorage

Waiting on the service (PLAN.md, phases 3 and 5):

- **transcription.** `ipc.web.ts` reports the stages the real job will report — uploading, waiting
  for a worker, transcribing — then returns sample text from `src/lib/sample.ts`, fitted to the
  length of the file. It is labelled `sample` as its model so it cannot be mistaken for real
  output.
- **burning captions into a video.** A browser should not re-encode video.
- **pasting links.** Uploads only on the web, by decision; see PLAN.md.

Files chosen in a browser do not survive a reload, so a recording from an earlier visit shows as
source missing — the same state the desktop shows for a file that moved.

## Addresses

Each tab has one: `/`, `/projects`, `/transcripts`, `/captions`, `/ask`, `/settings`, and
`/project/<id>` for an open recording. `src/platform/routes.ts` keeps the store's `view` and the URL
in step, so links, Back and reload all work. `public/_redirects` tells a static host to serve
`index.html` for all of them.

## Narrow screens

`src/styles/responsive.css` is the only stylesheet this app adds, and it only overrides. Under
1024px the side-by-side panels become one scrolling column; under 900px the sidebar becomes a row of
tabs along the bottom; under 560px the spacing and type come down to phone size.

## Shape

```
src/main.tsx              the desktop App, its stylesheets, and routing
src/platform/ipc.web.ts   the bridge: 39 calls, answered by the browser
src/platform/files.ts     chosen files, since a browser has no paths
src/platform/tauri-*.ts   stand-ins for the Tauri modules the app imports
src/platform/routes.ts    a URL per tab
src/platform/contract.ts  compile-time proof the bridge is complete
src/lib/sample.ts         sample transcript, until the service exists
src/styles/responsive.css phone and tablet overrides
```
