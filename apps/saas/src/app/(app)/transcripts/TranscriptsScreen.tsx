"use client";

/**
 * Every transcribed conversation, as a reading list: the opening lines, who is in it, how long.
 */

import { ArrowRight, MagnifyingGlass, TextAlignLeft } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProjectCover } from "@/components/Covers";
import { ImportButton } from "@/components/ImportButton";
import { Page, PageHeader } from "@/components/Page";
import { EmptyState, TextInput } from "@/components/ui";
import { duration, relativeDate } from "@/lib/engine/format";
import { rise } from "@/lib/library";
import { useApp } from "@/store/app";

export function TranscriptsScreen() {
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
    <Page>
      <PageHeader
        title="Transcripts"
        sub={
          <>
            {transcribed.length} {transcribed.length === 1 ? "conversation" : "conversations"}, {words.toLocaleString()} words
          </>
        }
        tools={
          transcribed.length > 0 ? (
            <TextInput
              icon={<MagnifyingGlass />}
              placeholder="Search names and opening lines"
              aria-label="Search transcripts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full sm:w-72"
            />
          ) : undefined
        }
      />

      {transcribed.length === 0 ? (
        <EmptyState
          icon={<TextAlignLeft />}
          title="Nothing transcribed yet"
          body="Open a recording and transcribe it. Transcripts collect here to read, search and export."
          action={<ImportButton />}
        />
      ) : rows.length === 0 ? (
        <p className="text-muted">No transcripts match “{query}”.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line">
          {rows.map((m, i) => (
            <motion.div key={m.id} {...rise(reduce, Math.min(i, 10))}>
              <Link
                href={`/project/${m.id}`}
                className="group grid grid-cols-[60px_minmax(0,1fr)] items-start gap-3.5 py-4 text-ink sm:grid-cols-[84px_minmax(0,1fr)_auto]"
              >
                <ProjectCover
                  thumbnailPath={m.thumbnailPath}
                  wave={m.wave}
                  name={m.name}
                  size="sm"
                  className="aspect-video w-full"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-semibold">{m.name}</span>
                  {m.excerpt && <span className="line-clamp-2 max-w-[68ch] text-[13px] text-muted">{m.excerpt}</span>}
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">
                    <span>Whisper, on our servers</span>
                    <span>
                      {m.speakerCount} {m.speakerCount === 1 ? "speaker" : "speakers"}
                    </span>
                    <span className="mono">{m.wordCount.toLocaleString()} words</span>
                    <span className="mono">{duration(m.duration)}</span>
                  </span>
                </span>
                <span className="hidden items-center gap-2 self-center text-xs text-faint sm:flex">
                  {relativeDate(m.updatedAt)}
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </Page>
  );
}
