"use client";

/**
 * Every background task — imports, transcripts, moment finding, waveforms — in one place in the
 * navigation, with the details on click. Nothing when nothing is running.
 */

import { X } from "@phosphor-icons/react";
import { useState } from "react";
import { IconButton, Popover, Progress } from "@/components/ui";
import { cx } from "@/lib/cx";
import { useApp } from "@/store/app";

export function JobTray({ collapsed, compact }: { collapsed?: boolean; compact?: boolean }) {
  const jobs = useApp((s) => s.jobs);
  const cancel = useApp((s) => s.cancelJob);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  const running = Object.values(jobs);
  if (!running.length) return null;

  // An average is only honest when every job can say how far along it is.
  const known = running.filter((j) => j.progress !== null);
  const avg = known.length === running.length ? known.reduce((n, j) => n + (j.progress ?? 0), 0) / running.length : null;
  const r = 14;
  const circumference = 2 * Math.PI * r;
  const first = running[0];

  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        onClick={() => setOpen((v) => !v)}
        title="Background work"
        className={cx(
          "flex w-full items-center gap-3 rounded-full px-2 py-1.5 text-left font-semibold text-rail-ink transition-colors hover:bg-rail-active",
          compact ? "min-h-10 w-auto px-1" : "min-h-[46px]",
          collapsed && "lg:justify-center lg:px-0",
        )}
      >
        <span className={cx("relative grid size-[34px] shrink-0 place-items-center text-[11px]", avg === null && "animate-[spin_1.2s_linear_infinite]")}>
          <svg viewBox="0 0 34 34" aria-hidden="true" className="absolute inset-0 -rotate-90">
            <circle cx="17" cy="17" r={r} fill="none" strokeWidth="2.5" className="stroke-rail-line" />
            <circle
              cx="17"
              cy="17"
              r={r}
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              className="stroke-rail-ink transition-[stroke-dashoffset] duration-300"
              strokeDasharray={circumference}
              strokeDashoffset={avg === null ? circumference * 0.7 : circumference * (1 - avg)}
            />
          </svg>
          <span className="mono">{running.length}</span>
        </span>
        {!compact && (
          <span className={cx("flex min-w-0 flex-col text-[13px]", collapsed && "lg:hidden")}>
            <span className="truncate">{running.length === 1 ? first.label : `${running.length} tasks running`}</span>
            <span className="truncate text-xs font-medium text-rail-text">
              {first.stage}
              {avg !== null ? ` ${Math.round(avg * 100)}%` : ""}
            </span>
          </span>
        )}
      </button>

      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} side="top" width={300}>
        <div className="flex flex-col gap-3 p-2.5">
          {running.map((j) => (
            <div key={j.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold">{j.label}</div>
                  <div className="truncate text-xs text-faint">
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
