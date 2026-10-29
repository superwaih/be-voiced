"use client";

import type { ProjectMeta } from "@/lib/engine/types";

/** What this recording is waiting for, said in the words of the thing you would do next. */
export function nextStep(m: ProjectMeta): string {
  if (m.sourceMissing) return "File not open";
  if (m.stage === "imported") return "Ready to transcribe";
  if (m.stage === "transcribed") return "Ready to find moments";
  if (m.suggestionCount) return `${m.suggestionCount} ${m.suggestionCount === 1 ? "moment" : "moments"} to review`;
  const saved = m.clips.length;
  return `${saved} ${saved === 1 ? "clip" : "clips"} saved`;
}

/** Tiles arriving in sequence, unless the viewer has asked for less movement. */
export const rise = (reduce: boolean | null, i = 0) =>
  reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, delay: 0.045 * i, ease: [0.16, 1, 0.3, 1] as const },
      };
