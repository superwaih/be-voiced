import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { clock } from "@be-voiced/engine/format";
import { useApp, type JobState } from "../store/app";
import { Button, Progress } from "./ui";

/**
 * Work in progress, shown where the work was started rather than only in the sidebar tray: a
 * downloading link, a running transcription, a moment finder pass. Long jobs report a percentage;
 * the ones that cannot say how far along they are still show their stage and how long they have run.
 */
export function JobCard({ job, title }: { job: JobState; title?: string }) {
  const cancel = useApp((s) => s.cancelJob);
  const [elapsed, setElapsed] = useState(() => (Date.now() - job.startedAt) / 1000);
  const [quiet, setQuiet] = useState(0);
  const lastChange = useRef(Date.now());

  // A slow download and a stuck one look identical without this: say how long it has been silent.
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
    <div className="jobcard">
      <div className="jobcard-head">
        <strong className="truncate">{title ?? job.label}</strong>
        <span className="mono faint">{clock(elapsed)}</span>
      </div>
      <Progress value={job.progress} label={job.label} />
      <div className="jobcard-foot">
        <span className="faint truncate">
          {quiet > 30 && <span className="jobcard-quiet">Nothing for {clock(quiet)}, still trying. </span>}
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
