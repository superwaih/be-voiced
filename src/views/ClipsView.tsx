import { FilmStrip, FolderOpen, Play, SquaresFour } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { ClipCover } from "../components/Covers";
import { Button, EmptyState, IconButton, Segmented } from "../components/ui";
import { openProject } from "../lib/actions";
import { clock, duration } from "../lib/format";
import { ipc } from "../lib/ipc";
import { CATEGORY_LABEL } from "../lib/project";
import { reportError, useApp } from "../store/app";
import { rise } from "./HomeView";

type Filter = "all" | "exported" | "pending";

export function ClipsView() {
  const library = useApp((s) => s.library);
  const setView = useApp((s) => s.setView);
  const reduce = useReducedMotion();
  const [filter, setFilter] = useState<Filter>("all");

  const clips = useMemo(
    () =>
      library
        .flatMap((m) => m.clips.map((c) => ({ clip: c, meta: m })))
        .filter(({ clip: c }) => (filter === "all" ? true : filter === "exported" ? c.exportCount > 0 : c.exportCount === 0))
        .sort((a, b) => b.clip.updatedAt.localeCompare(a.clip.updatedAt)),
    [library, filter],
  );
  const total = library.reduce((n, m) => n + m.clips.length, 0);
  const exported = library.reduce((n, m) => n + m.clips.filter((c) => c.exportCount > 0).length, 0);

  const openFile = async (path: string, reveal: boolean) => {
    try {
      if (!(await ipc.pathExists(path))) throw new Error("That export was moved or deleted.");
      await (reveal ? ipc.revealPath(path) : ipc.openPath(path));
    } catch (err) {
      reportError("Could not open export", err);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="page-title">Clips</h1>
            <p className="page-sub">
              {total} saved, {exported} exported
            </p>
          </div>
          {total > 0 && (
            <Segmented<Filter>
              label="Filter clips"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "pending", label: "Not exported" },
                { value: "exported", label: "Exported" },
              ]}
            />
          )}
        </header>

        {total === 0 ? (
          <EmptyState
            icon={<FilmStrip />}
            title="No saved clips"
            body="Save a suggested moment, or select text in a transcript to cut your own. Every saved clip lands on this sheet, shaped like its export frame."
            action={
              <Button icon={<SquaresFour />} onClick={() => setView("projects")}>
                Browse projects
              </Button>
            }
          />
        ) : clips.length === 0 ? (
          <p className="muted">No clips in this filter.</p>
        ) : (
          <div className="contact-sheet">
            {clips.map(({ clip: c, meta }, i) => (
              <motion.article key={c.id} className="sheet-tile-wrap" {...rise(reduce, Math.min(i, 12))}>
                <button className="sheet-tile" onClick={() => void openProject(meta.id, { view: "editor", clipId: c.id })}>
                  <ClipCover wave={c.wave} exported={c.exportCount > 0} aspect={c.aspect} />
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
    </div>
  );
}
