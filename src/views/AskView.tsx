import {
  ArrowRight,
  ArrowSquareOut,
  ClockCounterClockwise,
  LinkSimple,
  PaperPlaneRight,
  Play,
  SlidersHorizontal,
  Sparkle,
  TextAa,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectCover } from "../components/Covers";
import { JobCard } from "../components/JobCard";
import { MediaElement } from "../components/media";
import { Button, EmptyState, IconButton, Popover, Progress, Segmented, TextInput } from "../components/ui";
import { ask, suggestedQuestions, type AskResult } from "../lib/ask";
import { findMoments as findMomentsFor, importLink, loadProjectQuietly, openProject } from "../lib/actions";
import { clock, duration, relativeDate } from "../lib/format";
import { errorMessage, ipc } from "../lib/ipc";
import { player, usePlayerTime } from "../lib/player";
import { segmentText } from "../lib/transcript";
import type { AskEntry, ChatMessage, Citation, LinkInfo, ProjectMeta } from "../lib/types";
import { reportError, useApp } from "../store/app";
import { useAsk } from "../store/ask";
import { useProject } from "../store/project";
import { Transport } from "./workspace/PlayerPanel";
import { TranscribeModal } from "./workspace/TranscribeModal";

const SUPPORTED = "X and Twitter videos, YouTube, Vimeo, SoundCloud, podcast episodes and feeds, or a direct link to an audio or video file.";

