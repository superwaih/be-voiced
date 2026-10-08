import { ClockCounterClockwise, ClockClockwise, Pause, Play } from "@phosphor-icons/react";
import { useMemo, useRef } from "react";
import { MediaElement, Waveform } from "../../components/media";
import { IconButton } from "../../components/ui";
import { usePeaks } from "../../lib/actions";
import { clock } from "@be-voiced/engine/format";
import { player, usePlayerState, usePlayerTime } from "../../lib/player";
import { useProject } from "../../store/project";

export function Transport({ showTenths = false }: { showTenths?: boolean }) {
  const { playing } = usePlayerState();
  const project = useProject((s) => s.project)!;
  const timeRef = useRef<HTMLSpanElement>(null);
  usePlayerTime((t) => {
    if (timeRef.current) timeRef.current.textContent = clock(t, { tenths: showTenths });
  });
  return (
    <div className="transport">
      <IconButton label="Back 5 seconds" onClick={() => player.skip(-5)}>
        <ClockCounterClockwise />
      </IconButton>
      <button className="play-btn" aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => player.toggle()}>
        {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
      </button>
      <IconButton label="Forward 5 seconds" onClick={() => player.skip(5)}>
        <ClockClockwise />
      </IconButton>
      <span className="transport-time mono">
        <span ref={timeRef}>0:00</span>
        <span className="faint"> / {clock(project.source.duration)}</span>
      </span>
    </div>
  );
}

function OverviewTimeline({ selectedClipId, onSelectClip, topicId }: { selectedClipId: string | null; onSelectClip: (id: string) => void; topicId: string | null }) {
  const project = useProject((s) => s.project)!;
  const peaks = usePeaks((s) => s.byProject[project.id]);
  const total = project.source.duration || 1;
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const topic = project.topics.find((t) => t.id === topicId);

  usePlayerTime((t) => {
    if (headRef.current) headRef.current.style.left = `${(t / total) * 100}%`;
  }, [total]);

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    player.seek(f * total);
  };

  const visibleClips = project.clips.filter((c) => c.status !== "rejected");
  const hotRanges = useMemo(
    () => project.clips.filter((c) => c.status === "saved" || c.id === selectedClipId).map((c) => ({ start: c.start, end: c.end })),
    [project.clips, selectedClipId],
  );

  return (
    <div className="overview">
      <div
        ref={trackRef}
        className="overview-track"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e.clientX)}
      >
        <Waveform peaks={peaks instanceof Uint8Array ? peaks : null} start={0} end={total} className="overview-wave" ranges={hotRanges} />
        {peaks === "loading" && <div className="overview-loading skeleton" />}
        {topic?.ranges.map((r, i) => (
          <div key={i} className="overview-topic" style={{ left: `${(r.start / total) * 100}%`, width: `${((r.end - r.start) / total) * 100}%` }} />
        ))}
        {visibleClips.map((c) => (
          <button
            key={c.id}
            className={`overview-clip is-${c.status} ${c.id === selectedClipId ? "is-selected" : ""}`}
            style={{ left: `${(c.start / total) * 100}%`, width: `max(3px, ${((c.end - c.start) / total) * 100}%)` }}
            title={c.title}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              onSelectClip(c.id);
              player.seek(c.start);
            }}
          />
        ))}
        <div ref={headRef} className="overview-head" />
      </div>
      <div className="overview-scale mono faint">
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
    <section className="topics" aria-label="Topics">
      <div className="panel-subhead">
        <h3>Topics</h3>
        {topicId && (
          <button className="link-btn" onClick={() => onTopic(null)}>
            Show full transcript
          </button>
        )}
      </div>
      <div className="topic-list">
        {topics.map((t) => {
          const covered = t.ranges.reduce((n, r) => n + (r.end - r.start), 0);
          const active = t.id === topicId;
          return (
            <button
              key={t.id}
              className={`topic ${active ? "is-active" : ""}`}
              aria-pressed={active}
              onClick={() => {
                onTopic(active ? null : t.id);
                if (!active && t.ranges[0]) player.seek(t.ranges[0].start);
              }}
            >
              <span className="topic-row">
                <span className="topic-name">{t.name}</span>
                <span className="mono faint topic-len">{clock(covered)}</span>
              </span>
              {t.summary && <span className="topic-summary">{t.summary}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PlayerPanel(props: {
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  topicId: string | null;
  onTopic: (id: string | null) => void;
}) {
  return (
    <section className="ws-player" aria-label="Player">
      <div className="ws-player-top">
        <div className="ws-video">
          <MediaElement className="media-contain" />
        </div>
        <Transport />
        <OverviewTimeline selectedClipId={props.selectedClipId} onSelectClip={props.onSelectClip} topicId={props.topicId} />
      </div>
      <TopicsList topicId={props.topicId} onTopic={props.onTopic} />
    </section>
  );
}
