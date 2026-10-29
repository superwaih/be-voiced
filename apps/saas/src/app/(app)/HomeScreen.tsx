"use client";

/**
 * Home: what you have, and the one thing worth doing next.
 *
 * The figures are real — hours in the library, moments found, clips exported — and the little bars
 * beside them are the last six recordings, not decoration.
 */

import { ArrowUpRight, FileVideo, Sparkle, TextAa } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipCover, ProjectCover, WaveArt } from "@/components/Covers";
import { ImportButton } from "@/components/ImportButton";
import { Card, Page, PageHeader } from "@/components/Page";
import { chooseAndImport } from "@/lib/actions";
import { cx } from "@/lib/cx";
import { bytes, duration, relativeDate } from "@/lib/engine/format";
import type { ProjectMeta } from "@/lib/engine/types";
import { unpackWave } from "@/lib/engine/wave";
import { nextStep, rise } from "@/lib/library";
import { useApp } from "@/store/app";

function hours(seconds: number) {
  const h = seconds / 3600;
  return h >= 10 ? Math.round(h).toString() : h.toFixed(1);
}

function StatCard({
  i,
  reduce,
  label,
  value,
  unit,
  note,
  bars,
}: {
  i: number;
  reduce: boolean | null;
  label: string;
  value: string;
  unit?: string;
  note: string;
  bars: number[];
}) {
  const max = Math.max(1, ...bars);
  return (
    <motion.div {...rise(reduce, i)}>
      <Card className="h-full">
        <div className="text-[12.5px] font-semibold text-muted">{label}</div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-[34px] leading-none font-bold tracking-[-0.04em]">{value}</span>
          {unit && <span className="text-sm text-muted">{unit}</span>}
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="text-xs text-faint">{note}</span>
          {bars.length > 1 && (
            <span className="flex h-6 items-end gap-0.5" aria-hidden="true">
              {bars.map((b, k) => (
                <span
                  key={k}
                  className="w-1.5 rounded-sm bg-accent-line/40"
                  style={{ height: `${Math.max(8, (b / max) * 100)}%` }}
                />
              ))}
            </span>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function NowEditing({ meta, reduce }: { meta: ProjectMeta; reduce: boolean | null }) {
  return (
    <motion.section {...rise(reduce, 3)}>
      <Card className="h-full">
        <div className="mb-3 text-[12.5px] font-semibold text-muted">Pick up where you left off</div>
        <Link href={`/project/${meta.id}`} className="flex gap-3.5 text-ink">
          <ProjectCover
            thumbnailPath={meta.thumbnailPath}
            wave={meta.wave}
            name={meta.name}
            size="md"
            className="aspect-video w-32 shrink-0 sm:w-40"
          />
          <div className="flex min-w-0 flex-col justify-center gap-1">
            <strong className="truncate text-base">{meta.name}</strong>
            <span className="mono text-xs text-faint">
              {duration(meta.duration)} · {bytes(meta.size)}
            </span>
            <span className={cx("text-xs", meta.stage === "analyzed" ? "text-accent-text" : "text-muted")}>{nextStep(meta)}</span>
            <span className="text-xs text-faint">Edited {relativeDate(meta.updatedAt)}</span>
          </div>
        </Link>
      </Card>
    </motion.section>
  );
}

export function HomeScreen() {
  const library = useApp((s) => s.library);
  const importing = useApp((s) => Object.values(s.jobs).some((j) => j.kind === "import"));
  const reduce = useReducedMotion();
  const router = useRouter();

  const [featured, ...others] = library;
  const shelf = others.slice(0, 4);
  const allClips = library.flatMap((m) => m.clips.map((c) => ({ clip: c, meta: m })));
  const latest = [...allClips].sort((a, b) => b.clip.updatedAt.localeCompare(a.clip.updatedAt)).slice(0, 6);

  const totalSeconds = library.reduce((n, m) => n + m.duration, 0);
  const moments = library.reduce((n, m) => n + m.suggestionCount + m.clips.length, 0);
  const exported = allClips.filter((c) => c.clip.exportCount > 0).length;
  const lengthBars = library.slice(0, 6).map((m) => m.duration);
  const momentBars = library.slice(0, 6).map((m) => m.suggestionCount + m.clips.length);
  const exportBars = library.slice(0, 6).map((m) => m.clips.filter((c) => c.exportCount > 0).length);

  return (
    <Page>
      <PageHeader
        title="Home"
        sub="Find the parts of every conversation worth publishing."
        tools={<ImportButton>{importing ? "Reading media" : "Import recording"}</ImportButton>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard
          i={0}
          reduce={reduce}
          label="Conversation in your library"
          value={hours(totalSeconds)}
          unit="hours"
          note={`${library.length} ${library.length === 1 ? "recording" : "recordings"}`}
          bars={lengthBars}
        />
        <StatCard i={1} reduce={reduce} label="Moments found" value={String(moments)} note={`${allClips.length} saved as clips`} bars={momentBars} />
        <StatCard
          i={2}
          reduce={reduce}
          label="Clips exported"
          value={String(exported)}
          unit={allClips.length ? `/${allClips.length}` : undefined}
          note={allClips.length - exported ? `${allClips.length - exported} waiting to export` : "All caught up"}
          bars={exportBars}
        />
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
        {featured ? (
          <NowEditing meta={featured} reduce={reduce} />
        ) : (
          <motion.section {...rise(reduce, 3)}>
            <Card className="h-full">
              <h2 className="mb-1.5 text-base font-bold tracking-[-0.02em]">Your first recording</h2>
              <p className="text-muted">
                Import a podcast, interview, webinar or meeting. Soundbite transcribes it, finds the strongest moments and gets
                them ready to post.
              </p>
            </Card>
          </motion.section>
        )}

        <motion.button
          type="button"
          disabled={importing}
          onClick={async () => {
            const id = await chooseAndImport();
            if (id) router.push(`/project/${id}`);
          }}
          {...rise(reduce, 4)}
          className="relative flex min-h-44 flex-col justify-between overflow-hidden rounded-[22px] bg-accent p-5 text-left text-accent-ink disabled:opacity-70"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold [&_svg]:size-4">
              <FileVideo weight="fill" /> New recording
            </span>
            <ArrowUpRight size={18} />
          </span>
          <span className="relative z-10 mt-6 block text-[22px] leading-[1.1] font-bold tracking-[-0.03em]">
            {importing ? "Reading your recording" : "Drop a recording to start"}
          </span>
          <span className="relative z-10 mt-1.5 block text-xs opacity-80">
            MP4, MOV, MKV, WebM, MP3, WAV or M4A.
          </span>
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 block h-20 opacity-25">
            <WaveArt values={unpackWave(featured?.wave)} gap={0.5} min={0.1} align="bottom" />
          </span>
        </motion.button>
      </div>

      {shelf.length > 0 && (
        <motion.section className="mb-4" {...rise(reduce, 5)}>
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <h2 className="text-base font-bold tracking-[-0.02em]">Recent recordings</h2>
            <Link href="/projects" className="text-xs hover:underline">
              See all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {shelf.map((m) => (
              <Link key={m.id} href={`/project/${m.id}`} className="group flex min-w-0 flex-col gap-2 text-ink">
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
                  <span className="truncate text-muted">{nextStep(m)}</span>
                </span>
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {latest.length > 0 && (
        <motion.section {...rise(reduce, 6)}>
          <Card>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-base font-bold tracking-[-0.02em]">Latest clips</h2>
              <Link href="/captions" className="text-xs hover:underline">
                Add captions
              </Link>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3">
              {latest.map(({ clip, meta }) => (
                <Link key={clip.id} href={`/project/${meta.id}`} className="flex min-w-0 flex-col gap-1.5 text-ink">
                  <ClipCover wave={clip.wave} exported={clip.exportCount > 0} aspect={clip.aspect} className="aspect-video w-full" />
                  <span className="truncate text-[12.5px] font-semibold">{clip.title}</span>
                  <span className="mono text-[11px] text-faint">{duration(clip.end - clip.start)}</span>
                </Link>
              ))}
            </div>
          </Card>
        </motion.section>
      )}

      {library.length === 0 && (
        <motion.section {...rise(reduce, 6)}>
          <Card>
            <div className="flex flex-col gap-2 text-sm text-muted">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <TextAa /> Then: transcribe it
              </div>
              <p>Reading takes a minute or two. The transcript is searchable, correctable and exportable.</p>
              <div className="mt-2 flex items-center gap-2 font-semibold text-ink">
                <Sparkle /> Then: find the moments
              </div>
              <p>Soundbite reads the whole conversation and picks the parts worth posting, with the reason for each.</p>
            </div>
          </Card>
        </motion.section>
      )}
    </Page>
  );
}
