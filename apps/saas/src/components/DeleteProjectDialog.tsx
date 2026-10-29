"use client";

/**
 * One confirmation for every place a recording can be deleted.
 *
 * It names what goes and what stays, because the file itself is the browser's and conversations
 * about the recording live in Ask history, not in the recording.
 */

import { Trash } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ProjectCover } from "@/components/Covers";
import { Button, Modal } from "@/components/ui";
import { deleteProject } from "@/lib/actions";
import { duration } from "@/lib/engine/format";
import { useApp } from "@/store/app";

export function DeleteProjectDialog() {
  const meta = useApp((s) => s.pendingDelete);
  const askDelete = useApp((s) => s.askDelete);
  const [busy, setBusy] = useState(false);

  useEffect(() => setBusy(false), [meta?.id]);
  if (!meta) return null;

  const saved = meta.clips.filter((c) => c.status === "saved").length;

  // Only what this recording actually holds, so a fresh import does not list three zeroes.
  const goes = [
    meta.stage === "imported" ? "The recording, not transcribed yet" : `Transcript, ${meta.wordCount.toLocaleString()} words`,
    meta.suggestionCount > 0 && `${meta.suggestionCount} suggested ${meta.suggestionCount === 1 ? "moment" : "moments"}`,
    saved > 0 && `${saved} saved ${saved === 1 ? "clip" : "clips"}, with trims and caption styles`,
    "Waveform, thumbnail and export history",
  ].filter((line): line is string => typeof line === "string");

  return (
    <Modal
      open
      onClose={() => !busy && askDelete(null)}
      title="Delete recording"
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
            {busy ? "Deleting" : "Delete recording"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <ProjectCover
            thumbnailPath={meta.thumbnailPath}
            wave={meta.wave}
            name={meta.name}
            size="sm"
            className="size-11"
          />
          <div className="min-w-0">
            <strong className="block truncate">{meta.name}</strong>
            <span className="mono text-xs text-faint">{duration(meta.duration)}</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-muted">This is removed</h3>
            <ul className="flex flex-col gap-1 text-[13px]">
              {goes.map((line) => (
                <li key={line} className="flex gap-2 text-ink">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-danger" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-muted">This stays</h3>
            <ul className="flex flex-col gap-1 text-[13px]">
              <li className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent-line" />
                <span className="truncate">{meta.sourceName}</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent-line" />
                <span>Any conversation about it, in Ask history</span>
              </li>
            </ul>
          </section>
        </div>

        <p className="text-xs text-faint">Deleting cannot be undone. You can import the file again to start over.</p>
      </div>
    </Modal>
  );
}
