import { ArrowRight, ArrowUpRight, Check, Circle, FileVideo, UploadSimple } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { ClipCover, ProjectCover } from "../components/Covers";
import { WaveArt } from "../components/WaveArt";
import { Button } from "../components/ui";
import { importFile, openProject, pickMediaFile } from "../lib/actions";
import { clock, duration, relativeDate } from "../lib/format";
import { CATEGORY_LABEL } from "../lib/project";
import { unpackWave } from "../lib/wave";
import type { ClipMeta, ProjectMeta } from "../lib/types";
import { useApp } from "../store/app";

export function nextStep(m: ProjectMeta): string {
  if (m.sourceMissing) return "Source file missing";
  if (m.stage === "imported") return "Ready to transcribe";
  if (m.stage === "transcribed") return "Ready to find moments";
  const saved = m.clips.length;
  if (m.suggestionCount) return `${m.suggestionCount} ${m.suggestionCount === 1 ? "moment" : "moments"} to review`;
  return `${saved} ${saved === 1 ? "clip" : "clips"} saved`;
}

export async function chooseAndImport() {
  const path = await pickMediaFile();
  if (path) await importFile(path);
}

export const rise = (reduce: boolean | null, i = 0) =>
  reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, delay: 0.045 * i, ease: [0.16, 1, 0.3, 1] as const },
      };

function hours(seconds: number) {
  const h = seconds / 3600;
  return h >= 10 ? Math.round(h).toString() : h.toFixed(1);
}

