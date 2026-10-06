import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/shell.css";
import "./styles/library-pages.css";
import "./styles/library.css";
import "./styles/workspace.css";
import "./styles/editor.css";
import "./styles/ask.css";
import "./styles/captions.css";

import { IconContext } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";

async function start() {
  // Dev-only visual QA in a plain browser; stripped from production builds.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window) && new URLSearchParams(location.search).has("qa")) {
    await import("./dev/qa");
  }
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <MotionConfig reducedMotion="user">
        <IconContext.Provider value={{ weight: "regular", size: 16 }}>
          <App />
        </IconContext.Provider>
      </MotionConfig>
    </React.StrictMode>,
  );
}

void start();
