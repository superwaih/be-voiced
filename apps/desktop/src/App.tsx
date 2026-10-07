import { DownloadSimple } from "@phosphor-icons/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AnimatePresence, motion } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { DeleteProjectDialog } from "./components/DeleteProjectDialog";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { importFile, MEDIA_EXTENSIONS, openProject } from "./lib/actions";
import { isTauri } from "./lib/ipc";
import { bootApp, useApp } from "./store/app";
import { useProject } from "./store/project";
import { AskView } from "./views/AskView";
import { CaptionsView } from "./views/CaptionsView";
import { HomeView } from "./views/HomeView";
import { ProjectView } from "./views/ProjectView";
import { ProjectsView } from "./views/ProjectsView";
import { SettingsView } from "./views/SettingsView";
import { TranscriptsView } from "./views/TranscriptsView";

function useTheme() {
  const theme = useApp((s) => s.settings.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function useFileDrop() {
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") setHovering(true);
        else if (p.type === "leave") setHovering(false);
        else if (p.type === "drop") {
          setHovering(false);
          const file = p.paths.find((path) => MEDIA_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? ""));
          if (file) void importFile(file);
          else if (p.paths.length) {
            useApp.getState().toast({ tone: "error", title: "Unsupported file", body: "Drop an MP4, MOV, MKV, WebM, MP3, WAV or M4A file." });
          }
        }
      })
      .then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);
  return hovering;
}

export default function App() {
  const booted = useApp((s) => s.booted);
  const view = useApp((s) => s.view);
  const [bootError, setBootError] = useState<string | null>(null);
  useTheme();
  const dropping = useFileDrop();

  useEffect(() => {
    if (!isTauri()) {
      setBootError("Be Voiced runs as a desktop app. Start it with `pnpm tauri dev`.");
      return;
    }
    bootApp()
      .then(async () => {
        // Restore the project that was open when the app last closed.
        const last = useApp.getState().settings.lastProjectId;
        if (last && useApp.getState().library.some((m) => m.id === last)) await openProject(last);
      })
      .catch((err) => setBootError(String(err)));

    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      await useProject.getState().flush();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  if (bootError) {
    return (
      <div className="boot">
        <p>{bootError}</p>
      </div>
    );
  }
  if (!booted) return <div className="boot" aria-busy="true" />;

  return (
    <div className="shell">
      <Sidebar />
      <main className="shell-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className="view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {view === "home" && <HomeView />}
            {view === "projects" && <ProjectsView />}
            {view === "transcripts" && <TranscriptsView />}
            {view === "captions" && <CaptionsView />}
            {view === "ask" && <AskView />}
            {view === "settings" && <SettingsView />}
            {view === "project" && <ProjectView />}
          </motion.div>
        </AnimatePresence>
      </main>
      {dropping && (
        <div className="drop-overlay">
          <div className="drop-card">
            <DownloadSimple size={22} />
            <strong>Drop to import</strong>
            <span className="muted">MP4, MOV, MKV, WebM, MP3, WAV or M4A</span>
          </div>
        </div>
      )}
      <DeleteProjectDialog />
      <Toasts />
    </div>
  );
}