export function HomeView() {
  const library = useApp((s) => s.library);
  const keys = useApp((s) => s.keys);
  const models = useApp((s) => s.models);
  const sidecars = useApp((s) => s.sidecars);
  const settings = useApp((s) => s.settings);
  const importing = useApp((s) => Object.values(s.jobs).some((j) => j.kind === "import"));
  const setView = useApp((s) => s.setView);
  const reduce = useReducedMotion();

  const [featured, ...others] = library;
  const shelf = others.slice(0, 4);
  const allClips = library.flatMap((m) => m.clips.map((c) => ({ clip: c, meta: m })));
  const latest = [...allClips].sort((a, b) => b.clip.updatedAt.localeCompare(a.clip.updatedAt)).slice(0, 6);

  const totalSeconds = library.reduce((n, m) => n + m.duration, 0);
  const moments = library.reduce((n, m) => n + m.suggestionCount + m.clips.length, 0);
  const exported = allClips.filter((c) => c.clip.exportCount > 0).length;
  // Mini charts use real per-project numbers for the six most recent projects.
  const lengthBars = library.slice(0, 6).map((m) => m.duration);
  const momentBars = library.slice(0, 6).map((m) => m.suggestionCount + m.clips.length);
  const exportBars = library.slice(0, 6).map((m) => m.clips.filter((c) => c.exportCount > 0).length);

  const hasModel = models.some((m) => m.installed);
  const setup = [
    { done: !!sidecars?.ffmpeg && !!sidecars?.ffprobe, label: "Media engine" },
    settings.transcriptionMode === "cloud"
      ? { done: !!keys.deepgram, label: "Deepgram key" }
      : { done: hasModel && !!sidecars?.whisper, label: "Whisper model" },
  ];
  const setupDone = setup.every((s) => s.done);

  return (
    <div className="page">
      <div className="page-inner home">
        <header className="page-header">
          <div>
            <h1 className="page-title">Home</h1>
            <p className="page-sub">Find the parts of every conversation worth publishing.</p>
          </div>
          <Button variant="primary" icon={<UploadSimple />} disabled={importing} onClick={() => void chooseAndImport()}>
            {importing ? "Reading media" : "Import recording"}
          </Button>
        </header>

        {!setupDone && (
          <button className="setup-strip" onClick={() => setView("settings")}>
            {setup.map((s) => (
              <span key={s.label} className={s.done ? "is-done" : ""}>
                {s.done ? <Check weight="bold" /> : <Circle />}
                {s.label}
              </span>
            ))}
            <span className="setup-strip-cta">
              Finish setup <ArrowRight />
            </span>
          </button>
        )}

        <div className="stat-row">
          <StatCard i={0} reduce={reduce} label="Conversation in your library" value={hours(totalSeconds)} unit="hours" note={`${library.length} ${library.length === 1 ? "recording" : "recordings"}`} bars={lengthBars} />
          <StatCard i={1} reduce={reduce} label="Moments found" value={String(moments)} note={`${allClips.length} saved as clips`} bars={momentBars} />
          <StatCard i={2} reduce={reduce} label="Clips exported" value={String(exported)} unit={allClips.length ? `/${allClips.length}` : undefined} note={allClips.length - exported ? `${allClips.length - exported} waiting to export` : "All caught up"} bars={exportBars} />
        </div>

        <div className="home-grid">
          {featured ? (
            <NowEditing meta={featured} reduce={reduce} />
          ) : (
            <motion.section className="card first-run" {...rise(reduce, 3)}>
              <h2 className="card-title">Your first recording</h2>
              <p className="muted">
                Import a podcast, interview, webinar or meeting. Be Voiced transcribes it, finds the strongest moments and gets them
                ready to post.
              </p>
            </motion.section>
          )}

          <motion.button className="import-card" onClick={() => void chooseAndImport()} disabled={importing} {...rise(reduce, 4)}>
            <span className="import-card-top">
              <span className="import-card-brand">
                <FileVideo weight="fill" /> New project
              </span>
              <ArrowUpRight className="import-card-arrow" />
            </span>
            <span className="import-card-title">{importing ? "Reading your recording" : "Drop a recording to start"}</span>
            <span className="import-card-sub">MP4, MOV, MKV, WebM, MP3, WAV or M4A. Files stay where they are.</span>
            <span className="import-card-wave" aria-hidden="true">
              <WaveArt values={unpackWave(featured?.wave)} gap={0.5} min={0.1} />
            </span>
          </motion.button>
        </div>

        {latest.length > 0 && (
          <motion.section className="card home-card" {...rise(reduce, 5)}>
            <SectionHead title="Latest clips" action="All clips" onAction={() => setView("clips")} />
            <div className="contact-sheet is-row">
              {latest.map(({ clip, meta }) => (
                <button key={clip.id} className="sheet-tile" onClick={() => void openProject(meta.id, { view: "editor", clipId: clip.id })}>
                  <ClipCover wave={clip.wave} exported={clip.exportCount > 0} aspect={clip.aspect} />
                  <span className="sheet-tile-title">{clip.title}</span>
                  <span className="sheet-tile-meta">
                    <span className="mono">{duration(clip.end - clip.start)}</span>
                    <span className={clip.exportCount ? "is-accent" : ""}>{clip.exportCount ? "Exported" : clip.aspect === "original" ? "Original" : clip.aspect}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.section>
        )}

        {shelf.length > 0 && (
          <motion.section className="card home-card" {...rise(reduce, 6)}>
            <SectionHead title="Library" action="All projects" onAction={() => setView("projects")} />
            <div className="shelf">
              {shelf.map((m) => (
                <button key={m.id} className="shelf-item" onClick={() => void openProject(m.id)}>
                  <ProjectCover thumbnailPath={m.thumbnailPath} wave={m.wave} name={m.name} />
                  <span className="shelf-name">{m.name}</span>
                  <span className="shelf-meta">
                    <span className="mono">{duration(m.duration)}</span>
                    <span className={m.sourceMissing ? "is-warning" : ""}>{nextStep(m)}</span>
                  </span>
                </button>
              ))}
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  note,
  bars,
  i,
  reduce,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  bars: number[];
  i: number;
  reduce: boolean | null;
}) {
  const max = Math.max(1, ...bars);
  return (
    <motion.section className="card stat-card" {...rise(reduce, i)}>
      <span className="stat-label">{label}</span>
      <div className="stat-main">
        <span className="stat-value">
          {value}
          {unit && <span className="stat-unit">{unit}</span>}
        </span>
        {bars.length >= 4 && (
          <span className="stat-bars" aria-hidden="true">
            {bars.map((b, k) => (
              <span key={k} style={{ height: `${Math.max(12, (b / max) * 100)}%` }} className={k === bars.length - 1 ? "is-dim" : ""} />
            ))}
          </span>
        )}
      </div>
      <span className="stat-note">{note}</span>
    </motion.section>
  );
}

function SectionHead({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return (
    <div className="section-head">
      <h2 className="card-title">{title}</h2>
      <button className="text-link" onClick={onAction}>
        {action} <ArrowUpRight />
      </button>
    </div>
  );
}

function NowEditing({ meta, reduce }: { meta: ProjectMeta; reduce: boolean | null }) {
  const reviewing = !!meta.topSuggestions?.length;
  const tracks: ClipMeta[] = reviewing ? meta.topSuggestions!.slice(0, 3) : meta.clips.slice(0, 3);
  return (
    <motion.article className="card now-editing" {...rise(reduce, 3)}>
      <button className="now-cover" onClick={() => void openProject(meta.id)} aria-label={`Open ${meta.name}`}>
        <ProjectCover thumbnailPath={meta.thumbnailPath} wave={meta.wave} name={meta.name} size="lg" />
      </button>
      <div className="now-body">
        <div className="now-head">
          <span className="now-kicker">Continue editing</span>
          <h2 className="now-name">{meta.name}</h2>
          <span className="now-meta">
            <span className="mono">{duration(meta.duration)}</span>
            <span>{relativeDate(meta.updatedAt)}</span>
            <span className={meta.sourceMissing ? "is-warning" : "is-accent"}>{nextStep(meta)}</span>
          </span>
        </div>

        {tracks.length > 0 ? (
          <ol className="setlist" aria-label={reviewing ? "Top moments to review" : "Saved clips"}>
            {tracks.map((c, i) => (
              <li key={c.id}>
                <button
                  className="setlist-row"
                  onClick={() => void openProject(meta.id, c.status === "saved" ? { view: "editor", clipId: c.id } : { view: "workspace" })}
                >
                  <span className="setlist-num">{i + 1}</span>
                  <span className="setlist-text">
                    <span className="setlist-title">{c.title}</span>
                    <span className="setlist-meta">
                      {c.category && <span>{CATEGORY_LABEL[c.category]}</span>}
                      <span className="mono">{clock(c.start)}</span>
                    </span>
                  </span>
                  <span className="setlist-wave">
                    <WaveArt values={unpackWave(c.wave)} gap={0.45} min={0.14} />
                  </span>
                  <span className="setlist-dur mono">{duration(c.end - c.start)}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="now-empty">{meta.stage === "imported" ? "Transcribe it to see what is worth clipping." : "Find moments to build a setlist."}</p>
        )}

        <Button variant="primary" trailing={<ArrowRight />} className="now-open" onClick={() => void openProject(meta.id)}>
          Open project
        </Button>
      </div>
    </motion.article>
  );
}
