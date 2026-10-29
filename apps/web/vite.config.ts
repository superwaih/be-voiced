import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const desktopSrc = resolve(here, "../desktop/src");
const platform = resolve(here, "src/platform");
const slash = (p: string) => p.replace(/\\/g, "/");

/**
 * The web app *is* the desktop app. Its views, stores and engine are imported straight from
 * `apps/desktop/src`; only the platform seam is different.
 *
 * An alias cannot do this, because the desktop's own modules import the bridge by relative path
 * ("./ipc", "../lib/ipc"). So every import is resolved first and then redirected if it landed on a
 * module that talks to Tauri.
 */
function browserPlatform(): Plugin {
  const substitutes = new Map([
    [slash(resolve(desktopSrc, "lib/ipc.ts")), resolve(platform, "ipc.web.ts")],
  ]);
  const packages: Record<string, string> = {
    "@tauri-apps/api/core": resolve(platform, "tauri-core.ts"),
    "@tauri-apps/api/event": resolve(platform, "tauri-event.ts"),
    "@tauri-apps/api/webview": resolve(platform, "tauri-webview.ts"),
    "@tauri-apps/api/window": resolve(platform, "tauri-window.ts"),
    "@tauri-apps/plugin-dialog": resolve(platform, "tauri-dialog.ts"),
  };

  return {
    name: "be-voiced:browser-platform",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (packages[source]) return packages[source];
      if (!importer || !source.startsWith(".")) return null;
      // Only the desktop sources are rewritten; the web app's own files import what they say.
      if (!slash(importer).includes("/apps/desktop/")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved ? (substitutes.get(slash(resolved.id)) ?? null) : null;
    },
  };
}

export default defineConfig({
  plugins: [browserPlatform(), react()],
  server: {
    port: 1500,
    strictPort: false,
    // The desktop sources and the shared engine live outside this app's root, so dev has to be
    // allowed to serve them. Scoped to the repository rather than left open.
    fs: { allow: [resolve(here, "../..")] },
  },
  build: { target: "es2022", sourcemap: true },
});
