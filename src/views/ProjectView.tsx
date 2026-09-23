import { useEffect } from "react";
import { player } from "../lib/player";
import { useProject } from "../store/project";
import { ClipEditor } from "./editor/ClipEditor";
import { Workspace } from "./workspace/Workspace";

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function ProjectView() {
  const project = useProject((s) => s.project);
  const view = project?.ui.view ?? "workspace";
  const clipExists = useProject((s) => !!s.project?.clips.some((c) => c.id === s.project?.ui.clipId));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !isTyping(e.target)) {
        e.preventDefault();
        if (e.shiftKey) useProject.getState().redo();
        else useProject.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y" && !isTyping(e.target)) {
        e.preventDefault();
        useProject.getState().redo();
        return;
      }
      if (isTyping(e.target) || mod || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowLeft" && !(e.target as HTMLElement).closest?.("[role=slider], input[type=range]")) {
        e.preventDefault();
        player.skip(e.shiftKey ? -1 : -5);
      } else if (e.key === "ArrowRight" && !(e.target as HTMLElement).closest?.("[role=slider], input[type=range]")) {
        e.preventDefault();
        player.skip(e.shiftKey ? 1 : 5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!project) return null;
  if (view === "editor" && clipExists) return <ClipEditor key={project.ui.clipId} clipId={project.ui.clipId!} />;
  return <Workspace />;
}

export function openEditor(clipId: string) {
  useProject.getState().update((p) => ({ ...p, ui: { ...p.ui, view: "editor", clipId } }), { history: false });
}

export function openWorkspace() {
  useProject.getState().update((p) => ({ ...p, ui: { ...p.ui, view: "workspace" } }), { history: false });
}
