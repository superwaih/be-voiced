import { FilmStrip, FolderOpen, Play, Sparkle, TextAa, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { ClipCover, ProjectCover } from "../components/Covers";
import { Button, EmptyState, IconButton, Progress, Segmented } from "../components/ui";
import { findMoments, loadProjectQuietly, openProject, pickMediaFile, importFile } from "../lib/actions";
import { clock, duration } from "../lib/format";
import { ipc } from "../lib/ipc";
import { CATEGORY_LABEL } from "../lib/project";
import type { ClipMeta, ProjectMeta } from "../lib/types";
import { reportError, useApp } from "../store/app";
import { TranscribeModal } from "./workspace/TranscribeModal";
import { rise } from "./HomeView";

type Filter = "all" | "suggested" | "exported" | "pending";

/**
 * One recording in the maker strip. Everything a clip needs — transcript, moments — can be started
 * from here, so making a clip never requires opening the workspace.
 */
function MakerRow({ meta, onTranscribe }: { meta: ProjectMeta; onTranscribe: (id: string) => void }) {
  const busy = useApp((s) => Object.values(s.jobs).find((j) => j.projectId === meta.id && (j.kind === "transcribe" || j.kind === "analyze")));
  const saved = meta.clips.length;

  const find = async () => {
    if (await loadProjectQuietly(meta.id)) void findMoments("initial");
  };

  let action = null;
  if (meta.sourceMissing) {
    action = (
      <span className="maker-missing">
        <WarningCircle /> Source missing
      </span>
    );
  } else if (busy) {
    action = (
      <span className="maker-busy">
        <Progress value={busy.progress} label={busy.label} />
        <span className="faint truncate">
          {busy.stage}
          {busy.progress !== null ? ` ${Math.round(busy.progress * 100)}%` : ""}
        </span>
      </span>
    );
  } else if (meta.stage === "imported") {
    action = (
      <Button size="sm" icon={<TextAa />} onClick={() => onTranscribe(meta.id)}>
        Transcribe
      </Button>
    );
  } else if (meta.stage === "transcribed") {
    action = (
      <Button size="sm" variant="primary" icon={<Sparkle />} onClick={() => void find()}>
        Find moments
      </Button>
    );
  } else {
    action = (
      <Button size="sm" variant="ghost" icon={<Sparkle />} onClick={() => void find()}>
        Find more
      </Button>
    );
  }

  return (
    <div className="maker">
      <ProjectCover thumbnailPath={meta.thumbnailPath} wave={meta.wave} name={meta.name} size="sm" className="maker-cover" />
      <div className="maker-text">
        <span className="truncate">{meta.name}</span>
        <span className="faint">
          <span className="mono">{duration(meta.duration)}</span>
          {meta.stage === "imported"
            ? ", no transcript yet"
            : `, ${saved} ${saved === 1 ? "clip" : "clips"}${meta.suggestionCount ? `, ${meta.suggestionCount} to review` : ""}`}
        </span>
      </div>
      <div className="maker-action">{action}</div>
    </div>
  );
}

export function ClipsView() {
  const library = useApp((s) => s.library);
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");
  const [transcribeId, setTranscribeId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const clips = useMemo(() => {
    const rows = library.flatMap((m) => [
      ...m.clips.map((c) => ({ clip: c, meta: m, suggested: false })),
      // Suggestions live here too, so the moment finder's output is usable without the workspace.
      ...(m.topSuggestions ?? []).map((c) => ({ clip: c, meta: m, suggested: true })),
    ]);
    return rows
      .filter(({ clip: c, suggested }) =>
        filter === "all"
          ? true
          : filter === "suggested"
            ? suggested
            : suggested
              ? false
              : filter === "exported"
                ? c.exportCount > 0
                : c.exportCount === 0,
      )
      .sort((a, b) => Number(a.suggested) - Number(b.suggested) || b.clip.updatedAt.localeCompare(a.clip.updatedAt));
  }, [library, filter]);

  const total = library.reduce((n, m) => n + m.clips.length, 0);
  const exported = library.reduce((n, m) => n + m.clips.filter((c) => c.exportCount > 0).length, 0);
  const suggestions = library.reduce((n, m) => n + (m.topSuggestions?.length ?? 0), 0);
  // Recordings that still have a step left before they produce clips.
  const makers = library.filter((m) => m.stage !== "analyzed" || m.clips.length === 0).slice(0, 5);

  const addRecording = async () => {
    setImporting(true);
    try {
      const path = await pickMediaFile();
      if (!path) return;
      const id = await importFile(path, { stay: true });
      if (id) setTranscribeId(id);
    } finally {
      setImporting(false);
    }
  };

  const openFile = async (path: string, reveal: boolean) => {
    try {
      if (!(await ipc.pathExists(path))) throw new Error("That export was moved or deleted.");
      await (reveal ? ipc.revealPath(path) : ipc.openPath(path));
    } catch (err) {
      reportError("Could not open export", err);
    }
  };

  const edit = (meta: ProjectMeta, clip: ClipMeta) => void openProject(meta.id, { view: "editor", clipId: clip.id });

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="page-title">Clips</h1>
            <p className="page-sub">
              {total} saved, {exported} exported
              {suggestions > 0 ? `, ${suggestions} suggested` : ""}
            </p>
          </div>
          <div className="page-tools">
            {(total > 0 || suggestions > 0) && (
              <Segmented<Filter>
                label="Filter clips"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "suggested", label: "Suggested" },
                  { value: "pending", label: "Not exported" },
                  { value: "exported", label: "Exported" },
                ]}
              />
            )}
            <Button variant="primary" icon={<UploadSimple />} disabled={importing} onClick={() => void addRecording()}>
              {importing ? "Reading" : "New clip"}
            </Button>
          </div>
        </header>

        {makers.length > 0 && (
          <section className="makers">
            <h2 className="section-title">Make a clip</h2>
            <div className="maker-list">
              {makers.map((m) => (
                <MakerRow key={m.id} meta={m} onTranscribe={async (id) => (await loadProjectQuietly(id)) && setTranscribeId(id)} />
              ))}
            </div>
          </section>
        )}

        {total === 0 && suggestions === 0 ? (
          library.length === 0 && (
            <EmptyState
              icon={<FilmStrip />}
              title="No clips yet"
              body="Bring in a recording and transcribe it here. Found moments land on this sheet, shaped like the frame they export to."
              action={
                <Button variant="primary" icon={<UploadSimple />} onClick={() => void addRecording()}>
                  New clip
                </Button>
              }
            />
          )
        ) : clips.length === 0 ? (
          <p className="muted">No clips in this filter.</p>
        ) : (
          <div className="contact-sheet">
            {clips.map(({ clip: c, meta, suggested }, i) => (
              <motion.article key={`${meta.id}-${c.id}`} className="sheet-tile-wrap" {...rise(reduce, Math.min(i, 12))}>
                <button className="sheet-tile" onClick={() => edit(meta, c)}>
                  <ClipCover wave={c.wave} exported={c.exportCount > 0} aspect={c.aspect} />
                  {suggested && <span className="sheet-badge">Suggested</span>}
                  <span className="sheet-tile-title">{c.title}</span>
                  <span className="sheet-tile-meta">
                    <span className="mono">{duration(c.end - c.start)}</span>
                    <span className="mono">{clock(c.start)}</span>
                    {c.category && <span>{CATEGORY_LABEL[c.category]}</span>}
                  </span>
                  <span className="sheet-tile-project">{meta.name}</span>
                </button>
                {c.lastExportPath && (
                  <div className="sheet-actions">
                    <IconButton size="sm" label="Play export" onClick={() => void openFile(c.lastExportPath!, false)}>
                      <Play weight="fill" />
                    </IconButton>
                    <IconButton size="sm" label="Show in folder" onClick={() => void openFile(c.lastExportPath!, true)}>
                      <FolderOpen />
                    </IconButton>
                  </div>
                )}
              </motion.article>
            ))}
          </div>
        )}
      </div>

      {/* Mounted only once a recording is loaded: the modal reads the current project. */}
      {transcribeId && (
        <TranscribeModal
          open
          onClose={() => setTranscribeId(null)}
          // Straight on to the moments, so a transcript started here finishes as clips here.
          onDone={() => void findMoments("initial")}
        />
      )}
    </div>
  );
}
