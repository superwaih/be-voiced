"use client";

/**
 * Work in progress, shown where the work was started rather than only in the tray.
 *
 * Jobs that know how far along they are report a percentage; the ones that cannot still show their
 * stage and how long they have been running. A slow job and a stuck one look identical without
 * that, so a job that has gone quiet says how long it has been quiet for.
 */

import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button, Progress } from "@/components/ui";
import { clock } from "@/lib/engine/format";
import { useApp, type JobState } from "@/store/app";

export function JobCard({ job, title }: { job: JobState; title?: string }) {
  const cancel = useApp((s) => s.cancelJob);
  const [elapsed, setElapsed] = useState(() => (Date.now() - job.startedAt) / 1000);
  const [quiet, setQuiet] = useState(0);
  const lastChange = useRef(Date.now());

  useEffect(() => {
    lastChange.current = Date.now();
    setQuiet(0);
  }, [job.stage, job.progress, job.detail]);

  useEffect(() => {
    const tick = () => {
      setElapsed((Date.now() - job.startedAt) / 1000);
      setQuiet((Date.now() - lastChange.current) / 1000);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [job.id, job.startedAt]);

  return (
    <div className="flex flex-col gap-2 rounded-panel bg-sunken p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <strong className="truncate text-[13px]">{title ?? job.label}</strong>
        <span className="mono shrink-0 text-xs text-faint">{clock(elapsed)}</span>
      </div>
      <Progress value={job.progress} label={job.label} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-faint">
          {quiet > 30 && <span className="text-danger">Nothing for {clock(quiet)}, still trying. </span>}
          {job.stage}
          {job.detail ? `, ${job.detail}` : ""}
          {job.progress !== null ? ` — ${Math.round(job.progress * 100)}%` : ""}
        </span>
        <Button size="sm" variant="ghost" icon={<X />} onClick={() => cancel(job.id)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
