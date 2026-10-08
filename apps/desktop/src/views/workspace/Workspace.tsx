import {
  ArrowClockwise,
  ArrowCounterClockwise,
  DotsThree,
  Export,
  FolderOpen,
  Sparkle,
  TextAa,
  Trash,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Button, IconButton, InlineEdit, MenuButton } from "../../components/ui";
import { ensurePeaks, exportTranscript, findMoments, relinkSource } from "../../lib/actions";
import { bytes, duration } from "@be-voiced/engine/format";
import { ipc } from "../../lib/ipc";
import { useApp } from "../../store/app";
import { useProject } from "../../store/project";
import { HighlightsPanel } from "./HighlightsPanel";
import { PlayerPanel } from "./PlayerPanel";
import { TranscribeModal } from "./TranscribeModal";
import { TranscriptPanel } from "./TranscriptPanel";

export function Workspace() {
  const project = useProject((s) => s.project)!;
  const update = useProject((s) => s.update);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const saving = useProject((s) => s.saving);
  const saveError = useProject((s) => s.saveError);
  const sourceMissing = useApp((s) => s.library.find((m) => m.id === project.id)?.sourceMissing);
  const jobs = useApp((s) => s.jobs);
  const transcribing = Object.values(jobs).some((j) => j.kind === "transcribe" && j.projectId === project.id);
  const analyzing = Object.values(jobs).some((j) => j.kind === "analyze" && j.projectId === project.id);

  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);

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
      <Button
        variant="primary"
        icon={<Sparkle />}
        disabled={analyzing}
        onClick={() => void findMoments("initial")}
      >
        {analyzing ? "Finding moments" : "Find moments"}
      </Button>
    );
  }

  return (
    <div className="workspace">
      <header className="ws-header">
        <div className="ws-title">
          <InlineEdit
            label="Project name"
            className="ws-name"
            value={project.name}
            onCommit={(name) => update((p) => ({ ...p, name }))}
          />
          <span className="ws-meta faint">
            <span className="mono">{duration(project.source.duration)}</span>
            <span className="truncate" title={project.source.path}>
              {project.source.name}, {bytes(project.source.size)}
            </span>
            {sourceMissing && (
              <button className="ws-missing" onClick={() => void relinkSource()}>
                <WarningCircle /> Source missing, locate
              </button>
            )}
          </span>
        </div>
        <div className="ws-actions">
          <span className="save-state faint" aria-live="polite">
            {saveError ? <span className="is-warning">Not saved</span> : saving ? "Saving" : "Saved"}
          </span>
          <IconButton label="Undo" disabled={!canUndo} onClick={() => useProject.getState().undo()}>
            <ArrowCounterClockwise />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={() => useProject.getState().redo()}>
            <ArrowClockwise />
          </IconButton>
          <MenuButton
            label="Project menu"
            items={[
              { label: "Export transcript as text", icon: <Export />, disabled: !project.transcript, onSelect: () => void exportTranscript("txt") },
              { label: "Export transcript as SRT", icon: <Export />, disabled: !project.transcript, onSelect: () => void exportTranscript("srt") },
              { label: "Export transcript as VTT", icon: <Export />, disabled: !project.transcript, onSelect: () => void exportTranscript("vtt") },
              "divider",
              {
                label: "Transcribe again",
                icon: <TextAa />,
                disabled: !project.transcript || transcribing || sourceMissing,
                onSelect: () => setTranscribeOpen(true),
              },
              { label: "Show source file", icon: <FolderOpen />, disabled: sourceMissing, onSelect: () => void ipc.revealPath(project.source.path) },
              "divider",
              {
                label: "Delete project",
                icon: <Trash />,
                danger: true,
                onSelect: () => {
                  const meta = useApp.getState().library.find((m) => m.id === project.id);
                  if (meta) useApp.getState().askDelete(meta);
                },
              },
            ]}
          >
            <DotsThree weight="bold" />
          </MenuButton>
          {primary}
        </div>
      </header>

      <div className="ws-body">
        <PlayerPanel
          selectedClipId={selectedClipId}
          onSelectClip={setSelectedClipId}
          topicId={topicId}
          onTopic={setTopicId}
        />
        <TranscriptPanel topic={topic} onClearTopic={() => setTopicId(null)} onOpenTranscribe={() => setTranscribeOpen(true)} onClipCreated={setSelectedClipId} />
        <HighlightsPanel selectedClipId={selectedClipId} onSelectClip={setSelectedClipId} />
      </div>

      <TranscribeModal open={transcribeOpen} onClose={() => setTranscribeOpen(false)} />
    </div>
  );
}
