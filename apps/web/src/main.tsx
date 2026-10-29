/**
 * Be Voiced in a browser.
 *
 * This is the desktop app: the same App component, the same views, the same stylesheets, read
 * straight out of `apps/desktop/src`. Only the platform seam differs — Vite swaps `lib/ipc.ts` for
 * `platform/ipc.web.ts` (see vite.config.ts), so every screen talks to a browser bridge instead of
 * Tauri. The one file added here is `responsive.css`, which lets the fixed desktop shell work on a
 * phone, and `platform/routes.ts`, which gives each tab an address.
 */

import "@fontsource-variable/manrope";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../../desktop/src/styles/tokens.css";
import "../../desktop/src/styles/base.css";
import "../../desktop/src/styles/ui.css";
import "../../desktop/src/styles/shell.css";
import "../../desktop/src/styles/library-pages.css";
import "../../desktop/src/styles/library.css";
import "../../desktop/src/styles/workspace.css";
import "../../desktop/src/styles/editor.css";
import "../../desktop/src/styles/ask.css";
import "../../desktop/src/styles/captions.css";
import "./styles/responsive.css";

import { IconContext } from "@phosphor-icons/react";
import { MotionConfig } from "motion/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "../../desktop/src/App";
import { startRouting } from "./platform/routes";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <IconContext.Provider value={{ weight: "regular", size: 16 }}>
        <App />
      </IconContext.Provider>
    </MotionConfig>
  </React.StrictMode>,
);

// Each tab gets its own URL, so links, Back and reload all behave.
startRouting();
