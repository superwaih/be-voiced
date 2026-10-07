import { X } from "@phosphor-icons/react";
import { useState } from "react";
import { useApp } from "../store/app";
import { IconButton, Popover, Progress } from "./ui";

/** Every background task (imports, downloads, transcripts, exports) in the sidebar, with details on click. */
export function JobTray() {
  const jobs = useApp((s) => s.jobs);
  const cancel = useApp((s) => s.cancelJob);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const visible = Object.values(jobs);
  if (!visible.length) return null;

  const known = visible.filter((j) => j.progress !== null);
  const avg = known.length === visible.length ? known.reduce((n, j) => n + (j.progress ?? 0), 0) / visible.length : null;
  const r = 14;
  const c = 2 * Math.PI * r;
  const first = visible[0];

  return (
    <>
      <button
        ref={setAnchor}
        className={`side-jobs ${avg === null ? "is-indeterminate" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="Background work"
      >
        <span className="side-jobs-ring">
          <svg viewBox="0 0 34 34" aria-hidden="true">
            <circle cx="17" cy="17" r={r} className="side-jobs-track" />
            <circle cx="17" cy="17" r={r} className="side-jobs-fill" strokeDasharray={c} strokeDashoffset={avg === null ? c * 0.7 : c * (1 - avg)} />
          </svg>
          <span className="mono">{visible.length}</span>
        </span>
        <span className="side-jobs-text">
          <span>{visible.length === 1 ? first.label : `${visible.length} tasks running`}</span>
          <span className="sub">
            {first.stage}
            {avg !== null ? ` ${Math.round(avg * 100)}%` : ""}
          </span>
        </span>
      </button>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} side="top" width={300}>
        <div className="job-list">
          {visible.map((j) => (
            <div key={j.id} className="job">
              <div className="job-row">
                <div className="job-text">
                  <div className="truncate job-label">{j.label}</div>
                  <div className="truncate faint job-stage">
                    {j.stage}
                    {j.progress !== null ? ` ${Math.round(j.progress * 100)}%` : ""}
                  </div>
                </div>
                <IconButton size="sm" label={`Cancel ${j.label}`} onClick={() => cancel(j.id)}>
                  <X />
                </IconButton>
              </div>
              <Progress value={j.progress} label={j.label} />
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}
