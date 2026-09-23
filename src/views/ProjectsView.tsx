import { DotsThree, FolderOpen, MagnifyingGlass, Trash, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import { ask } from "@tauri-apps/plugin-dialog";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { ProjectCover } from "../components/Covers";
import { Button, EmptyState, MenuButton, Segmented, TextInput } from "../components/ui";
import { openProject } from "../lib/actions";
import { bytes, duration, relativeDate } from "../lib/format";
import { ipc } from "../lib/ipc";
import type { ProjectMeta } from "../lib/types";
import { reportError, useApp } from "../store/app";
import { useProject } from "../store/project";
import { chooseAndImport, nextStep, rise } from "./HomeView";

type Filter = "all" | "imported" | "transcribed" | "clips";

const matches = (m: ProjectMeta, f: Filter) =>
  f === "all" ? true : f === "clips" ? m.clips.length > 0 : f === "imported" ? m.stage === "imported" : m.stage !== "imported";

export function ProjectsView() {
  const library = useApp((s) => s.library);
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter((m) => matches(m, filter) && (!q || m.name.toLowerCase().includes(q) || m.sourceName.toLowerCase().includes(q)));
  }, [library, query, filter]);

  const remove = async (id: string, name: string) => {
    const ok = await ask(`Delete "${name}"? The transcript, clips and captions will be removed. Your original media file is not touched.`, {
      title: "Delete project",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Keep",
    });
    if (!ok) return;
    try {
      if (useProject.getState().project?.id === id) await useProject.getState().close();
      await ipc.deleteProject(id);
      useApp.getState().removeMeta(id);
    } catch (err) {
      reportError("Could not delete project", err);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <header className="page-header">
          <div>
            <h1 className="page-title">Projects</h1>
            <p className="page-sub">
              {library.length} {library.length === 1 ? "recording" : "recordings"}, {duration(library.reduce((n, m) => n + m.duration, 0))} of
              conversation
            </p>
          </div>
          <Button variant="primary" icon={<UploadSimple />} onClick={() => void chooseAndImport()}>
            Import
          </Button>
        </header>

        {library.length === 0 ? (
          <EmptyState
            icon={<FolderOpen />}
            title="No projects yet"
            body="Import a recording to start. Each import becomes a project with its transcript, moments and clips."
            action={
              <Button variant="primary" icon={<UploadSimple />} onClick={() => void chooseAndImport()}>
                Import recording
              </Button>
            }
          />
        ) : (
          <>
            <div className="toolbar-row">
              <Segmented<Filter>
                label="Filter projects"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All" },
                  { value: "imported", label: "To transcribe" },
                  { value: "transcribed", label: "Transcribed" },
                  { value: "clips", label: "With clips" },
                ]}
              />
              <TextInput
                icon={<MagnifyingGlass />}
                placeholder="Search"
                aria-label="Search projects"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="search-input"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="muted">No projects match.</p>
            ) : (
              <div className="shelf is-grid">
                {filtered.map((m, i) => (
                  <motion.article key={m.id} className="shelf-item-wrap" {...rise(reduce, Math.min(i, 10))}>
                    <button className="shelf-item" onClick={() => void openProject(m.id)}>
                      <ProjectCover thumbnailPath={m.thumbnailPath} wave={m.wave} name={m.name} />
                      <span className="shelf-name">{m.name}</span>
                      <span className="shelf-meta">
                        <span className="mono">{duration(m.duration)}</span>
                        <span className={m.sourceMissing ? "is-warning" : m.stage === "analyzed" ? "is-accent" : ""}>
                          {m.sourceMissing && <WarningCircle />}
                          {nextStep(m)}
                        </span>
                      </span>
                      <span className="shelf-sub">
                        {relativeDate(m.updatedAt)}, {bytes(m.size)}
                      </span>
                    </button>
                    <div className="shelf-menu">
                      <MenuButton
                        label="Project actions"
                        items={[
                          { label: "Open", onSelect: () => void openProject(m.id) },
                          { label: "Show source file", icon: <FolderOpen />, disabled: m.sourceMissing, onSelect: () => void ipc.revealPath(m.sourcePath) },
                          "divider",
                          { label: "Delete project", icon: <Trash />, danger: true, onSelect: () => void remove(m.id, m.name) },
                        ]}
                      >
                        <DotsThree weight="bold" />
                      </MenuButton>
                    </div>
                  </motion.article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
