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
import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, IconButton, Menu, Popover, Progress, TextInput } from "../../components/ui";
import { clipFromSelection } from "../../lib/actions";
import { clock, duration as fmtDuration } from "@be-voiced/engine/format";
import { player, usePlayerTime } from "../../lib/player";
import {
  flattenWords,
  mergeAdjacent,
  realignSegment,
  searchTranscript,
  segmentText,
  speakerTalkTime,
  wordAt,
} from "@be-voiced/engine/transcript";
import type { Segment, Topic, Transcript } from "@be-voiced/engine/types";
import { useApp } from "../../store/app";
import { useProject } from "../../store/project";

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
    <section className="ws-transcript" aria-label="Transcript">
      {job ? (
        <div className="transcribing">
          <div className="transcribing-status">
            <div className="transcribing-head">
              <div>
                <div className="strong">{job.label}</div>
                <div className="faint">
                  {job.stage}
                  {job.detail ? `, ${job.detail}` : ""}
                </div>
              </div>
              <span className="mono muted">{job.progress !== null ? `${Math.round(job.progress * 100)}%` : ""}</span>
            </div>
            <Progress value={job.progress} label="Transcription progress" />
            <Button size="sm" variant="ghost" onClick={() => cancel(job.id)}>
              Cancel
            </Button>
          </div>
          <div className="transcript-skeleton" aria-hidden="true">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="skeleton-seg">
                <div className="skeleton" style={{ width: 64, height: 10 }} />
                <div className="skeleton-lines">
                  <div className="skeleton" style={{ width: "96%", height: 10 }} />
                  <div className="skeleton" style={{ width: `${60 + ((i * 17) % 35)}%`, height: 10 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : project.transcript ? (
        <TranscriptBody transcript={project.transcript} topic={topic} onClearTopic={onClearTopic} onClipCreated={onClipCreated} />
      ) : (
        <div className="panel-empty">
          <EmptyState
            icon={<TextAa />}
            title="No transcript yet"
            body="Transcribe locally with Whisper to keep audio on this computer, or use Deepgram for speaker labels."
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

  // Marks per segment for search results.
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

  // --- Playback sync, straight to the DOM ---------------------------------------------------
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
    // React may have replaced classNames; re-apply the playback highlight after renders that touch spans.
    bodyRef.current?.querySelectorAll(".is-now, .is-current").forEach((el) => el.classList.remove("is-now", "is-current"));
    active.current = { word: -1, seg: -1 };
    syncActive(player.time);
  }, [marks, editing, visible, currentHit, syncActive]);

  useEffect(() => {
    if (!currentHit) return;
    lastUserScroll.current = Date.now();
    bodyRef.current?.querySelector(`[data-i="${currentHit.firstWord}"]`)?.scrollIntoView({ block: "center" });
  }, [currentHit]);

  // --- Mutations ----------------------------------------------------------------------------
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
      const b: Segment = { ...s, id: `${s.id}-${crypto.randomUUID().slice(0, 6)}`, words: s.words.slice(local), start: s.words[local].start };
      return { ...t, segments: [...segs.slice(0, w.seg), a, b, ...segs.slice(w.seg + 1)] };
    });
  };

  const renameSpeaker = (id: string, name: string) =>
    update(
      (p) => (p.transcript ? { ...p, transcript: { ...p.transcript, speakers: p.transcript.speakers.map((s) => (s.id === id ? { ...s, name } : s)) } } : p),
      { coalesce: `speaker-${id}` },
    );

  // --- Selection -> clip --------------------------------------------------------------------
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

  const onBodyClick = (e: React.MouseEvent) => {
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
      <div className="transcript-toolbar">
        <TextInput
          icon={<MagnifyingGlass />}
          placeholder="Search transcript"
          aria-label="Search transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length) setHitIndex((i) => (e.shiftKey ? (i - 1 + hits.length) % hits.length : (i + 1) % hits.length));
            if (e.key === "Escape") setQuery("");
          }}
          className="transcript-search"
        />
        {query && (
          <span className="search-count mono faint">
            {hits.length ? `${hitIndex + 1}/${hits.length}` : "0"}
          </span>
        )}
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
        <span className="toolbar-spacer" />
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
          {transcript.speakers.length} {transcript.speakers.length === 1 ? "speaker" : "speakers"}
        </Button>
      </div>

      {topic && (
        <div className="topic-banner">
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
        className="transcript-body"
        onWheel={() => (lastUserScroll.current = Date.now())}
        onMouseUp={onMouseUp}
        onClick={onBodyClick}
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
          <p className="transcript-note faint">
            Local transcripts are not split by speaker. Select text and choose Split turn, then set the speaker from its label.
          </p>
        )}
      </div>

      {selection && (
        <div className="selection-bar" style={{ left: selection.x, top: selection.y }} role="toolbar" aria-label="Selection">
          <Button
            size="sm"
            variant="primary"
            icon={<Scissors />}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const clip = clipFromSelection(selStart, selEnd, true);
              window.getSelection()?.removeAllRanges();
              setSelection(null);
              if (clip) {
                onClipCreated(clip.id);
                useApp.getState().toast({ tone: "success", title: "Clip saved", body: `${clip.title} (${fmtDuration(clip.end - clip.start)})` });
              }
            }}
          >
            Create clip <span className="mono">{fmtDuration(Math.max(1, selEnd - selStart))}</span>
          </Button>
          <IconButton size="sm" label="Play selection" onMouseDown={(e) => e.preventDefault()} onClick={() => player.playRange(selStart, selEnd)}>
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
                icon: transcript.segments[speakerMenu.seg]?.speaker === sp.id ? <Check /> : <span style={{ width: 16 }} />,
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
        <div className="speakers-pop">
          <div className="speakers-pop-head">
            <strong>Speakers</strong>
            <span className="faint">Names appear in the transcript, exports and suggested moments.</span>
          </div>
          {transcript.speakers.map((sp) => (
            <SpeakerNameRow key={sp.id} id={sp.id} name={sp.name} talk={talk.get(sp.id) ?? 0} onRename={renameSpeaker} />
          ))}
        </div>
      </Popover>
    </>
  );
}

