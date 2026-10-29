"use client";

/**
 * The player: the picture, the transport, and the whole recording as one waveform you can scrub.
 *
 * Playback time never goes through React. The transport's clock and the playhead are written
 * straight to the DOM from a requestAnimationFrame loop, so sixty updates a second cost nothing.
 */

import { ClockClockwise, ClockCounterClockwise, Pause, Play } from "@phosphor-icons/react";
import { useMemo, useRef } from "react";
import { MediaElement, Waveform } from "@/components/media";
import { IconButton } from "@/components/ui";
import { cx } from "@/lib/cx";
import { clock } from "@/lib/engine/format";
import { player, usePlayerState, usePlayerTime } from "@/lib/player";
import { usePeaks } from "@/store/peaks";
import { useProject } from "@/store/project";

export function Transport({ showTenths = false }: { showTenths?: boolean }) {
  const { playing } = usePlayerState();
  const project = useProject((s) => s.project)!;
  const timeRef = useRef<HTMLSpanElement>(null);

  usePlayerTime((t) => {
    if (timeRef.current) timeRef.current.textContent = clock(t, { tenths: showTenths });
  });

  return (
    <div className="flex flex-none items-center gap-1">
      <IconButton label="Back 5 seconds" onClick={() => player.skip(-5)}>
        <ClockCounterClockwise />
      </IconButton>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={() => player.toggle()}
        className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink transition-transform active:scale-95 [&_svg]:size-[18px]"
      >
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </button>
      <IconButton label="Forward 5 seconds" onClick={() => player.skip(5)}>
        <ClockClockwise />
      </IconButton>
      <span className="mono ml-1 text-xs">
        <span ref={timeRef}>0:00</span>
        <span className="text-faint"> / {clock(project.source.duration)}</span>
      </span>
    </div>
  );
}

function OverviewTimeline({
  selectedClipId,
  onSelectClip,
  topicId,
}: {
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  topicId: string | null;
}) {
  const project = useProject((s) => s.project)!;
  const peaks = usePeaks((s) => s.byProject[project.id]);
  const total = project.source.duration || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const topic = project.topics.find((t) => t.id === topicId);

  usePlayerTime(
    (t) => {
      if (headRef.current) headRef.current.style.left = `${(t / total) * 100}%`;
    },
    [total],
  );

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    player.seek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total);
  };

  const visibleClips = project.clips.filter((c) => c.status !== "rejected");
  const hotRanges = useMemo(
    () =>
      project.clips
        .filter((c) => c.status === "saved" || c.id === selectedClipId)
        .map((c) => ({ start: c.start, end: c.end })),
    [project.clips, selectedClipId],
  );

  return (
    <div className="flex flex-none flex-col gap-1">
      <div
        ref={trackRef}
        className="relative h-14 cursor-pointer touch-none rounded-[10px] bg-sunken px-0.5"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e.clientX)}
      >
        <Waveform peaks={peaks instanceof Uint8Array ? peaks : null} start={0} end={total} ranges={hotRanges} />

        {topic?.ranges.map((r, i) => (
          <div
            key={i}
            className="pointer-events-none absolute inset-y-0 bg-accent-soft"
            style={{ left: `${(r.start / total) * 100}%`, width: `${((r.end - r.start) / total) * 100}%` }}
          />
        ))}

        {visibleClips.map((c) => (
          <button
            key={c.id}
            type="button"
            title={c.title}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              onSelectClip(c.id);
              player.seek(c.start);
            }}
            className={cx(
              "absolute bottom-0 h-1.5 rounded-full transition-colors",
              c.id === selectedClipId ? "bg-accent" : c.status === "saved" ? "bg-accent-line" : "bg-line-strong",
            )}
            style={{
              left: `${(c.start / total) * 100}%`,
              width: `max(3px, ${((c.end - c.start) / total) * 100}%)`,
            }}
          />
        ))}

        <div ref={headRef} className="pointer-events-none absolute inset-y-0 w-px bg-accent-text" />
      </div>
      <div className="mono flex justify-between text-[11px] text-faint">
        <span>0:00</span>
        <span>{clock(total / 2)}</span>
        <span>{clock(total)}</span>
      </div>
    </div>
  );
}

function TopicsList({ topicId, onTopic }: { topicId: string | null; onTopic: (id: string | null) => void }) {
  const topics = useProject((s) => s.project!.topics);
  if (!topics.length) return null;

  return (
    <section aria-label="Topics" className="mt-3 flex min-h-0 flex-col gap-2 overflow-auto">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[12.5px] font-semibold text-muted">Topics</h3>
        {topicId && (
          <button type="button" className="text-xs text-accent-text hover:underline" onClick={() => onTopic(null)}>
            Show full transcript
          </button>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {topics.map((t) => {
          const covered = t.ranges.reduce((n, r) => n + (r.end - r.start), 0);
          const active = t.id === topicId;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onTopic(active ? null : t.id);
                if (!active && t.ranges[0]) player.seek(t.ranges[0].start);
              }}
              className={cx(
                "flex flex-col gap-0.5 rounded-[10px] p-2 text-left transition-colors",
                active ? "bg-accent-surface text-accent-text" : "hover:bg-hover",
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold">{t.name}</span>
                <span className="mono shrink-0 text-xs text-faint">{clock(covered)}</span>
              </span>
              {t.summary && <span className="line-clamp-2 text-xs text-muted">{t.summary}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PlayerPanel({
  selectedClipId,
  onSelectClip,
  topicId,
  onTopic,
}: {
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  topicId: string | null;
  onTopic: (id: string | null) => void;
}) {
  return (
    <section
      aria-label="Player"
      className="flex min-h-0 min-w-0 flex-col rounded-[22px] bg-surface p-3.5 dark:inset-ring dark:inset-ring-line"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <MediaElement className="min-h-[180px] flex-1" />
        <Transport />
        <OverviewTimeline selectedClipId={selectedClipId} onSelectClip={onSelectClip} topicId={topicId} />
      </div>
      <TopicsList topicId={topicId} onTopic={onTopic} />
    </section>
  );
}
