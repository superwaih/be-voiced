/**
 * Stands in for `@tauri-apps/api/webview` in the web build.
 *
 * Only drag and drop is used, and a browser has that natively. Dropped files are remembered and
 * reported as paths, so the app's import path is the same one the desktop takes.
 */

import { remember } from "./files";

type DragDropPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

export interface Webview {
  onDragDropEvent(handler: (event: { payload: DragDropPayload }) => void): Promise<() => void>;
}

export function getCurrentWebview(): Webview {
  return {
    onDragDropEvent(handler) {
      // Counting enter and leave is the only reliable way to know the pointer has really left:
      // dragleave also fires when it crosses into a child element.
      let depth = 0;
      const position = { x: 0, y: 0 };

      const onEnter = (e: DragEvent) => {
        e.preventDefault();
        depth++;
        if (depth === 1) handler({ payload: { type: "enter", paths: [], position } });
      };
      const onOver = (e: DragEvent) => {
        e.preventDefault();
        handler({ payload: { type: "over", position: { x: e.clientX, y: e.clientY } } });
      };
      const onLeave = (e: DragEvent) => {
        e.preventDefault();
        depth = Math.max(0, depth - 1);
        if (depth === 0) handler({ payload: { type: "leave" } });
      };
      const onDrop = (e: DragEvent) => {
        e.preventDefault();
        depth = 0;
        const files = Array.from(e.dataTransfer?.files ?? []);
        handler({
          payload: { type: "drop", paths: files.map(remember), position: { x: e.clientX, y: e.clientY } },
        });
      };

      window.addEventListener("dragenter", onEnter);
      window.addEventListener("dragover", onOver);
      window.addEventListener("dragleave", onLeave);
      window.addEventListener("drop", onDrop);
      return Promise.resolve(() => {
        window.removeEventListener("dragenter", onEnter);
        window.removeEventListener("dragover", onOver);
        window.removeEventListener("dragleave", onLeave);
        window.removeEventListener("drop", onDrop);
      });
    },
  };
}
