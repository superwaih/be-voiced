"use client";

/**
 * The moments worth publishing: what the finder suggested, what you kept, what you turned down.
 *
 * A suggestion is a proposal, not a decision — nothing is saved until you say so, and trimming is
 * by whole sentences, because a clip that starts mid-sentence is a clip nobody watches.
 */

import {
  ArrowCounterClockwise,
  BookmarkSimple,
  CaretDown,
  Minus,
  PencilSimple,
  Play,
  Plus,
  Sparkle,
  Stop,
  Trash,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { WaveArt } from "@/components/Covers";
import { Button, EmptyState, IconButton, InlineEdit, Popover, Progress, Segmented } from "@/components/ui";
import { findMoments } from "@/lib/actions";
import { cx } from "@/lib/cx";
import { clock, duration } from "@/lib/engine/format";
import { CATEGORY_LABEL } from "@/lib/engine/project";
import { buildUnits, flattenWords, nudgeBySentence, wordsInRange, type Unit } from "@/lib/engine/transcript";
import type { Clip, ClipStatus } from "@/lib/engine/types";
import { sampleWave } from "@/lib/engine/wave";
import { player, usePlayerState } from "@/lib/player";
import { useApp } from "@/store/app";
import { usePeaks } from "@/store/peaks";
import { useProject } from "@/store/project";

type Tab = ClipStatus;

export function MomentsPanel({
  selectedClipId,
  onSelectClip,
}: {
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
}) {
  const project = useProject((s) => s.project)!;
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "analyze" && j.projectId === project.id));
  const cancel = useApp((s) => s.cancelJob);
  const [tab, setTab] = useState<Tab>(() =>
    project.clips.some((c) => c.status === "suggested") || !project.clips.length ? "suggested" : "saved",
  );
  const [moreAnchor, setMoreAnchor] = useState<HTMLButtonElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [focus, setFocus] = useState("");

  const units = useMemo(() => buildUnits(project.transcript), [project.transcript]);
  const words = useMemo(() => flattenWords(project.transcript), [project.transcript]);

  const counts = useMemo(() => {
    const c = { suggested: 0, saved: 0, rejected: 0 };
    project.clips.forEach((clip) => c[clip.status]++);
    return c;
  }, [project.clips]);

  const list = useMemo(() => {
    const items = project.clips.filter((c) => c.status === tab);
    return tab === "suggested" ? items.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)) : items.sort((a, b) => a.start - b.start);
  }, [project.clips, tab]);

  // Follow a clip selected elsewhere — on the timeline, or just cut from the transcript.
  useEffect(() => {
    const clip = project.clips.find((c) => c.id === selectedClipId);
    if (clip && clip.status !== tab) setTab(clip.status);
  }, [selectedClipId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runMore = () => {
    setMoreOpen(false);
    setTab("suggested");
    void findMoments("more", focus.trim() || null);
    setFocus("");
  };

  let body;
  if (!project.transcript) {
    body = (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={<Sparkle />}
          title="Moments come after the transcript"
          body="Once the conversation is transcribed, Soundbite reads all of it and picks the parts worth publishing."
        />
      </div>
    );
  } else if (job && tab === "suggested") {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <div className="flex flex-col gap-2 rounded-panel bg-sunken p-3.5">
          <div className="font-semibold">{job.label}</div>
          <div className="text-xs text-faint">{job.detail ?? job.stage}</div>
          <Progress value={null} label="Analysis in progress" />
          <Button size="sm" variant="ghost" className="self-start" onClick={() => cancel(job.id)}>
            Cancel
          </Button>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} aria-hidden="true" className="flex flex-col gap-2 rounded-panel p-3 opacity-60">
            <div className="h-3 w-[70%] animate-pulse rounded-full bg-sunken" />
            <div className="h-2 w-24 animate-pulse rounded-full bg-sunken" />
            <div className="h-2 w-[92%] animate-pulse rounded-full bg-sunken" />
            <div className="h-2 w-[60%] animate-pulse rounded-full bg-sunken" />
          </div>
        ))}
      </div>
    );
  } else if (!project.analysis && tab === "suggested") {
    body = (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={<Sparkle />}
          title="Find the best moments"
          body="Reads the whole conversation and picks what you would watch with only a few minutes: strong takes, clear answers, stories and quotable lines."
          action={
            <Button variant="primary" icon={<Sparkle />} onClick={() => void findMoments("initial")}>
              Find moments
            </Button>
          }
        />
      </div>
    );
  } else if (!list.length) {
    body = (
      <div className="grid flex-1 place-items-center px-6 text-center">
        <p className="text-muted">
          {tab === "suggested"
            ? "Every suggestion has been reviewed."
            : tab === "saved"
              ? "Nothing saved yet. Save a suggestion, or select transcript text to make your own clip."
              : "Nothing rejected."}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2.5">
        <AnimatePresence initial={false} mode="popLayout">
          {list.map((clip, i) => (
            <MomentItem
              key={clip.id}
              clip={clip}
              index={i + 1}
              selected={clip.id === selectedClipId}
              onSelect={() => onSelectClip(clip.id === selectedClipId ? null : clip.id)}
              units={units}
              words={words}
              speakerCount={project.transcript?.speakers.length ?? 1}
            />
          ))}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <section
      aria-label="Moments"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] bg-surface dark:inset-ring dark:inset-ring-line"
    >
      <div className="flex flex-none items-center justify-center border-b border-line px-3 py-2.5">
        <Segmented<Tab>
          label="Moment status"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            {
              value: "suggested",
              label: (
                <>
                  Suggested <span className="mono text-xs opacity-70">{counts.suggested}</span>
                </>
              ),
            },
            {
              value: "saved",
              label: (
                <>
                  Saved <span className="mono text-xs opacity-70">{counts.saved}</span>
                </>
              ),
            },
            {
              value: "rejected",
              label: (
                <>
                  Rejected <span className="mono text-xs opacity-70">{counts.rejected}</span>
                </>
              ),
            },
          ]}
        />
      </div>

      {body}

      {project.analysis && tab === "suggested" && !job && (
        <div className="flex flex-none items-center justify-center border-t border-line p-2.5">
          <Button ref={setMoreAnchor} icon={<Sparkle />} trailing={<CaretDown size={12} />} onClick={() => setMoreOpen((v) => !v)}>
            Find more
          </Button>
          <Popover anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} side="top" width={320}>
            <form
              className="flex flex-col gap-2 p-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                runMore();
              }}
            >
              <label className="flex flex-col gap-[7px]">
                <span className="text-[12.5px] font-semibold text-muted">Anything to favour? (optional)</span>
                <textarea
                  rows={2}
                  autoFocus
                  placeholder="Funny moments, advice for founders, anything about pricing"
                  value={focus}
                  onChange={(e) => setFocus(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      runMore();
                    }
                  }}
                  className="w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 leading-[1.55] outline-0 focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-faint">Skips moments you already have.</span>
                <Button type="submit" variant="primary" size="sm">
                  Find 5 more
                </Button>
              </div>
            </form>
          </Popover>
        </div>
      )}
    </section>
  );
}

