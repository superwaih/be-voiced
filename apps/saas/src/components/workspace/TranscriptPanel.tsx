"use client";

/**
 * The transcript: readable, searchable, correctable, and the place clips are cut from.
 *
 * Two things here are deliberate. Playback highlighting bypasses React entirely — class names are
 * added and removed on the word spans from the player's animation frame — because re-rendering a
 * long transcript sixty times a second is not viable. And a text selection is turned back into a
 * word range by asking the DOM which spans the range intersects, so cutting a clip works with
 * ordinary click-and-drag rather than a special mode.
 */

import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  Check,
  CrosshairSimple,
  MagnifyingGlass,
  PencilSimple,
  Play,
  Plus,
  Scissors,
  SplitVertical,
  TextAa,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button, EmptyState, IconButton, Menu, Popover, Progress, TextInput } from "@/components/ui";
import { clipFromSelection } from "@/lib/actions";
import { serviceCan } from "@/lib/api";
import { cx } from "@/lib/cx";
import { clock, duration as fmtDuration } from "@/lib/engine/format";
import {
  flattenWords,
  mergeAdjacent,
  realignSegment,
  searchTranscript,
  segmentText,
  speakerTalkTime,
  wordAt,
} from "@/lib/engine/transcript";
import type { Segment, Topic, Transcript } from "@/lib/engine/types";
import { player, usePlayerTime } from "@/lib/player";
import { useApp } from "@/store/app";
import { useProject } from "@/store/project";

