"use client";

/**
 * The bar across the top of a phone or tablet: the wordmark, and the way into the navigation.
 *
 * It is not rendered at all from large screens up, where the rail is always there.
 */

import { List } from "@phosphor-icons/react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { useShell } from "@/store/shell";

export function TopBar() {
  const menuOpen = useShell((s) => s.menuOpen);
  const setMenuOpen = useShell((s) => s.setMenuOpen);

  return (
    <header className="flex flex-none items-center justify-between gap-2 px-3 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5 text-rail-text lg:hidden">
      <Link href="/" className="flex min-w-0 items-center gap-[11px] px-1.5 text-rail-ink">
        <BrandMark />
        <span className="text-[17px] font-bold tracking-[-0.025em] whitespace-nowrap">Be Voiced</span>
      </Link>

      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-label="Menu"
        aria-expanded={menuOpen}
        aria-controls="main-nav"
        className="grid size-10 shrink-0 place-items-center rounded-full transition-colors hover:bg-rail-active hover:text-rail-ink aria-expanded:bg-rail-active aria-expanded:text-rail-ink"
      >
        <List size={20} />
      </button>
    </header>
  );
}
