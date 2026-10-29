"use client";

/**
 * Ask a recording anything.
 *
 * Answers are built from the transcript itself and always point at the moment they came from — a
 * citation you can click to hear it said. Conversations are kept apart from recordings, so clearing
 * history leaves every recording where it is, and deleting a recording leaves its conversation
 * readable.
 */

import {
  ClockCounterClockwise,
  PaperPlaneRight,
  Play,
  Sparkle,
  TextAa,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectCover } from "@/components/Covers";
import { ImportButton } from "@/components/ImportButton";
import { LinkBox } from "@/components/LinkBox";
import { MediaElement } from "@/components/media";
import { Button, EmptyState, IconButton, Segmented, TextInput } from "@/components/ui";
import { Transport } from "@/components/workspace/PlayerPanel";
import { TranscribeModal } from "@/components/workspace/TranscribeModal";
import { loadProject } from "@/lib/actions";
import { serviceCan } from "@/lib/api";
import { ask, suggestedQuestions } from "@/lib/engine/ask";
import { clock, duration, relativeDate } from "@/lib/engine/format";
import type { ChatMessage, Citation } from "@/lib/engine/types";
import { cx } from "@/lib/cx";
import { player } from "@/lib/player";
import { useApp } from "@/store/app";
import { useAsk } from "@/store/ask";
import { useProject } from "@/store/project";