export function TranscriptPanel({
  topic,
  onClearTopic,
  onOpenTranscribe,
  onClipCreated,
}: {
  topic: Topic | null;
  onClearTopic: () => void;
  onOpenTranscribe: () => void;
  onClipCreated: (id: string) => void;
}) {
  const project = useProject((s) => s.project)!;
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "transcribe" && j.projectId === project.id));
  const cancel = useApp((s) => s.cancelJob);

  return (
    <section
      aria-label="Transcript"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] bg-surface dark:inset-ring dark:inset-ring-line"
    >
      {job ? (
        <div className="flex min-h-0 flex-col gap-4 p-4">
          <div className="flex flex-col gap-2 rounded-panel bg-sunken p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{job.label}</div>
                <div className="truncate text-xs text-faint">
                  {job.stage}
                  {job.detail ? `, ${job.detail}` : ""}
                </div>
              </div>
              <span className="mono shrink-0 text-muted">
                {job.progress !== null ? `${Math.round(job.progress * 100)}%` : ""}
              </span>
            </div>
            <Progress value={job.progress} label="Transcription progress" />
            <Button size="sm" variant="ghost" className="self-start" onClick={() => cancel(job.id)}>
              Cancel
            </Button>
          </div>

          <div aria-hidden="true" className="flex flex-col gap-4 opacity-60">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="h-2.5 w-16 shrink-0 animate-pulse rounded-full bg-sunken" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-2.5 w-[96%] animate-pulse rounded-full bg-sunken" />
                  <div className="h-2.5 animate-pulse rounded-full bg-sunken" style={{ width: `${60 + ((i * 17) % 35)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : project.transcript ? (
        <TranscriptBody
          transcript={project.transcript}
          topic={topic}
          onClearTopic={onClearTopic}
          onClipCreated={onClipCreated}
        />
      ) : (
        <div className="grid flex-1 place-items-center">
          <EmptyState
            icon={<TextAa />}
            title="No transcript yet"
            body={
              serviceCan.transcribe
                ? "Transcribe this recording to read it, search it, pull moments out of it and caption it."
                : "This browser cannot run transcription, so there is nothing to read here yet."
            }
            action={
              <Button variant="primary" onClick={onOpenTranscribe}>
                Transcribe
              </Button>
            }
          />
        </div>
      )}
    </section>
  );
}

interface SelectionState {
  first: number;
  last: number;
  x: number;
  y: number;
}

function TranscriptBody({
  transcript,
  topic,
  onClearTopic,
  onClipCreated,
}: {
  transcript: Transcript;
  topic: Topic | null;
  onClearTopic: () => void;
  onClipCreated: (id: string) => void;
}) {
  const update = useProject((s) => s.update);
  const words = useMemo(() => flattenWords(transcript), [transcript]);
  const offsets = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    for (const s of transcript.segments) {
      out.push(n);
      n += s.words.length;
    }
    return out;
  }, [transcript]);
  const speakerNames = useMemo(() => new Map(transcript.speakers.map((s) => [s.id, s.name])), [transcript.speakers]);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const hits = useMemo(() => searchTranscript(words, deferredQuery), [words, deferredQuery]);
  const [hitIndex, setHitIndex] = useState(0);
  const [follow, setFollow] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [speakerMenu, setSpeakerMenu] = useState<{ seg: number; anchor: HTMLElement } | null>(null);
  const [speakersAnchor, setSpeakersAnchor] = useState<HTMLButtonElement | null>(null);
  const [speakersOpen, setSpeakersOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const lastUserScroll = useRef(0);
  const active = useRef({ word: -1, seg: -1 });

  useEffect(() => setHitIndex(0), [deferredQuery]);

  const marks = useMemo(() => {
    const map = new Map<number, Set<number>>();
    hits.forEach((h) => {
      for (let i = h.firstWord; i <= h.lastWord; i++) {
        const seg = words[i].seg;
        if (!map.has(seg)) map.set(seg, new Set());
        map.get(seg)!.add(i);
      }
    });
    return map;
  }, [hits, words]);
  const currentHit = hits[hitIndex];

  const visible = useMemo(() => {
    const all = transcript.segments.map((s, i) => ({ s, i }));
    if (!topic) return all;
    return all.filter(({ s }) => topic.ranges.some((r) => s.start < r.end && s.end > r.start));
  }, [transcript.segments, topic]);

  // --- Following playback, straight to the DOM -----------------------------------------------

  const syncActive = useCallback(
    (t: number) => {
      const root = bodyRef.current;
      if (!root) return;
      const idx = wordAt(words, t);
      const cur = active.current;
      if (idx === cur.word) return;
      if (cur.word >= 0) root.querySelector(`[data-i="${cur.word}"]`)?.classList.remove("is-now");
      if (idx >= 0) root.querySelector(`[data-i="${idx}"]`)?.classList.add("is-now");
      const seg = idx >= 0 ? words[idx].seg : -1;
      if (seg !== cur.seg) {
        if (cur.seg >= 0) root.querySelector(`[data-seg="${cur.seg}"]`)?.classList.remove("is-current");
        if (seg >= 0) {
          const el = root.querySelector<HTMLElement>(`[data-seg="${seg}"]`);
          el?.classList.add("is-current");
          // Scrolling is held off for a few seconds after a manual scroll, so reading is not fought.
          if (el && followRef.current && !player.el?.paused && Date.now() - lastUserScroll.current > 3500) {
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
          }
        }
      }
      active.current = { word: idx, seg };
    },
    [words],
  );

  usePlayerTime(syncActive, [syncActive]);

  useEffect(() => {
    // React may have replaced those class names; put the highlight back after any render.
    bodyRef.current?.querySelectorAll(".is-now, .is-current").forEach((el) => el.classList.remove("is-now", "is-current"));
    active.current = { word: -1, seg: -1 };
    syncActive(player.time);
  }, [marks, editing, visible, currentHit, syncActive]);

  useEffect(() => {
    if (!currentHit) return;
    lastUserScroll.current = Date.now();
    bodyRef.current?.querySelector(`[data-i="${currentHit.firstWord}"]`)?.scrollIntoView({ block: "center" });
  }, [currentHit]);

  // --- Corrections ---------------------------------------------------------------------------

  const setSegments = useCallback(
    (fn: (segments: Segment[], t: Transcript) => Transcript) =>
      update((p) => (p.transcript ? { ...p, transcript: fn(p.transcript.segments, p.transcript) } : p)),
    [update],
  );

  const saveEdit = useCallback(
    (index: number, text: string) => {
      setEditing(null);
      setSegments((segs, t) => {
        const next = realignSegment(segs[index], text);
        const segments = next.words.length ? segs.map((s, i) => (i === index ? next : s)) : segs.filter((_, i) => i !== index);
        return { ...t, segments };
      });
    },
    [setSegments],
  );
  const cancelEdit = useCallback(() => setEditing(null), []);

  const assignSpeaker = (index: number, speakerId: string, newName?: string) => {
    setSegments((segs, t) => ({
      ...t,
      speakers: newName ? [...t.speakers, { id: speakerId, name: newName }] : t.speakers,
      segments: mergeAdjacent(segs.map((s, i) => (i === index ? { ...s, speaker: speakerId } : s))),
    }));
  };

  const splitTurn = (globalIndex: number) => {
    const w = words[globalIndex];
    const local = globalIndex - offsets[w.seg];
    if (local <= 0) return;
    setSegments((segs, t) => {
      const s = segs[w.seg];
      const a: Segment = { ...s, words: s.words.slice(0, local), end: s.words[local - 1].end };
      const b: Segment = {
        ...s,
        id: `${s.id}-${crypto.randomUUID().slice(0, 6)}`,
        words: s.words.slice(local),
        start: s.words[local].start,
      };
      return { ...t, segments: [...segs.slice(0, w.seg), a, b, ...segs.slice(w.seg + 1)] };
    });
  };

  const renameSpeaker = (id: string, name: string) =>
    update(
      (p) =>
        p.transcript
          ? { ...p, transcript: { ...p.transcript, speakers: p.transcript.speakers.map((s) => (s.id === id ? { ...s, name } : s)) } }
          : p,
      { coalesce: `speaker-${id}` },
    );

  // --- Selection becomes a clip ---------------------------------------------------------------

  const onMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !bodyRef.current) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const segOf = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest<HTMLElement>("[data-seg]");
    const a = segOf(range.startContainer);
    const b = segOf(range.endContainer);
    if (!a || !b || !bodyRef.current.contains(a)) return setSelection(null);

    const segEls: HTMLElement[] = [];
    let el: Element | null = a;
    while (el) {
      if (el instanceof HTMLElement && el.dataset.seg !== undefined) segEls.push(el);
      if (el === b) break;
      el = el.nextElementSibling;
    }

    let first = Infinity;
    let last = -Infinity;
    for (const segEl of segEls) {
      segEl.querySelectorAll<HTMLElement>("[data-i]").forEach((span) => {
        if (range.intersectsNode(span.firstChild ?? span)) {
          const i = Number(span.dataset.i);
          first = Math.min(first, i);
          last = Math.max(last, i);
        }
      });
    }
    if (!Number.isFinite(first)) return setSelection(null);
    const rect = range.getBoundingClientRect();
    setSelection({ first, last, x: rect.left + rect.width / 2, y: rect.top });
  };

  useEffect(() => {
    if (!selection) return;
    const clear = () => setSelection(null);
    const body = bodyRef.current;
    body?.addEventListener("scroll", clear, { passive: true });
    return () => body?.removeEventListener("scroll", clear);
  }, [selection]);

  const onBodyClick = (e: ReactMouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const span = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (span) player.seek(words[Number(span.dataset.i)].start);
  };

  const onEdit = useCallback((i: number) => setEditing(i), []);
  const onSpeaker = useCallback((seg: number, anchor: HTMLElement) => setSpeakerMenu({ seg, anchor }), []);
  const talk = useMemo(() => speakerTalkTime(transcript), [transcript]);

  const selStart = selection ? words[selection.first].start : 0;
  const selEnd = selection ? words[selection.last].end : 0;

  return (
    <>
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line px-3 py-2.5">
        <TextInput
          icon={<MagnifyingGlass />}
          placeholder="Search transcript"
          aria-label="Search transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length)
              setHitIndex((i) => (e.shiftKey ? (i - 1 + hits.length) % hits.length : (i + 1) % hits.length));
            if (e.key === "Escape") setQuery("");
          }}
          className="min-w-0 flex-1"
        />
        {query && <span className="mono shrink-0 text-xs text-faint">{hits.length ? `${hitIndex + 1}/${hits.length}` : "0"}</span>}
        {query && hits.length > 1 && (
          <>
            <IconButton size="sm" label="Previous match" onClick={() => setHitIndex((i) => (i - 1 + hits.length) % hits.length)}>
              <ArrowUp />
            </IconButton>
            <IconButton size="sm" label="Next match" onClick={() => setHitIndex((i) => (i + 1) % hits.length)}>
              <ArrowDown />
            </IconButton>
          </>
        )}
        <IconButton
          label={follow ? "Following playback" : "Follow playback"}
          active={follow}
          onClick={() => {
            setFollow((f) => !f);
            lastUserScroll.current = 0;
          }}
        >
          <CrosshairSimple />
        </IconButton>
        <Button
          ref={setSpeakersAnchor}
          size="sm"
          variant="ghost"
          icon={<UsersThree />}
          trailing={<CaretDown size={12} />}
          onClick={() => setSpeakersOpen((v) => !v)}
        >
          {transcript.speakers.length}
        </Button>
      </div>

      {topic && (
        <div className="flex flex-none items-center justify-between gap-2 bg-accent-surface px-3 py-2 text-xs text-accent-text">
          <span>
            Showing {visible.length} {visible.length === 1 ? "passage" : "passages"} about <strong>{topic.name}</strong>
          </span>
          <IconButton size="sm" label="Show full transcript" onClick={onClearTopic}>
            <X />
          </IconButton>
        </div>
      )}

      <div
        ref={bodyRef}
        onWheel={() => (lastUserScroll.current = Date.now())}
        onMouseUp={onMouseUp}
        onClick={onBodyClick}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 py-4"
      >
        {visible.map(({ s, i }) => (
          <SegmentView
            key={s.id}
            seg={s}
            index={i}
            offset={offsets[i]}
            speakerName={speakerNames.get(s.speaker) ?? s.speaker}
            marks={marks.get(i)}
            currentHitFirst={currentHit && words[currentHit.firstWord].seg === i ? currentHit.firstWord : -1}
            editing={editing === i}
            onEdit={onEdit}
            onSpeaker={onSpeaker}
            onSave={saveEdit}
            onCancel={cancelEdit}
          />
        ))}
        {!transcript.diarized && transcript.speakers.length === 1 && (
          <p className="text-xs text-faint">
            This transcript is not split by speaker. Select some text and choose Split turn, then set who said it from the label.
          </p>
        )}
      </div>

      {selection && (
        <div
          role="toolbar"
          aria-label="Selection"
          style={{ left: selection.x, top: selection.y }}
          className="fixed z-20 flex -translate-x-1/2 -translate-y-[calc(100%+8px)] items-center gap-1 rounded-full bg-surface p-1 shadow-pop"
        >
          <Button
            size="sm"
            variant="primary"
            icon={<Scissors />}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const clip = clipFromSelection(selStart, selEnd);
              if (clip) onClipCreated(clip.id);
              window.getSelection()?.removeAllRanges();
              setSelection(null);
            }}
          >
            Clip <span className="mono">{fmtDuration(Math.max(1, selEnd - selStart))}</span>
          </Button>
          <IconButton
            size="sm"
            label="Play selection"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => player.playRange(selStart, selEnd)}
          >
            <Play weight="fill" />
          </IconButton>
          {selection.first - offsets[words[selection.first].seg] > 0 && (
            <IconButton
              size="sm"
              label="Split turn here"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                splitTurn(selection.first);
                window.getSelection()?.removeAllRanges();
                setSelection(null);
              }}
            >
              <SplitVertical />
            </IconButton>
          )}
        </div>
      )}

      <Popover anchor={speakerMenu?.anchor ?? null} open={!!speakerMenu} onClose={() => setSpeakerMenu(null)}>
        {speakerMenu && (
          <Menu
            onClose={() => setSpeakerMenu(null)}
            items={[
              ...transcript.speakers.map((sp) => ({
                label: sp.name,
                icon: transcript.segments[speakerMenu.seg]?.speaker === sp.id ? <Check /> : <span className="w-4" />,
                onSelect: () => assignSpeaker(speakerMenu.seg, sp.id),
              })),
              "divider" as const,
              {
                label: "New speaker",
                icon: <Plus />,
                onSelect: () => {
                  const n = transcript.speakers.length;
                  const used = new Set(transcript.speakers.map((s) => s.id));
                  let k = n;
                  while (used.has(`S${k}`)) k++;
                  assignSpeaker(speakerMenu.seg, `S${k}`, `Speaker ${n + 1}`);
                },
              },
              { label: "Rename speakers", icon: <PencilSimple />, onSelect: () => setSpeakersOpen(true) },
            ]}
          />
        )}
      </Popover>

      <Popover anchor={speakersAnchor} open={speakersOpen} onClose={() => setSpeakersOpen(false)} align="end" width={300}>
        <div className="flex flex-col gap-2 p-2.5">
          <div>
            <strong>Speakers</strong>
            <p className="text-xs text-faint">Names appear in the transcript, in exports and in suggested moments.</p>
          </div>
          {transcript.speakers.map((sp) => (
            <SpeakerNameRow key={sp.id} id={sp.id} name={sp.name} talk={talk.get(sp.id) ?? 0} onRename={renameSpeaker} />
          ))}
        </div>
      </Popover>
    </>
  );
}

function SpeakerNameRow({
  id,
  name,
  talk,
  onRename,
}: {
  id: string;
  name: string;
  talk: number;
  onRename: (id: string, name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) onRename(id, v);
    else setDraft(name);
  };
  return (
    <div className="flex items-center gap-2">
      <TextInput
        aria-label={`Rename ${name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        className="flex-1"
      />
      <span className="mono shrink-0 text-xs text-faint">{fmtDuration(talk)}</span>
    </div>
  );
}

const SegmentView = memo(function SegmentView({
  seg,
  index,
  offset,
  speakerName,
  marks,
  currentHitFirst,
  editing,
  onEdit,
  onSpeaker,
  onSave,
  onCancel,
}: {
  seg: Segment;
  index: number;
  offset: number;
  speakerName: string;
  marks?: Set<number>;
  currentHitFirst: number;
  editing: boolean;
  onEdit: (i: number) => void;
  onSpeaker: (i: number, anchor: HTMLElement) => void;
  onSave: (i: number, text: string) => void;
  onCancel: () => void;
}) {
  return (
    <div data-seg={index} className="tw-seg grid grid-cols-[84px_minmax(0,1fr)] gap-3 sm:grid-cols-[104px_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col items-start gap-0.5 pt-px">
        <button
          type="button"
          title="Change speaker"
          onClick={(e) => onSpeaker(index, e.currentTarget)}
          className="tw-speaker max-w-full truncate rounded-md px-1 text-[12.5px] font-bold transition-colors hover:bg-hover"
        >
          {speakerName}
        </button>
        <button
          type="button"
          title="Jump here"
          onClick={() => player.seek(seg.start)}
          className="mono rounded-md px-1 text-[11px] text-faint transition-colors hover:bg-hover hover:text-ink"
        >
          {clock(seg.start)}
        </button>
      </div>

      {editing ? (
        <SegmentEditor initial={segmentText(seg)} onSave={(text) => onSave(index, text)} onCancel={onCancel} />
      ) : (
        <p
          data-selectable
          onDoubleClick={() => onEdit(index)}
          title="Double-click to correct"
          className="max-w-[68ch] text-[14.5px] leading-[1.65]"
        >
          {seg.words.map((w, k) => {
            const i = offset + k;
            return (
              <span
                key={i}
                data-i={i}
                className={cx(
                  "tw-word",
                  marks?.has(i) && "is-match",
                  i === currentHitFirst && "is-match-current",
                  w.confidence !== undefined && w.confidence < 0.45 && "is-unsure",
                )}
              >
                {w.text}{" "}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
});

function SegmentEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(text);
        }}
        className="min-h-[72px] w-full resize-y rounded-control border border-line-strong bg-surface px-3 py-2.5 leading-[1.55] outline-0 focus:border-accent-line focus:shadow-[0_0_0_3px_var(--accent-soft)]"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={() => onSave(text)}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="text-xs text-faint">Word timings are redistributed across the new text.</span>
      </div>
    </div>
  );
}
