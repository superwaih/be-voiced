/**
 * Light and dark, as an attribute on <html>.
 *
 * The value is read before the first paint by the inline script in `app/layout.tsx`, which is why
 * the storage key and the shape of what is stored have to match there. This module is what the
 * interface uses afterwards.
 */

export type Theme = "system" | "light" | "dark";

const KEY = "bv.settings";

/** Reads only the theme out of the settings blob, leaving the rest to the settings store. */
export function readTheme(): Theme {
  try {
    const saved = (JSON.parse(localStorage.getItem(KEY) || "{}") as { theme?: Theme }).theme;
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
  } catch {
    return "dark";
  }
}

export function saveTheme(theme: Theme) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(KEY, JSON.stringify({ ...all, theme }));
  } catch {
    // Storage can be blocked. The theme still applies for this session.
  }
}

export const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export const isDark = (theme: Theme) => theme === "dark" || (theme === "system" && prefersDark());

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = isDark(theme) ? "dark" : "light";
}
