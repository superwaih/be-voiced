"use client";

/**
 * The frame around the app: the theme, whether the rail is collapsed, and whether the phone drawer
 * is open.
 *
 * Kept apart from the product's own state because it is the only state the server renders against.
 * It starts at fixed defaults so the first client render matches the markup that came down the
 * wire, then `hydrate()` reads what this person actually chose.
 */

import { create } from "zustand";
import { applyTheme, readTheme, saveTheme, type Theme } from "@/lib/theme";

const COLLAPSE_KEY = "soundbite.sidebarCollapsed";

interface ShellState {
  theme: Theme;
  /** The rail is icons-only. Only applies from large screens up; the drawer is always full width. */
  collapsed: boolean;
  menuOpen: boolean;
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  toggleCollapsed: () => void;
  setMenuOpen: (open: boolean) => void;
  hydrate: () => void;
}

export const useShell = create<ShellState>()((set, get) => ({
  theme: "dark",
  collapsed: false,
  menuOpen: false,
  hydrated: false,

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    saveTheme(theme);
  },

  toggleCollapsed: () => {
    const collapsed = !get().collapsed;
    set({ collapsed });
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage can be blocked; the rail still collapses for this session.
    }
  },

  setMenuOpen: (menuOpen) => set({ menuOpen }),

  hydrate: () => {
    if (get().hydrated) return;
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      // ignore
    }
    set({ theme: readTheme(), collapsed, hydrated: true });
  },
}));

/** True when the theme in effect is the dark one, system preference included. */
export const useIsDark = () => {
  const theme = useShell((s) => s.theme);
  const hydrated = useShell((s) => s.hydrated);
  if (!hydrated) return true;
  return theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
};
