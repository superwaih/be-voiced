"use client";

/**
 * The frame every screen sits in: a plum (or black) surround, navigation on the left, and the
 * content on an inset sheet with rounded corners. On a phone the surround becomes a top bar and the
 * navigation slides in over it.
 *
 * It also does the three things that belong to the whole app rather than any one screen: loading
 * settings and the library, accepting a file dropped anywhere on the page, and showing notices.
 */

import { DownloadSimple } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DeleteProjectDialog } from "@/components/DeleteProjectDialog";
import { Nav } from "@/components/Nav";
import { Toasts } from "@/components/Toasts";
import { TopBar } from "@/components/TopBar";
import { importFile, MEDIA_EXTENSIONS } from "@/lib/actions";
import { remember } from "@/lib/files";
import { applyTheme, prefersDark } from "@/lib/theme";
import { bootApp, useApp } from "@/store/app";
import { useShell } from "@/store/shell";

/** Dropping a recording anywhere on the page imports it, as it does in the desktop app. */
function useFileDrop() {
  const [hovering, setHovering] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Counting enter against leave is the only reliable way to know the pointer has really left:
    // dragleave also fires when it crosses into a child element.
    let depth = 0;

    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depth++;
      setHovering(true);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setHovering(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setHovering(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const media = files.find((f) => MEDIA_EXTENSIONS.includes(f.name.split(".").pop()?.toLowerCase() ?? ""));
      if (media) {
        void importFile(remember(media)).then((id) => id && router.push(`/project/${id}`));
      } else if (files.length) {
        useApp.getState().toast({
          tone: "error",
          title: "Unsupported file",
          body: "Drop an MP4, MOV, MKV, WebM, MP3, WAV or M4A file.",
        });
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [router]);

  return hovering;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const hydrate = useShell((s) => s.hydrate);
  const theme = useShell((s) => s.theme);
  const booted = useApp((s) => s.booted);
  const dropping = useFileDrop();

  // What this person chose is in their browser, not in the markup the server sent.
  useEffect(() => hydrate(), [hydrate]);
  useEffect(() => {
    void bootApp();
  }, []);

  // "System" means following it as it changes, not reading it once.
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = prefersDark() ? "dark" : "light";
    };
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return (
    <div className="flex h-full flex-col bg-rail lg:flex-row">
      <TopBar />
      <Nav />
      <main className="relative mx-2 mb-2 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-bg lg:my-2.5 lg:mr-2.5 lg:ml-0 lg:rounded-3xl dark:inset-ring dark:inset-ring-line">
        {booted ? children : <div className="flex-1" aria-busy="true" />}
      </main>

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-30 grid place-items-center">
          <div className="flex flex-col items-center gap-1.5 rounded-[26px] bg-rail px-14 py-10 text-rail-ink shadow-pop inset-ring-[1.5px] inset-ring-brand-soft">
            <DownloadSimple size={22} className="mb-1.5 text-brand-strong" />
            <strong className="text-[19px]">Drop to import</strong>
            <span className="text-rail-text">MP4, MOV, MKV, WebM, MP3, WAV or M4A</span>
          </div>
        </div>
      )}

      <DeleteProjectDialog />
      <Toasts />
    </div>
  );
}
