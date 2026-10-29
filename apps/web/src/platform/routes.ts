/**
 * Addresses for the tabs.
 *
 * The desktop app keeps the current tab in a store, because a window has no address bar. A browser
 * does, and people expect it to work: a link to the Captions tab should open the Captions tab, Back
 * should go back, and a reload should land where it left off. So the store's `view` and the URL are
 * kept in step — the store is still the source of truth, and this listens to it rather than
 * replacing it.
 *
 * Nothing in the shared app knows about this; it is wired up in main.tsx.
 */

import { openProject } from "../../../desktop/src/lib/actions";
import { useApp, type View } from "../../../desktop/src/store/app";
import { useProject } from "../../../desktop/src/store/project";

const ROUTES: { view: View; path: string; title: string | null }[] = [
  { view: "home", path: "/", title: null },
  { view: "projects", path: "/projects", title: "Projects" },
  { view: "transcripts", path: "/transcripts", title: "Transcripts" },
  { view: "captions", path: "/captions", title: "Captions" },
  { view: "ask", path: "/ask", title: "Ask a link" },
  { view: "settings", path: "/settings", title: "Settings" },
  // A recording is addressed by its id: /project/<id>.
  { view: "project", path: "/project", title: null },
];

const PROJECT_PREFIX = "/project/";

/** Set while the URL is being applied, so echoing it back does not push a second entry. */
let applying = false;

function parse(pathname: string): { view: View; projectId?: string } {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean.startsWith(PROJECT_PREFIX)) {
    return { view: "project", projectId: decodeURIComponent(clean.slice(PROJECT_PREFIX.length)) };
  }
  return { view: ROUTES.find((r) => r.path === clean)?.view ?? "home" };
}

function urlFor(view: View, projectId: string | undefined): string {
  if (view === "project") return projectId ? `${PROJECT_PREFIX}${encodeURIComponent(projectId)}` : "/projects";
  return ROUTES.find((r) => r.view === view)?.path ?? "/";
}

function titleFor(view: View): string {
  const name = useProject.getState().project?.name;
  if (view === "project" && name) return `${name} · Be Voiced`;
  const label = ROUTES.find((r) => r.view === view)?.title;
  return label ? `${label} · Be Voiced` : "Be Voiced";
}

/** Point the app at whatever the address bar says. */
async function applyUrl() {
  const { view, projectId } = parse(location.pathname);
  const app = useApp.getState();
  applying = true;
  try {
    if (view === "project") {
      if (!projectId || !app.library.some((m) => m.id === projectId)) {
        // A link to a recording this browser does not have. Say where you landed instead.
        history.replaceState({}, "", "/projects");
        app.setView("projects");
      } else {
        await openProject(projectId);
      }
    } else {
      app.setView(view);
    }
  } finally {
    applying = false;
    document.title = titleFor(useApp.getState().view);
  }
}

/** Point the address bar at whatever the app is showing. */
function syncUrl() {
  if (applying) return;
  const view = useApp.getState().view;
  const url = urlFor(view, useProject.getState().project?.id);
  if (location.pathname !== url) history.pushState({}, "", url);
  document.title = titleFor(view);
}

export function startRouting() {
  const begin = () => {
    void applyUrl();
    useApp.subscribe((s, prev) => {
      if (s.view !== prev.view) syncUrl();
    });
    // Opening a different recording changes the address of the workspace tab.
    useProject.subscribe((s, prev) => {
      if (s.project?.id !== prev.project?.id) syncUrl();
    });
    window.addEventListener("popstate", () => void applyUrl());
  };

  // The library has to be loaded before a link to a recording can be honoured.
  if (useApp.getState().booted) return begin();
  const stop = useApp.subscribe((s) => {
    if (!s.booted) return;
    stop();
    begin();
  });
}
