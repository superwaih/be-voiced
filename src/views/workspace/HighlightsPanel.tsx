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
import { useEffect, useMemo, useRef, useState } from "react";
import { WaveArt } from "../../components/WaveArt";
import { usePeaks } from "../../store/peaks";
import { sampleWave } from "../../lib/wave";
import { Button, EmptyState, IconButton, InlineEdit, Popover, Progress, Segmented } from "../../components/ui";
import { findMoments } from "../../lib/actions";
import { clock, duration } from "../../lib/format";
import { player, usePlayerState } from "../../lib/player";
import { CATEGORY_LABEL } from "../../lib/project";
import { buildUnits, flattenWords, nudgeBySentence, wordsInRange, type Unit } from "../../lib/transcript";
import type { Clip, ClipStatus } from "../../lib/types";
import { useApp } from "../../store/app";
import { useProject } from "../../store/project";
import { openEditor } from "../ProjectView";

type Tab = ClipStatus;

export function HighlightsPanel({ selectedClipId, onSelectClip }: { selectedClipId: string | null; onSelectClip: (id: string | null) => void }) {
  const project = useProject((s) => s.project)!;
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "analyze" && j.projectId === project.id));
  const hasDeepgram = useApp((s) => !!s.keys.deepgram);
  const cancel = useApp((s) => s.cancelJob);
  const setView = useApp((s) => s.setView);
  const [tab, setTab] = useState<Tab>(() => (project.clips.some((c) => c.status === "suggested") || !project.clips.length ? "suggested" : "saved"));
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
    return tab === "suggested"
      ? items.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      : items.sort((a, b) => a.start - b.start);
  }, [project.clips, tab]);

  // Jump to the tab that contains a clip selected elsewhere (timeline, new clip from selection).
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
      <div className="panel-empty">
        <EmptyState icon={<Sparkle />} title="Moments come after the transcript" body="Once the conversation is transcribed, Be Voiced reads all of it and picks the parts worth publishing." />
      </div>
    );
  } else if (job && tab === "suggested") {
    body = (
      <div className="analyzing">
        <div className="analyzing-status">
          <div className="strong">{job.label}</div>
          <div className="faint">{job.detail ?? job.stage}</div>
          <Progress value={null} label="Analysis in progress" />
          <Button size="sm" variant="ghost" onClick={() => cancel(job.id)}>
            Cancel
          </Button>
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="moment-skeleton" aria-hidden="true">
            <div className="skeleton" style={{ width: "70%", height: 12 }} />
            <div className="skeleton" style={{ width: 90, height: 9 }} />
            <div className="skeleton" style={{ width: "92%", height: 9 }} />
            <div className="skeleton" style={{ width: "60%", height: 9 }} />
          </div>
        ))}
      </div>
    );
  } else if (!project.analysis && tab === "suggested") {
    body = (
      <div className="panel-empty">
        <EmptyState
          icon={<Sparkle />}
          title="Find the best moments"
          body={
            <>
              Reads the whole conversation and picks what you would watch with only a few minutes: strong takes, clear answers,
              stories and quotable lines. Runs on this computer.
              {!hasDeepgram && " Add a Deepgram key to also detect topics."}
            </>
          }
          action={
            <>
              <Button variant="primary" icon={<Sparkle />} onClick={() => void findMoments("initial")}>
                Find moments
              </Button>
              {!hasDeepgram && (
                <Button variant="ghost" onClick={() => setView("settings")}>
                  Add Deepgram key
                </Button>
              )}
            </>
          }
        />
      </div>
    );
  } else if (!list.length) {
    body = (
      <div className="panel-empty">
        <p className="muted">
          {tab === "suggested"
            ? "Every suggestion has been reviewed."
            : tab === "saved"
              ? "Nothing saved yet. Save a suggestion, or select transcript text to make your own clip."
              : "No rejected suggestions."}
        </p>
      </div>
    );
  } else {
    body = (
      <div className="moment-list">
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
    <section className="ws-moments" aria-label="Moments">
      <div className="moments-head">
        <Segmented<Tab>
          label="Moment status"
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: "suggested", label: <>Suggested <span className="count mono">{counts.suggested}</span></> },
            { value: "saved", label: <>Saved <span className="count mono">{counts.saved}</span></> },
            { value: "rejected", label: <>Rejected <span className="count mono">{counts.rejected}</span></> },
          ]}
        />
      </div>
      {body}
      {project.analysis && tab === "suggested" && !job && (
        <div className="moments-foot">
          <Button ref={setMoreAnchor} icon={<Sparkle />} trailing={<CaretDown size={12} />} onClick={() => setMoreOpen((v) => !v)}>
            Find more
          </Button>
          <Popover anchor={moreAnchor} open={moreOpen} onClose={() => setMoreOpen(false)} side="top" width={320}>
            <form
              className="more-pop"
              onSubmit={(e) => {
                e.preventDefault();
                runMore();
              }}
            >
              <label className="field">
                <span className="field-label">Anything to favour? (optional)</span>
                <textarea
                  className="textarea"
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
                />
              </label>
              <div className="more-pop-actions">
                <span className="faint">Skips moments you already have.</span>
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
  const peaks = usePeaks((s) => s.byProject[projectId]);
  const { playing } = usePlayerState();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const wave = useMemo(
    () => (peaks instanceof Uint8Array ? sampleWave(peaks, clip.start, clip.end, 28) : []),
    [peaks, clip.start, clip.end],
  );
  const [previewing, setPreviewing] = useState(false);
  const preview = useMemo(() => wordsInRange(words, clip.start, clip.end).map((w) => w.text).join(" "), [words, clip.start, clip.end]);

  useEffect(() => {
    if (!playing) setPreviewing(false);
  }, [playing]);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const nudge = (edge: "start" | "end", dir: -1 | 1) => updateClip(clip.id, nudgeBySentence(units, clip.start, clip.end, edge, dir), { coalesce: `nudge-${clip.id}` });

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
      className={`moment ${selected ? "is-selected" : ""} ${previewing && playing ? "is-playing" : ""} ${clip.status === "suggested" && (clip.rank ?? 99) <= 3 ? "is-top" : ""}`}
    >
      <div
        className="moment-summary"
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
      >
        <span className="moment-cover">
          <span className="moment-cover-wave">
            <WaveArt values={wave} gap={0.4} min={0.12} />
          </span>
          <span className="moment-rank mono">{clip.status === "suggested" ? clip.rank ?? index : index}</span>
          <button
            className="moment-play"
            aria-label={previewing && playing ? "Stop preview" : "Preview"}
            title={previewing && playing ? "Stop preview" : "Preview"}
            onClick={(e) => {
              e.stopPropagation();
              togglePreview();
            }}
          >
            {previewing && playing ? <Stop weight="fill" /> : <Play weight="fill" />}
          </button>
        </span>
        <div className="moment-main">
          <h3 className="moment-title">{clip.title}</h3>
          <div className="moment-meta">
            <span className="mono">{clock(clip.start)}</span>
            <span className="mono">{duration(clip.end - clip.start)}</span>
            {clip.category && <span>{CATEGORY_LABEL[clip.category]}</span>}
            {clip.origin === "manual" && <span>Your cut</span>}
          </div>
          {!selected && clip.summary && <p className="moment-text clamp-2">{clip.summary}</p>}
        </div>
      </div>

      {selected && (
        <div className="moment-detail">
          {clip.summary && <p className="moment-text">{clip.summary}</p>}
          {clip.why && (
            <p className="moment-why">
              <span className="faint">Why it works. </span>
              {clip.why}
            </p>
          )}
          <dl className="moment-facts">
            {clip.speaker && speakerCount > 1 && (
              <>
                <dt>Speaker</dt>
                <dd>{clip.speaker}</dd>
              </>
            )}
            {clip.topic && (
              <>
                <dt>Topic</dt>
                <dd>{clip.topic}</dd>
              </>
            )}
            <dt>Range</dt>
            <dd className="mono">
              {clock(clip.start, { tenths: true })} to {clock(clip.end, { tenths: true })}
            </dd>
          </dl>

          <blockquote className="moment-quote" data-selectable>
            {preview}
          </blockquote>

          <div className="moment-trim" aria-label="Adjust by sentence">
            <div className="trim-group">
              <span className="faint">Start</span>
              <IconButton size="sm" label="Remove first sentence" onClick={() => nudge("start", 1)}>
                <Minus />
              </IconButton>
              <IconButton size="sm" label="Add the sentence before" onClick={() => nudge("start", -1)}>
                <Plus />
              </IconButton>
            </div>
            <div className="trim-group">
              <span className="faint">End</span>
              <IconButton size="sm" label="Remove last sentence" onClick={() => nudge("end", -1)}>
                <Minus />
              </IconButton>
              <IconButton size="sm" label="Add the sentence after" onClick={() => nudge("end", 1)}>
                <Plus />
              </IconButton>
            </div>
          </div>

          <div className="moment-rename">
            <span className="faint">Title</span>
            <InlineEdit label="Clip title" value={clip.title} onCommit={(title) => updateClip(clip.id, { title })} />
          </div>

          <div className="moment-actions">
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
            <span className="toolbar-spacer" />
            <Button
              size="sm"
              icon={<PencilSimple />}
              onClick={() => {
                if (clip.status !== "saved") updateClip(clip.id, { status: "saved" });
                openEditor(clip.id);
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
