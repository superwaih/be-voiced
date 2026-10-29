/**
 * Stands in for `@tauri-apps/api/window` in the web build.
 *
 * The app asks to be told before the window closes so it can flush the open recording.
 * `pagehide` is the browser's equivalent and, unlike `beforeunload`, it also fires when a phone
 * backgrounds the tab. The handler cannot be awaited there, so saving has to be synchronous
 * enough to land — which it is, since storage here is localStorage.
 */

export interface Window {
  onCloseRequested(handler: () => void | Promise<void>): Promise<() => void>;
}

export function getCurrentWindow(): Window {
  return {
    onCloseRequested(handler) {
      const run = () => void handler();
      const onHidden = () => {
        if (document.visibilityState === "hidden") run();
      };
      window.addEventListener("pagehide", run);
      document.addEventListener("visibilitychange", onHidden);
      return Promise.resolve(() => {
        window.removeEventListener("pagehide", run);
        document.removeEventListener("visibilitychange", onHidden);
      });
    },
  };
}