function CitationChip({ c }: { c: Citation }) {
  return (
    <button
      type="button"
      onClick={() => player.playRange(c.start, c.end)}
      title={c.text}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent-surface px-2 py-1 text-[11px] text-accent-text transition-colors hover:bg-accent-surface-strong [&_svg]:size-3"
    >
      <Play weight="fill" />
      <span className="mono shrink-0">{clock(c.start)}</span>
      <span className="truncate">{c.label ?? c.speaker}</span>
    </button>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const you = m.role === "you";
  return (
    <div className={cx("flex flex-col gap-1.5", you ? "items-end" : "items-start")}>
      <div
        data-selectable
        className={cx(
          "max-w-[46ch] rounded-[18px] px-3.5 py-2.5 text-[14px] leading-[1.6] whitespace-pre-wrap",
          you ? "bg-accent text-accent-ink" : "bg-sunken",
        )}
      >
        {m.pending ? <span className="text-muted">Reading the transcript…</span> : m.text}
      </div>
      {!!m.citations?.length && (
        <div className="flex max-w-[46ch] flex-wrap gap-1.5">
          {m.citations.map((c, i) => (
            <CitationChip key={i} c={c} />
          ))}
        </div>
      )}
      {m.note && <p className="max-w-[46ch] text-xs text-faint">{m.note}</p>}
    </div>
  );
}

export function AskScreen() {
  const library = useApp((s) => s.library);
  const project = useProject((s) => s.project);
  const entries = useAsk((s) => s.entries);
  const load = useAsk((s) => s.load);
  const openEntry = useAsk((s) => s.open);
  const addMessage = useAsk((s) => s.addMessage);
  const removeEntry = useAsk((s) => s.remove);
  const clearHistory = useAsk((s) => s.clear);

  const reduce = useReducedMotion();
  const [question, setQuestion] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pane, setPane] = useState<"transcript" | "summary">("transcript");
  const [showHistory, setShowHistory] = useState(false);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const entry = useMemo(() => (project ? entries.find((e) => e.projectId === project.id) : undefined), [entries, project]);
  const messages = entry?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
  }, [messages.length, thinking, reduce]);

  useEffect(() => () => player.pause(), []);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || !project?.transcript || thinking) return;
    setQuestion("");
    const live = openEntry(project, useApp.getState().library.find((m) => m.id === project.id));
    addMessage(live.id, { id: crypto.randomUUID(), role: "you", text: q, createdAt: new Date().toISOString() });
    setThinking(true);
    try {
      const result = await ask(q, {
        project: { name: project.name, source: { duration: project.source.duration }, clips: project.clips, topics: project.topics },
        transcript: project.transcript,
        intel: null,
      });
      addMessage(live.id, {
        id: crypto.randomUUID(),
        role: "app",
        text: result.text,
        createdAt: new Date().toISOString(),
        engine: result.engine,
        citations: result.citations,
        note: result.note,
      });
    } finally {
      setThinking(false);
    }
  };

  if (!library.length) {
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState
          icon={<Sparkle />}
          title="Nothing to ask yet"
          body="Import a recording and transcribe it. Then you can ask it anything and every answer points at the moment it came from."
          action={<ImportButton />}
        />
      </div>
    );
  }

  // --- Picking a recording ----------------------------------------------------------------------

  if (!project) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[23px] font-bold tracking-[-0.035em] lg:text-[28px]">Ask</h1>
            <p className="mt-1 text-sm text-muted">Paste a link or pick a recording, then ask it anything.</p>
          </div>
          {entries.length > 0 && (
            <Button icon={<ClockCounterClockwise />} onClick={() => setShowHistory((v) => !v)}>
              History <span className="mono">{entries.length}</span>
            </Button>
          )}
        </div>

        <div className="mb-6">
          <LinkBox />
        </div>

        {showHistory && entries.length > 0 && (
          <div className="mb-6 flex flex-col gap-1 rounded-panel bg-surface p-2 dark:inset-ring dark:inset-ring-line">
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-[12.5px] font-semibold text-muted">Past conversations</span>
              <Button size="sm" variant="ghost" icon={<Trash />} onClick={() => void clearHistory()}>
                Clear
              </Button>
            </div>
            {entries.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-hover">
                <button
                  type="button"
                  onClick={() => void loadProject(e.projectId)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <ProjectCover thumbnailPath={e.thumbnailPath} wave={e.wave} name={e.title} size="sm" className="size-9" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{e.title}</span>
                    <span className="block text-xs text-faint">
                      {e.messages.length} {e.messages.length === 1 ? "message" : "messages"}, {relativeDate(e.updatedAt)}
                    </span>
                  </span>
                </button>
                <IconButton size="sm" label={`Remove conversation about ${e.title}`} onClick={() => void removeEntry(e.id)}>
                  <X />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {library.map((m) => (
            <button key={m.id} type="button" onClick={() => void loadProject(m.id)} className="group flex min-w-0 flex-col gap-2 text-left">
              <ProjectCover
                thumbnailPath={m.thumbnailPath}
                wave={m.wave}
                name={m.name}
                size="lg"
                className="aspect-video w-full transition-transform group-hover:-translate-y-0.5"
              />
              <span className="truncate font-semibold">{m.name}</span>
              <span className="flex items-center justify-between gap-2 text-xs">
                <span className="mono text-faint">{duration(m.duration)}</span>
                <span className={m.stage === "imported" ? "text-muted" : "text-accent-text"}>
                  {m.stage === "imported" ? "Needs a transcript" : "Ready to ask"}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- The conversation --------------------------------------------------------------------------

  const starters = suggestedQuestions(project);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 lg:px-5 lg:py-3.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="truncate text-[17px] font-bold tracking-[-0.03em] lg:text-xl">{project.name}</h1>
          <span className="mono text-xs text-faint">{duration(project.source.duration)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" icon={<UploadSimple />} onClick={() => void useProject.getState().close()}>
            Change
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 px-3 pb-3 lg:grid-cols-[minmax(360px,1fr)_minmax(320px,440px)] lg:px-5 lg:pb-5">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] bg-surface dark:inset-ring dark:inset-ring-line">
          {messages.length === 0 && !thinking ? (
            <div className="grid flex-1 place-items-center">
              <EmptyState
                icon={<Sparkle />}
                title={project.transcript ? "Ask this recording anything" : "Transcribe it first"}
                body={
                  project.transcript
                    ? "Answers are built from the transcript itself and always point at the moment they came from."
                    : serviceCan.transcribe
                      ? "This recording has no transcript yet. Make one here and the answers follow."
                      : "This browser cannot run transcription, so there is nothing to ask about yet."
                }
                action={
                  project.transcript ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {starters.map((q) => (
                        <Button key={q} size="sm" onClick={() => void send(q)}>
                          {q}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Button variant="primary" icon={<TextAa />} onClick={() => setTranscribeOpen(true)}>
                      Transcribe
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={reduce ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                  >
                    <Bubble m={m} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {thinking && (
                <Bubble
                  m={{ id: "pending", role: "app", text: "", createdAt: new Date().toISOString(), pending: true }}
                />
              )}
              <div ref={endRef} />
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(question);
            }}
            className="flex flex-none items-center gap-2 border-t border-line p-3"
          >
            <TextInput
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={project.transcript ? "Ask about this recording" : "Transcribe it first"}
              aria-label="Your question"
              disabled={!project.transcript || thinking}
              className="flex-1"
            />
            <Button type="submit" variant="primary" icon={<PaperPlaneRight />} disabled={!question.trim() || thinking}>
              Ask
            </Button>
          </form>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] bg-surface dark:inset-ring dark:inset-ring-line">
          <div className="flex flex-none items-center justify-between gap-2 border-b border-line p-3">
            <Segmented
              label="Pane"
              size="sm"
              value={pane}
              onChange={setPane}
              options={[
                { value: "transcript", label: "Transcript" },
                { value: "summary", label: "Player" },
              ]}
            />
          </div>

          {pane === "summary" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3.5">
              <MediaElement className="min-h-[160px] flex-1" />
              <div className="flex justify-center">
                <Transport />
              </div>
            </div>
          ) : project.transcript ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto p-3.5">
              {project.transcript.segments.map((s) => {
                const name = project.transcript!.speakers.find((sp) => sp.id === s.speaker)?.name ?? s.speaker;
                return (
                  <div key={s.id} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                    <button
                      type="button"
                      onClick={() => player.seek(s.start)}
                      className="flex flex-col items-start gap-0.5 text-left"
                      title="Jump here"
                    >
                      <span className="truncate text-[12.5px] font-bold">{name}</span>
                      <span className="mono text-[11px] text-faint">{clock(s.start)}</span>
                    </button>
                    <p data-selectable className="text-[13.5px] leading-[1.6]">
                      {s.words.map((w) => w.text).join(" ")}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={<TextAa />} title="No transcript" body="Transcribe this recording to read along." />
            </div>
          )}
        </section>
      </div>

      <TranscribeModal open={transcribeOpen} onClose={() => setTranscribeOpen(false)} />
    </div>
  );
}
