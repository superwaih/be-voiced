"use client";

/**
 * One recording, open: the player, its transcript, and the moments worth keeping.
 *
 * Three panels side by side on a wide screen. Narrower, they become tabs — stacking panels that
 * each hold their own scroll makes for a page nobody can navigate.
 */

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DotsThree,
  Export,
  Sparkle,
  TextAa,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MomentsPanel } from "@/components/workspace/MomentsPanel";
import { PlayerPanel } from "@/components/workspace/PlayerPanel";
import { TranscribeModal } from "@/components/workspace/TranscribeModal";
import { TranscriptPanel } from "@/components/workspace/TranscriptPanel";
import { Button, IconButton, InlineEdit, MenuButton, Segmented } from "@/components/ui";
import { ensurePeaks, exportTranscript, findMoments, loadProject, relinkSource } from "@/lib/actions";
import { cx } from "@/lib/cx";
import { bytes, duration } from "@/lib/engine/format";
import { useApp } from "@/store/app";
import { useProject } from "@/store/project";

type Pane = "player" | "transcript" | "moments";

export function WorkspaceScreen({ id }: { id: string }) {
  const project = useProject((s) => s.project);
  const booted = useApp((s) => s.booted);
  const known = useApp((s) => s.library.some((m) => m.id === id));
  const router = useRouter();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!booted) return;
    if (!known) {
      setMissing(true);
      return;
    }
    void loadProject(id);
  }, [booted, known, id]);

  if (missing) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <WarningCircle size={24} className="text-faint" />
          <strong>That recording is not in this browser</strong>
          <p className="max-w-[40ch] text-sm text-muted">
            Recordings live in the browser you imported them in, until the service is wired up.
          </p>
          <Button className="mt-2" onClick={() => router.push("/projects")}>
            Back to projects
          </Button>
        </div>
      </div>
    );
  }

  if (!project || project.id !== id) return <div className="flex-1" aria-busy="true" />;
  return <Workspace />;
}

function Workspace() {
  const project = useProject((s) => s.project)!;
  const update = useProject((s) => s.update);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const saving = useProject((s) => s.saving);
  const saveError = useProject((s) => s.saveError);
  const sourceMissing = useApp((s) => s.library.find((m) => m.id === project.id)?.sourceMissing);
  const jobs = useApp((s) => s.jobs);
  const askDelete = useApp((s) => s.askDelete);

  const transcribing = Object.values(jobs).some((j) => j.kind === "transcribe" && j.projectId === project.id);
  const analyzing = Object.values(jobs).some((j) => j.kind === "analyze" && j.projectId === project.id);

  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("transcript");

  useEffect(() => {
    void ensurePeaks(project);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const topic = useMemo(() => project.topics.find((t) => t.id === topicId) ?? null, [project.topics, topicId]);

  let primary = null;
  if (!project.transcript) {
    primary = (
      <Button variant="primary" icon={<TextAa />} disabled={transcribing || sourceMissing} onClick={() => setTranscribeOpen(true)}>
        {transcribing ? "Transcribing" : "Transcribe"}
      </Button>
    );
  } else if (!project.analysis) {
    primary = (
      <Button variant="primary" icon={<Sparkle />} disabled={analyzing} onClick={() => void findMoments("initial")}>
        {analyzing ? "Finding moments" : "Find moments"}
      </Button>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_minmax(0,1fr)] xl:grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 lg:px-5 lg:py-3.5">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <InlineEdit
            label="Recording name"
            className="max-w-full text-[17px] font-bold tracking-[-0.03em] lg:text-xl"
            value={project.name}
            onCommit={(name) => update((p) => ({ ...p, name }))}
          />
          <span className="hidden min-w-0 items-baseline gap-3 text-[12.5px] text-faint sm:flex">
            <span className="mono">{duration(project.source.duration)}</span>
            <span className="truncate" title={project.source.name}>
              {project.source.name}, {bytes(project.source.size)}
            </span>
            {sourceMissing && (
              <button
                type="button"
                onClick={() => void relinkSource()}
                className="flex shrink-0 items-center gap-1 font-semibold whitespace-nowrap text-danger [&_svg]:size-3.5"
              >
                <WarningCircle /> File not open, locate
              </button>
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span aria-live="polite" className="mr-1 hidden text-xs text-faint sm:inline">
            {saveError ? <span className="text-danger">Not saved</span> : saving ? "Saving" : "Saved"}
          </span>
          <IconButton label="Undo" disabled={!canUndo} onClick={() => useProject.getState().undo()}>
            <ArrowCounterClockwise />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={() => useProject.getState().redo()}>
            <ArrowClockwise />
          </IconButton>
          <MenuButton
            label="Recording menu"
            items={[
              {
                label: "Download transcript as text",
                icon: <Export />,
                disabled: !project.transcript,
                onSelect: () => void exportTranscript("txt"),
              },
              {
                label: "Download transcript as SRT",
                icon: <Export />,
                disabled: !project.transcript,
                onSelect: () => void exportTranscript("srt"),
              },
              {
                label: "Download transcript as VTT",
                icon: <Export />,
                disabled: !project.transcript,
                onSelect: () => void exportTranscript("vtt"),
              },
              "divider",
              {
                label: "Transcribe again",
                icon: <TextAa />,
                disabled: !project.transcript || transcribing || sourceMissing,
                onSelect: () => setTranscribeOpen(true),
              },
              "divider",
              {
                label: "Delete recording",
                icon: <Trash />,
                danger: true,
                onSelect: () => {
                  const meta = useApp.getState().library.find((m) => m.id === project.id);
                  if (meta) askDelete(meta);
                },
              },
            ]}
          >
            <DotsThree weight="bold" />
          </MenuButton>
          {primary}
        </div>
      </header>

      {/* Below three columns, the panels become tabs rather than a stack nobody can scroll. */}
      <div className="flex justify-center px-3 pb-2 xl:hidden">
        <Segmented<Pane>
          label="Panel"
          size="sm"
          value={pane}
          onChange={setPane}
          options={[
            { value: "player", label: "Player" },
            { value: "transcript", label: "Transcript" },
            { value: "moments", label: "Moments" },
          ]}
        />
      </div>

      <div className="grid min-h-0 gap-3 px-3 pb-3 lg:px-5 lg:pb-5 xl:grid-cols-[minmax(300px,0.95fr)_minmax(340px,1.15fr)_minmax(300px,330px)]">
        <div className={cx("min-h-0 xl:block", pane === "player" ? "grid" : "hidden")}>
          <PlayerPanel selectedClipId={selectedClipId} onSelectClip={setSelectedClipId} topicId={topicId} onTopic={setTopicId} />
        </div>
        <div className={cx("min-h-0 xl:block", pane === "transcript" ? "grid" : "hidden")}>
          <TranscriptPanel
            topic={topic}
            onClearTopic={() => setTopicId(null)}
            onOpenTranscribe={() => setTranscribeOpen(true)}
            onClipCreated={(id) => {
              setSelectedClipId(id);
              setPane("moments");
            }}
          />
        </div>
        <div className={cx("min-h-0 xl:block", pane === "moments" ? "grid" : "hidden")}>
          <MomentsPanel selectedClipId={selectedClipId} onSelectClip={setSelectedClipId} />
        </div>
      </div>

      <TranscribeModal open={transcribeOpen} onClose={() => setTranscribeOpen(false)} />
    </div>
  );
}
