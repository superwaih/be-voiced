"use client";

import { useEffect, useState } from "react";

/**
 * Follows a media query from JavaScript.
 *
 * Layout is done in CSS; this is for the few behaviours that cannot be — whether the navigation is
 * a drawer that should be kept away from the keyboard, for instance. It reports false until it has
 * run in the browser, because the server has no viewport to measure.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** True once the component has rendered in the browser, so SSR and the first paint agree. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
