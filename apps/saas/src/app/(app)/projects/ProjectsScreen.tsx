"use client";

import { DotsThree, FolderOpen, MagnifyingGlass, Trash, WarningCircle } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProjectCover } from "@/components/Covers";
import { ImportButton } from "@/components/ImportButton";
import { Page, PageHeader } from "@/components/Page";
import { EmptyState, MenuButton, Segmented, TextInput } from "@/components/ui";
import { cx } from "@/lib/cx";
import { bytes, duration, relativeDate } from "@/lib/engine/format";
import type { ProjectMeta } from "@/lib/engine/types";
import { nextStep, rise } from "@/lib/library";
import { useApp } from "@/store/app";

type Filter = "all" | "imported" | "transcribed" | "clips";

const matches = (m: ProjectMeta, f: Filter) =>
  f === "all" ? true : f === "clips" ? m.clips.length > 0 : f === "imported" ? m.stage === "imported" : m.stage !== "imported";

export function ProjectsScreen() {
  const library = useApp((s) => s.library);
  const askDelete = useApp((s) => s.askDelete);
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return library.filter(
      (m) => matches(m, filter) && (!q || m.name.toLowerCase().includes(q) || m.sourceName.toLowerCase().includes(q)),
    );
  }, [library, query, filter]);

  return (
    <Page>
      <PageHeader
        title="Projects"
        sub={
          <>
            {library.length} {library.length === 1 ? "recording" : "recordings"},{" "}
            {duration(library.reduce((n, m) => n + m.duration, 0))} of conversation
          </>
        }
        tools={<ImportButton>Import</ImportButton>}
      />

      {library.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title="No recordings yet"
          body="Import one to start. Each becomes a project with its transcript, its moments and its clips."
          action={<ImportButton />}
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Segmented<Filter>
              label="Filter recordings"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "imported", label: "To transcribe" },
                { value: "transcribed", label: "Transcribed" },
                { value: "clips", label: "With clips" },
              ]}
            />
            <TextInput
              icon={<MagnifyingGlass />}
              placeholder="Search"
              aria-label="Search recordings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full sm:w-56"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-muted">Nothing matches that.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((m, i) => (
                <motion.article key={m.id} className="group relative min-w-0" {...rise(reduce, Math.min(i, 10))}>
                  <Link href={`/project/${m.id}`} className="flex min-w-0 flex-col gap-2 text-left text-ink">
                    <ProjectCover
                      thumbnailPath={m.thumbnailPath}
                      wave={m.wave}
                      name={m.name}
                      size="lg"
                      className="aspect-video w-full transition-transform duration-200 group-hover:-translate-y-0.5"
                    />
                    <span className="truncate font-semibold">{m.name}</span>
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <span className="mono text-faint">{duration(m.duration)}</span>
                      <span
                        className={cx(
                          "flex min-w-0 items-center gap-1 truncate [&_svg]:size-3.5",
                          m.sourceMissing ? "text-danger" : m.stage === "analyzed" ? "text-accent-text" : "text-muted",
                        )}
                      >
                        {m.sourceMissing && <WarningCircle />}
                        {nextStep(m)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-faint">
                      {relativeDate(m.updatedAt)}, {bytes(m.size)}
                    </span>
                  </Link>

                  <div className="absolute top-1.5 right-1.5 rounded-full bg-surface/85 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <MenuButton
                      label="Recording actions"
                      items={[
                        { label: "Delete recording", icon: <Trash />, danger: true, onSelect: () => askDelete(m) },
                      ]}
                    >
                      <DotsThree weight="bold" />
                    </MenuButton>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </>
      )}
    </Page>
  );
}