/** Paste box: probes the link first so you see what was found before anything downloads. */
function LinkBox({ autoFocus = false, onImported }: { autoFocus?: boolean; onImported?: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [found, setFound] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ytdlp = useApp((s) => s.sidecars?.ytdlp);
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "import"));
  const fetching = !!job;

  const probe = async () => {
    const value = url.trim();
    if (!value) return;
    setProbing(true);
    setError(null);
    setFound(null);
    try {
      setFound(await ipc.probeLink(value));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setProbing(false);
    }
  };

  const start = async (info: LinkInfo | null) => {
    const target = url.trim();
    setError(null);
    const result = await importLink(target, info);
    if (result.ok) {
      setUrl("");
      setFound(null);
      useApp.getState().setView("ask");
      onImported?.(result.id);
      return;
    }
    // Keep the link in the box so the failure can be read and the attempt repeated.
    setError(result.cancelled ? "Download stopped." : result.error);
  };

  return (
    <div className="linkbox">
      <form
        className="linkbox-row"
        onSubmit={(e) => {
          e.preventDefault();
          void (found ? start(found) : probe());
        }}
      >
        <TextInput
          icon={<LinkSimple />}
          autoFocus={autoFocus}
          placeholder="Paste a link to a video, episode or Space"
          aria-label="Link to transcribe"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setFound(null);
            setError(null);
          }}
        />
        <Button type="submit" variant="primary" disabled={!url.trim() || probing || fetching}>
          {probing ? "Reading" : found ? "Get transcript" : "Check link"}
        </Button>
      </form>

      {job && <JobCard job={job} title={job.label === "Importing" ? "Reading media" : `Downloading ${job.label}`} />}

      {error && (
        <div className="linkbox-error" role="alert">
          <WarningCircle />
          <div>
            <p>{error}</p>
            {!!url.trim() && (
              <button className="link-btn" onClick={() => void (found ? start(found) : probe())}>
                Try again
              </button>
            )}
          </div>
        </div>
      )}
      {!error && !ytdlp && (
        <p className="faint linkbox-note">
          Podcast and direct media links work in this build. For X, YouTube and other sites, run <code>pnpm sidecars yt-dlp</code> and restart.
        </p>
      )}

      <AnimatePresence>
        {found && (
          <motion.div
            className="link-found"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <div className="link-found-text">
              <strong className="truncate">{found.title}</strong>
              <span className="faint">
                {found.site}
                {found.uploader ? `, ${found.uploader}` : ""}
                {found.duration ? `, ${duration(found.duration)}` : ""}
                {found.resolver === "feed" ? ", newest episode" : ""}
              </span>
            </div>
            <span className="link-found-hint faint">
              Found it. <ArrowRight /> Get transcript
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <ol className="cites">
      {citations.map((c, i) => (
        <li key={i}>
          <button className="cite-time mono" onClick={() => player.playRange(c.start, c.end)} title="Play this part">
            <Play weight="fill" /> {clock(c.start)}
          </button>
          <div className="cite-body">
            {c.label && <strong className="cite-label">{c.label}</strong>}
            {c.text && (
              <p className="cite-text">
                {c.speaker && <span className="cite-speaker">{c.speaker}: </span>}
                {c.text}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Thread({ messages, thinking }: { messages: ChatMessage[]; thinking: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [messages.length, thinking, reduce]);

  return (
    <div className="thread">
      {messages.map((m) =>
        m.role === "you" ? (
          <motion.div key={m.id} className="bubble" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            {m.text}
          </motion.div>
        ) : (
          <motion.div key={m.id} className="answer" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <p className="answer-lead">{m.text}</p>
            <CitationList citations={m.citations ?? []} />
            {m.note && <p className="answer-note faint">{m.note}</p>}
          </motion.div>
        ),
      )}
      {thinking && (
        <div className="answer is-thinking">
          <span className="faint">Reading the transcript</span>
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

/** Read-only transcript beside the chat: click any line to play from there. */
function AskTranscript({ onTranscribe }: { onTranscribe: () => void }) {
  const project = useProject((s) => s.project)!;
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.projectId === project.id && j.kind === "transcribe"));
  const bodyRef = useRef<HTMLDivElement>(null);
  const current = useRef(-1);

  usePlayerTime((t) => {
    const segments = project.transcript?.segments ?? [];
    let i = -1;
    for (let k = 0; k < segments.length; k++) if (segments[k].start <= t) i = k;
    if (i === current.current) return;
    const root = bodyRef.current;
    if (!root) return;
    root.querySelector(".ask-line.is-current")?.classList.remove("is-current");
    root.querySelector(`[data-line="${i}"]`)?.classList.add("is-current");
    current.current = i;
  }, [project.transcript]);

  if (job) {
    // The chat column carries the full card with its cancel; here a line is enough.
    return (
      <div className="ask-pane-empty">
        <div className="ask-progress">
          <Progress value={job.progress} label={job.label} />
          <span className="faint">
            {job.stage}
            {job.progress !== null ? `, ${Math.round(job.progress * 100)}%` : ""}
          </span>
        </div>
        <p className="faint ask-wait">The transcript appears here as soon as it is ready. You can leave this tab; the work keeps running.</p>
      </div>
    );
  }

  if (!project.transcript) {
    return (
      <div className="ask-pane-empty">
        <EmptyState
          icon={<TextAa />}
          title="No transcript yet"
          body="Transcribe this recording to read it here and ask questions about it."
          action={
            <Button variant="primary" icon={<TextAa />} onClick={onTranscribe}>
              Transcribe
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="ask-lines" ref={bodyRef}>
      {project.transcript.segments.map((seg, i) => (
        <button key={seg.id} data-line={i} className="ask-line" onClick={() => player.seek(seg.start)}>
          <span className="ask-line-head">
            <span className="ask-line-speaker">{project.transcript!.speakers.find((s) => s.id === seg.speaker)?.name ?? seg.speaker}</span>
            <span className="mono faint">{clock(seg.start)}</span>
          </span>
          <span className="ask-line-text">{segmentText(seg)}</span>
        </button>
      ))}
    </div>
  );
}

function AskSummary() {
  const project = useProject((s) => s.project)!;
  const words = project.transcript?.segments.reduce((n, s) => n + s.words.length, 0) ?? 0;
  return (
    <div className="ask-summary">
      <dl className="ask-facts">
        <dt>Length</dt>
        <dd className="mono">{duration(project.source.duration)}</dd>
        <dt>Words</dt>
        <dd className="mono">{words.toLocaleString()}</dd>
        <dt>Voices</dt>
        <dd>{project.transcript?.speakers.length ?? 0}</dd>
        {project.link && (
          <>
            <dt>From</dt>
            <dd className="truncate">{project.link.site}</dd>
          </>
        )}
      </dl>

      {project.topics.length > 0 ? (
        <div className="ask-topics">
          <h3>Topics</h3>
          {project.topics.map((t) => (
            <button key={t.id} className="ask-topic" onClick={() => player.seek(t.ranges[0]?.start ?? 0)}>
              <span className="ask-topic-row">
                <strong>{t.name}</strong>
                <span className="mono faint">{clock(t.ranges[0]?.start ?? 0)}</span>
              </span>
              <span className="faint">{t.summary}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="faint">
          Open this recording and run <strong>Find moments</strong> for topics and a proper read of the conversation.
        </p>
      )}

      {project.clips.length > 0 && (
        <div className="ask-topics">
          <h3>Moments</h3>
          {project.clips
            .filter((c) => c.status !== "rejected")
            .slice(0, 5)
            .map((c) => (
              <button key={c.id} className="ask-topic" onClick={() => player.playRange(c.start, c.end)}>
                <span className="ask-topic-row">
                  <strong>{c.title}</strong>
                  <span className="mono faint">{clock(c.start)}</span>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** Conversations, newest first. These belong to Ask, not to the recordings they are about. */
function HistoryList({
  entries,
  liveIds,
  currentId,
  onPick,
}: {
  entries: AskEntry[];
  liveIds: Set<string>;
  currentId?: string | null;
  onPick: (entry: AskEntry) => void;
}) {
  const remove = useAsk((s) => s.remove);
  if (!entries.length) return <p className="faint">No conversations yet. Paste a link, or pick a recording below.</p>;
  return (
    <div className="ask-picker-list">
      {entries.map((e) => {
        const gone = !liveIds.has(e.projectId);
        return (
          <div key={e.id} className={`ask-pick-wrap ${e.id === currentId ? "is-current" : ""} ${gone ? "is-gone" : ""}`}>
            <button className="ask-pick" onClick={() => onPick(e)} aria-current={e.id === currentId ? "true" : undefined}>
              <ProjectCover thumbnailPath={gone ? null : e.thumbnailPath} wave={e.wave} name={e.title} size="sm" className="ask-pick-cover" />
              <span className="ask-pick-text">
                <span className="truncate">{e.title}</span>
                <span className="faint truncate">
                  {gone ? (
                    "Recording deleted"
                  ) : (
                    <>
                      {e.site ? `${e.site}, ` : ""}
                      {duration(e.duration)}
                    </>
                  )}
                  , {e.messages.length === 1 ? "1 message" : `${e.messages.length} messages`}, {relativeDate(e.updatedAt)}
                </span>
              </span>
            </button>
            <IconButton size="sm" label={`Remove conversation about ${e.title}`} onClick={() => void remove(e.id)}>
              <Trash />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}

/** Recordings you have but have not asked about: how a conversation starts without a new link. */
function RecordingPicker({ items, onPick, title }: { items: ProjectMeta[]; onPick: (id: string) => void; title?: string | null }) {
  if (!items.length) return null;
  return (
    <section className="ask-picker">
      {title !== null && <h2 className="section-title">{title ?? "Or ask a recording you already have"}</h2>}
      <div className="ask-picker-list">
        {items.slice(0, 6).map((m) => (
          <button key={m.id} className="ask-pick" onClick={() => onPick(m.id)}>
            <ProjectCover thumbnailPath={m.thumbnailPath} wave={m.wave} name={m.name} size="sm" className="ask-pick-cover" />
            <span className="ask-pick-text">
              <span className="truncate">{m.name}</span>
              <span className="faint truncate">
                {m.link ? `${m.link.site}, ` : ""}
                {duration(m.duration)}, {relativeDate(m.updatedAt)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function AskView() {
  const project = useProject((s) => s.project);
  const library = useApp((s) => s.library);
  const [pane, setPane] = useState<"transcript" | "summary">("transcript");
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [historyAnchor, setHistoryAnchor] = useState<HTMLButtonElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const entries = useAsk((s) => s.entries);
  const loadHistory = useAsk((s) => s.load);
  const clearHistory = useAsk((s) => s.clear);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Conversations saved into project.json before history existed are adopted on first sight.
  useEffect(() => {
    const p = project;
    if (!p?.chat?.length) return;
    const store = useAsk.getState();
    if (!store.entryFor(p.id)) store.open(p, library.find((m) => m.id === p.id));
  }, [project, library]);

  // Recordings still on disk, so a conversation about a deleted one can say so.
  const liveIds = useMemo(() => new Set(library.map((m) => m.id)), [library]);
  const entry = useMemo(() => entries.find((e) => e.projectId === project?.id), [entries, project?.id]);
  const messages = entry?.messages ?? [];
  const asked = useMemo(() => new Set(entries.map((e) => e.projectId)), [entries]);
  const unasked = useMemo(() => library.filter((m) => !asked.has(m.id)), [library, asked]);

  /** A new recording takes over the tab: the previous conversation goes back to history. */
  const reset = () => {
    setDraft("");
    setPane("transcript");
    setShowLink(false);
    setHistoryOpen(false);
  };

  const switchTo = async (projectId: string) => {
    setHistoryOpen(false);
    if (projectId === useProject.getState().project?.id) return;
    reset();
    await loadProjectQuietly(projectId);
    useApp.getState().setView("ask");
  };

  const openEntry = (e: AskEntry) => {
    if (!liveIds.has(e.projectId)) {
      useApp.getState().toast({
        tone: "neutral",
        title: "That recording was deleted",
        body: "The conversation is still here to read, but there is nothing left to ask.",
      });
      return;
    }
    void switchTo(e.projectId);
  };
  // Anything running against this recording: transcription, the moment finder, a preview copy.
  const job = useApp((s) =>
    Object.values(s.jobs).find((j) => j.projectId === project?.id && (j.kind === "transcribe" || j.kind === "analyze" || j.kind === "proxy")),
  );

  const send = async (question: string) => {
    const current = useProject.getState().project;
    if (!current?.transcript || !question.trim() || thinking) return;
    const ask0 = useAsk.getState();
    const thread = ask0.entryFor(current.id) ?? ask0.open(current, useApp.getState().library.find((m) => m.id === current.id));
    ask0.addMessage(thread.id, { id: crypto.randomUUID(), role: "you", text: question.trim(), createdAt: new Date().toISOString() });
    setDraft("");
    setThinking(true);
    try {
      const result: AskResult = await ask(question, { project: current, transcript: current.transcript, intel: null });
      useAsk.getState().addMessage(thread.id, {
        id: crypto.randomUUID(),
        role: "app",
        text: result.text,
        createdAt: new Date().toISOString(),
        engine: result.engine,
        citations: result.citations,
        note: result.note,
      });
    } catch (err) {
      reportError("Could not answer that", err);
    } finally {
      setThinking(false);
    }
  };

  // Nothing open: the tab is the link box.
  if (!project) {
    return (
      <div className="page">
        <div className="page-inner">
          <header className="page-header">
            <div>
              <h1 className="page-title">Ask</h1>
              <p className="page-sub">Drop a link, read what was said, then ask it questions.</p>
            </div>
          </header>
          <div className="ask-start">
            <LinkBox
              autoFocus
              onImported={() => {
                reset();
                setTranscribeOpen(true);
              }}
            />
            <p className="faint ask-supported">{SUPPORTED}</p>
          </div>
          <section className="ask-picker">
            <div className="history-head">
              <h2 className="section-title">History</h2>
              {entries.length > 0 && (
                <button className="link-btn" onClick={() => void clearHistory()}>
                  Clear history
                </button>
              )}
            </div>
            <HistoryList entries={entries} liveIds={liveIds} onPick={openEntry} />
          </section>
          <RecordingPicker items={unasked} onPick={(id) => void switchTo(id)} />
        </div>
      </div>
    );
  }

  const starters = suggestedQuestions(project);

  return (
    <div className="ask">
      <header className="ask-header">
        <div className="ask-title">
          <h1 className="truncate">{project.name}</h1>
          <span className="ask-meta faint">
            {project.link && (
              <>
                <span>{project.link.site}</span>
                <button className="link-btn" onClick={() => void ipc.openUrl(project.link!.pageUrl)}>
                  Open original <ArrowSquareOut />
                </button>
              </>
            )}
            <span className="mono">{duration(project.source.duration)}</span>
          </span>
        </div>
        <div className="ask-actions">
          <Button ref={setHistoryAnchor} icon={<ClockCounterClockwise />} onClick={() => setHistoryOpen((v) => !v)}>
            History
            {entries.length > 0 ? <span className="count mono">{entries.length}</span> : null}
          </Button>
          <Popover anchor={historyAnchor} open={historyOpen} onClose={() => setHistoryOpen(false)} align="end" width={380}>
            <div className="history-pop">
              <div className="history-head">
                <h3 className="section-title">Conversations</h3>
                {entries.length > 0 && (
                  <button className="link-btn" onClick={() => void clearHistory()}>
                    Clear
                  </button>
                )}
              </div>
              <HistoryList entries={entries} liveIds={liveIds} currentId={entry?.id} onPick={openEntry} />
              {unasked.length > 0 && (
                <>
                  <h3 className="section-title history-sub">Not asked yet</h3>
                  <RecordingPicker items={unasked} onPick={(id) => void switchTo(id)} title={null} />
                </>
              )}
            </div>
          </Popover>
          <Button icon={<LinkSimple />} onClick={() => setShowLink((v) => !v)}>
            New link
          </Button>
          <Button icon={<SlidersHorizontal />} onClick={() => openProject(project.id)}>
            Open workspace
          </Button>
        </div>
      </header>

      {showLink && (
        <div className="ask-linkbar">
          <LinkBox
            autoFocus
            onImported={() => {
              reset();
              setTranscribeOpen(true);
            }}
          />
          <IconButton label="Close" size="sm" onClick={() => setShowLink(false)}>
            <X />
          </IconButton>
        </div>
      )}

      <div className="ask-body">
        <section className="ask-chat">
          {job && messages.length === 0 ? (
            <div className="ask-chat-empty">
              <JobCard job={job} />
              <p className="faint">
                {job.kind === "transcribe"
                  ? "Transcribing runs on this computer. Long recordings take a few minutes, and you can keep working in other tabs."
                  : "Reading the conversation for the moments worth publishing."}
              </p>
            </div>
          ) : messages.length === 0 && !thinking ? (
            <div className="ask-chat-empty">
              <EmptyState
                icon={<Sparkle />}
                title={project.transcript ? "Ask this recording anything" : "Transcribe it first"}
                body={
                  project.transcript
                    ? "Answers are built from the transcript on this computer and always point at the moment they came from."
                    : "This recording has no transcript yet. Make one here and the answers follow."
                }
                action={
                  project.transcript ? undefined : (
                    <Button variant="primary" icon={<TextAa />} onClick={() => setTranscribeOpen(true)}>
                      Transcribe
                    </Button>
                  )
                }
              />
              {project.transcript && (
                <div className="starters">
                  {starters.map((s) => (
                    <button key={s} className="starter" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Thread messages={messages} thinking={thinking} />
          )}

          {job && messages.length > 0 && (
            <div className="ask-chat-job">
              <JobCard job={job} />
            </div>
          )}

          <form
            className="ask-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <input
              className="ask-field"
              placeholder={project.transcript ? "Ask about this recording" : "Transcribe this recording to ask questions"}
              aria-label="Ask about this recording"
              disabled={!project.transcript || thinking}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <IconButton label="Ask" disabled={!draft.trim() || thinking} onClick={() => void send(draft)}>
              <PaperPlaneRight weight="fill" />
            </IconButton>
          </form>
        </section>

        <aside className="ask-pane">
          <div className="ask-stage">
            <MediaElement className="media-contain" />
          </div>
          <Transport />
          <Segmented<"transcript" | "summary">
            label="Recording panel"
            size="sm"
            value={pane}
            onChange={setPane}
            options={[
              { value: "transcript", label: "Transcript" },
              { value: "summary", label: "Summary" },
            ]}
          />
          <div className="ask-pane-body">
            {pane === "transcript" ? <AskTranscript onTranscribe={() => setTranscribeOpen(true)} /> : <AskSummary />}
          </div>
        </aside>
      </div>

      {transcribeOpen && (
        <TranscribeModal
          open
          onClose={() => setTranscribeOpen(false)}
          // Moments make the "top three" answer instant, so run them straight after.
          onDone={() => void findMomentsFor("initial")}
        />
      )}
    </div>
  );
}
