import { ArrowRight, MagnifyingGlass, TextAlignLeft, UploadSimple } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import { ProjectCover } from "../components/Covers";
import { Button, EmptyState, TextInput } from "../components/ui";
import { openProject } from "../lib/actions";
import { duration, relativeDate } from "../lib/format";
import { useApp } from "../store/app";
import { chooseAndImport, rise } from "./HomeView";

const ENGINE_LABEL = { whisper: "Whisper, on this computer", deepgram: "Deepgram" } as const;

export function TranscriptsView() {
  const library = useApp((s) => s.library);
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const transcribed = useMemo(() => library.filter((m) => m.stage !== "imported"), [library]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? transcribed.filter((m) => m.name.toLowerCase().includes(q) || m.excerpt?.toLowerCase().includes(q)) : transcribed;
  }, [transcribed, query]);
  const words = transcribed.reduce((n, m) => n + m.wordCount, 0);

  return (
    <div className="page">
      <div className="page-inner reading">
        <header className="page-header">
          <div>
            <h1 className="page-title">Transcripts</h1>
            <p className="page-sub">
              {transcribed.length} {transcribed.length === 1 ? "conversation" : "conversations"}, {words.toLocaleString()} words
            </p>
          </div>
          {transcribed.length > 0 && (
            <TextInput
              icon={<MagnifyingGlass />}
              placeholder="Search names and opening lines"
              aria-label="Search transcripts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="search-input is-wide"
            />
          )}
        </header>

        {transcribed.length === 0 ? (
          <EmptyState
            icon={<TextAlignLeft />}
            title="Nothing transcribed yet"
            body="Open a project and transcribe it locally with Whisper or in the cloud with Deepgram. Transcripts collect here to read and search."
            action={
              <Button variant="primary" icon={<UploadSimple />} onClick={() => void chooseAndImport()}>
                Import recording
              </Button>
            }
          />
        ) : rows.length === 0 ? (
          <p className="muted">No transcripts match "{query}".</p>
        ) : (
          <div className="reading-list">
            {rows.map((m, i) => (
              <motion.button
                key={m.id}
                className="reading-row"
                onClick={() => void openProject(m.id, { view: "workspace" })}
                {...rise(reduce, Math.min(i, 10))}
              >
                <ProjectCover thumbnailPath={m.thumbnailPath} wave={m.wave} name={m.name} size="sm" className="reading-cover" />
                <span className="reading-body">
                  <span className="reading-title">{m.name}</span>
                  {m.excerpt && <span className="reading-excerpt">{m.excerpt}</span>}
                  <span className="reading-meta">
                    <span>{m.engine ? ENGINE_LABEL[m.engine] : "Transcript"}</span>
                    <span>
                      {m.speakerCount} {m.speakerCount === 1 ? "speaker" : "speakers"}
                    </span>
                    <span className="mono">{m.wordCount.toLocaleString()} words</span>
                    <span className="mono">{duration(m.duration)}</span>
                  </span>
                </span>
                <span className="reading-side">
                  <span className="faint">{relativeDate(m.updatedAt)}</span>
                  <ArrowRight className="reading-arrow" />
                </span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
