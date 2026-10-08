import { FolderOpen, Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { deleteProject } from "../lib/actions";
import { duration } from "@be-voiced/engine/format";
import { ipc } from "../lib/ipc";
import { useApp } from "../store/app";
import { ProjectCover } from "./Covers";
import { Button, Modal } from "./ui";

/**
 * One confirmation for every place a project can be deleted. It names what goes with the project
 * and what stays, because the source recording and finished exports live outside the project folder.
 */
export function DeleteProjectDialog() {
  const meta = useApp((s) => s.pendingDelete);
  const askDelete = useApp((s) => s.askDelete);
  const [busy, setBusy] = useState(false);

  useEffect(() => setBusy(false), [meta?.id]);
  if (!meta) return null;

  const saved = meta.clips.filter((c) => c.status === "saved").length;
  const exported = meta.clips.reduce((n, c) => n + c.exportCount, 0);
  // Only what this project actually holds, so an untranscribed import does not list three zeroes.
  const goes = [
    meta.stage === "imported" ? "The project, not transcribed yet" : `Transcript, ${meta.wordCount.toLocaleString()} words`,
    meta.suggestionCount > 0 && `${meta.suggestionCount} suggested ${meta.suggestionCount === 1 ? "moment" : "moments"}`,
    saved > 0 && `${saved} saved ${saved === 1 ? "clip" : "clips"}, with trims and caption styles`,
    "Waveform, thumbnail and export history",
  ].filter((line): line is string => typeof line === "string");

  return (
    <Modal
      open
      onClose={() => !busy && askDelete(null)}
      title="Delete project"
      width={520}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => askDelete(null)}>
            Keep
          </Button>
          <Button
            variant="danger"
            icon={<Trash />}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void deleteProject(meta.id);
            }}
          >
            {busy ? "Deleting" : "Delete project"}
          </Button>
        </>
      }
    >
      <div className="confirm-delete">
        <div className="confirm-head">
          <ProjectCover thumbnailPath={meta.thumbnailPath} wave={meta.wave} name={meta.name} size="sm" className="confirm-cover" />
          <div>
            <strong className="confirm-name">{meta.name}</strong>
            <span className="faint mono">{duration(meta.duration)}</span>
          </div>
        </div>

        <div className="confirm-cols">
          <section>
            <h3>This is removed</h3>
            <ul className="confirm-list is-going">
              {goes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <section>
            <h3>This stays</h3>
            <ul className="confirm-list is-staying">
              <li className="truncate" title={meta.sourcePath}>
                {meta.sourceName}
              </li>
              {exported > 0 && (
                <li>
                  {exported} exported {exported === 1 ? "file" : "files"} already on disk
                </li>
              )}
            </ul>
            {!meta.sourceMissing && (
              <button className="link-btn" onClick={() => void ipc.revealPath(meta.sourcePath)}>
                <FolderOpen /> Show recording
              </button>
            )}
          </section>
        </div>
        <p className="faint confirm-note">Deleting cannot be undone. You can import the recording again to start over.</p>
      </div>
    </Modal>
  );
}