function SpeakerNameRow({ id, name, talk, onRename }: { id: string; name: string; talk: number; onRename: (id: string, name: string) => void }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) onRename(id, v);
    else setDraft(name);
  };
  return (
    <div className="speaker-row">
      <TextInput aria-label={`Rename ${name}`} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
      <span className="mono faint">{fmtDuration(talk)}</span>
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
    <div className={`seg ${editing ? "is-editing" : ""}`} data-seg={index}>
      <div className="seg-gutter">
        <button className="seg-speaker truncate" onClick={(e) => onSpeaker(index, e.currentTarget)} title="Change speaker">
          {speakerName}
        </button>
        <button className="seg-time mono" onClick={() => player.seek(seg.start)} title="Jump here">
          {clock(seg.start)}
        </button>
      </div>
      {editing ? (
        <SegmentEditor initial={segmentText(seg)} onSave={(text) => onSave(index, text)} onCancel={onCancel} />
      ) : (
        <p className="seg-text" data-selectable>
          {seg.words.map((w, k) => {
            const i = offset + k;
            const cls = [
              marks?.has(i) ? "is-match" : "",
              i === currentHitFirst ? "is-match-current" : "",
              w.confidence !== undefined && w.confidence < 0.45 ? "is-unsure" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <Fragment key={k}>
                {k > 0 && " "}
                <span data-i={i} className={cls || undefined}>
                  {w.text}
                </span>
              </Fragment>
            );
          })}
        </p>
      )}
      {!editing && (
        <div className="seg-tools">
          <IconButton size="sm" label="Edit text" onClick={() => onEdit(index)}>
            <PencilSimple />
          </IconButton>
        </div>
      )}
    </div>
  );
});

function SegmentEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [text]);
  return (
    <div className="seg-editor">
      <textarea
        ref={ref}
        className="textarea"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSave(text);
        }}
      />
      <div className="seg-editor-actions">
        <span className="faint">Word timings are kept for unchanged words.</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => onSave(text)}>
          Save
        </Button>
      </div>
    </div>
  );
}