function MomentItem({
  clip,
  index,
  selected,
  onSelect,
  units,
  words,
  speakerCount,
}: {
  clip: Clip;
  index: number;
  selected: boolean;
  onSelect: () => void;
  units: Unit[];
  words: ReturnType<typeof flattenWords>;
  speakerCount: number;
}) {
  const updateClip = useProject((s) => s.updateClip);
  const update = useProject((s) => s.update);
  const projectId = useProject((s) => s.project!.id);
  const router = useRouter();
  const peaks = usePeaks((s) => s.byProject[projectId]);
  const { playing } = usePlayerState();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);

  const wave = useMemo(
    () => (peaks instanceof Uint8Array ? sampleWave(peaks, clip.start, clip.end, 28) : []),
    [peaks, clip.start, clip.end],
  );
  const [previewing, setPreviewing] = useState(false);
  const preview = useMemo(
    () =>
      wordsInRange(words, clip.start, clip.end)
        .map((w) => w.text)
        .join(" "),
    [words, clip.start, clip.end],
  );

  useEffect(() => {
    if (!playing) setPreviewing(false);
  }, [playing]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const nudge = (edge: "start" | "end", dir: -1 | 1) =>
    updateClip(clip.id, nudgeBySentence(units, clip.start, clip.end, edge, dir), { coalesce: `nudge-${clip.id}` });

  const togglePreview = () => {
    if (previewing && playing) {
      player.pause();
      setPreviewing(false);
    } else {
      player.playRange(clip.start, clip.end);
      setPreviewing(true);
    }
  };

  return (
    <motion.article
      ref={ref}
      layout={reduce ? false : "position"}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.35, delay: Math.min(index, 8) * 0.045, ease: [0.16, 1, 0.3, 1] } }}
      exit={reduce ? undefined : { opacity: 0, x: 24, transition: { duration: 0.2 } }}
      className={cx(
        "overflow-hidden rounded-panel transition-colors",
        selected ? "bg-accent-surface" : "hover:bg-hover",
        previewing && playing && "inset-ring inset-ring-accent-line",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={selected}
        onClick={() => {
          onSelect();
          if (!selected) player.seek(clip.start);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget) onSelect();
        }}
        className="flex cursor-default gap-2.5 p-2.5"
      >
        <span className="relative grid size-[62px] shrink-0 place-items-center overflow-hidden rounded-[12px] bg-gradient-to-br from-cover to-cover-2">
          <span className="block size-full p-2 text-cover-bar/60">
            <WaveArt values={wave} gap={0.4} min={0.12} />
          </span>
          <span className="mono absolute top-1 left-1.5 text-[10px] text-cover-ink/70">
            {clip.status === "suggested" ? (clip.rank ?? index) : index}
          </span>
          <button
            type="button"
            aria-label={previewing && playing ? "Stop preview" : "Preview"}
            title={previewing && playing ? "Stop preview" : "Preview"}
            onClick={(e) => {
              e.stopPropagation();
              togglePreview();
            }}
            className="absolute inset-0 grid place-items-center bg-stage/35 text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-5"
          >
            {previewing && playing ? <Stop weight="fill" /> : <Play weight="fill" />}
          </button>
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{clip.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-faint">
            <span className="mono">{clock(clip.start)}</span>
            <span className="mono">{duration(clip.end - clip.start)}</span>
            {clip.category && <span>{CATEGORY_LABEL[clip.category]}</span>}
            {clip.origin === "manual" && <span>Your cut</span>}
          </div>
          {!selected && clip.summary && <p className="mt-1 line-clamp-2 text-[13px] text-muted">{clip.summary}</p>}
        </div>
      </div>

      {selected && (
        <div className="flex flex-col gap-3 px-2.5 pb-3">
          {clip.summary && <p className="text-[13px] text-muted">{clip.summary}</p>}
          {clip.why && (
            <p className="text-[13px] text-muted">
              <span className="text-faint">Why it works. </span>
              {clip.why}
            </p>
          )}

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {clip.speaker && speakerCount > 1 && (
              <>
                <dt className="text-faint">Speaker</dt>
                <dd>{clip.speaker}</dd>
              </>
            )}
            {clip.topic && (
              <>
                <dt className="text-faint">Topic</dt>
                <dd>{clip.topic}</dd>
              </>
            )}
            <dt className="text-faint">Range</dt>
            <dd className="mono">
              {clock(clip.start, { tenths: true })} to {clock(clip.end, { tenths: true })}
            </dd>
          </dl>

          <blockquote data-selectable className="max-h-28 overflow-auto border-l-2 border-accent-line pl-2.5 text-[13px] leading-[1.6] text-muted">
            {preview}
          </blockquote>

          <div className="flex flex-wrap items-center gap-3" aria-label="Adjust by sentence">
            <div className="flex items-center gap-1">
              <span className="text-xs text-faint">Start</span>
              <IconButton size="sm" label="Remove first sentence" onClick={() => nudge("start", 1)}>
                <Minus />
              </IconButton>
              <IconButton size="sm" label="Add the sentence before" onClick={() => nudge("start", -1)}>
                <Plus />
              </IconButton>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-faint">End</span>
              <IconButton size="sm" label="Remove last sentence" onClick={() => nudge("end", -1)}>
                <Minus />
              </IconButton>
              <IconButton size="sm" label="Add the sentence after" onClick={() => nudge("end", 1)}>
                <Plus />
              </IconButton>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-xs text-faint">Title</span>
            <InlineEdit label="Clip title" value={clip.title} onCommit={(title) => updateClip(clip.id, { title })} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {clip.status === "suggested" && (
              <>
                <Button size="sm" variant="primary" icon={<BookmarkSimple />} onClick={() => updateClip(clip.id, { status: "saved" })}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" icon={<X />} onClick={() => updateClip(clip.id, { status: "rejected" })}>
                  Reject
                </Button>
              </>
            )}
            {clip.status === "rejected" && (
              <Button size="sm" icon={<ArrowCounterClockwise />} onClick={() => updateClip(clip.id, { status: "suggested" })}>
                Restore
              </Button>
            )}
            {clip.status === "saved" && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash />}
                onClick={() =>
                  clip.origin === "ai"
                    ? updateClip(clip.id, { status: "suggested" })
                    : update((p) => ({ ...p, clips: p.clips.filter((c) => c.id !== clip.id) }))
                }
              >
                {clip.origin === "ai" ? "Unsave" : "Delete"}
              </Button>
            )}
            <Button
              size="sm"
              className="ml-auto"
              icon={<PencilSimple />}
              onClick={() => {
                // Opening the editor saves it first: editing a suggestion is deciding to keep it.
                if (clip.status !== "saved") updateClip(clip.id, { status: "saved" });
                router.push(`/project/${projectId}/clip/${clip.id}`);
              }}
            >
              Edit and export
            </Button>
          </div>
        </div>
      )}
    </motion.article>
  );
}
