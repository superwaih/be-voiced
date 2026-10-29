"use client";

/**
 * Navigation, in two shapes.
 *
 * From large screens up it is the rail down the left, which can collapse to icons. Below that the
 * same element becomes a drawer: hidden off the left edge, slid in over a scrim when the top bar's
 * menu is tapped. One element, so there is one set of nav items to keep correct — and the active
 * pill animates between them either way.
 */

import {
  CaretLineLeft,
  CaretLineRight,
  ChatCircleDots,
  ClosedCaptioning,
  GearSix,
  House,
  type Icon,
  MoonStars,
  SignOut,
  SquaresFour,
  Sun,
  TextAlignLeft,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ProjectCover } from "@/components/Covers";
import { JobTray } from "@/components/JobTray";
import { duration } from "@/lib/engine/format";
import { cx } from "@/lib/cx";
import { useMediaQuery, useMounted } from "@/lib/useMediaQuery";
import { useApp } from "@/store/app";
import { useProject } from "@/store/project";
import { useIsDark, useShell } from "@/store/shell";

const NAV: { href: string; label: string; icon: Icon; exact?: boolean }[] = [
  { href: "/", label: "Home", icon: House, exact: true },
  { href: "/projects", label: "Projects", icon: SquaresFour },
  { href: "/transcripts", label: "Transcripts", icon: TextAlignLeft },
  { href: "/captions", label: "Captions", icon: ClosedCaptioning },
  { href: "/ask", label: "Ask", icon: ChatCircleDots },
];

function useActive(href: string, exact?: boolean) {
  const pathname = usePathname();
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  href,
  label,
  icon: Glyph,
  exact,
  collapsed,
}: {
  href: string;
  label: string;
  icon: Icon;
  exact?: boolean;
  collapsed: boolean;
}) {
  const active = useActive(href, exact);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cx(
        "relative flex min-h-[46px] w-full items-center gap-3 rounded-full px-2 py-1.5 text-sm font-semibold transition-colors",
        active ? "text-rail-ink" : "text-rail-text hover:text-rail-ink",
        collapsed && "lg:justify-center lg:px-0",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-full bg-rail-active inset-ring inset-ring-rail-ring"
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
        />
      )}
      <span
        className={cx(
          "relative grid size-[34px] shrink-0 place-items-center rounded-full transition-colors",
          active ? "bg-rail-ink text-rail dark:bg-accent dark:text-accent-ink" : "bg-rail-active",
        )}
      >
        <Glyph size={17} />
      </span>
      <span className={cx("relative whitespace-nowrap", collapsed && "lg:hidden")}>{label}</span>
    </Link>
  );
}

export function Nav() {
  const menuOpen = useShell((s) => s.menuOpen);
  const setMenuOpen = useShell((s) => s.setMenuOpen);
  const collapsed = useShell((s) => s.collapsed);
  const toggleCollapsed = useShell((s) => s.toggleCollapsed);
  const setTheme = useShell((s) => s.setTheme);
  const dark = useIsDark();
  const pathname = usePathname();
  const project = useProject((s) => s.project);
  const meta = useApp((s) => (project ? s.library.find((m) => m.id === project.id) : undefined));
  const panel = useRef<HTMLElement>(null);

  const wide = useMediaQuery("(min-width: 1024px)");
  const mounted = useMounted();
  const close = () => setMenuOpen(false);

  // Going somewhere closes the drawer; it would otherwise cover what you just asked for.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname, setMenuOpen]);

  // Escape closes it, and opening it moves focus inside, as any dialog-like thing should.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, setMenuOpen]);

  // A closed drawer is still in the page, just off the edge of it. Keep the keyboard out of it.
  const hiddenDrawer = mounted && !wide && !menuOpen;

  return (
    <>
      <AnimatePresence>
        {menuOpen && (
          <motion.button
            type="button"
            aria-label="Close menu"
            onClick={close}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-30 bg-scrim backdrop-blur-[2px] lg:hidden"
          />
        )}
      </AnimatePresence>

      <nav
        id="main-nav"
        ref={panel}
        aria-label="Main"
        inert={hiddenDrawer}
        className={cx(
          // Drawer, on anything narrower than a laptop.
          "fixed inset-y-0 left-0 z-40 flex w-[min(300px,85vw)] flex-col gap-1 overflow-y-auto overscroll-contain",
          "bg-rail px-3.5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-rail-text",
          "shadow-[24px_0_60px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          menuOpen ? "translate-x-0" : "-translate-x-full",
          // Rail, from large screens up.
          "lg:static lg:z-auto lg:translate-x-0 lg:overflow-visible lg:px-3.5 lg:pt-4.5 lg:pb-4 lg:shadow-none",
          "lg:transition-[width] lg:duration-200",
          collapsed ? "lg:w-[84px]" : "lg:w-[248px]",
        )}
      >
        <div className="mb-5 flex min-h-10 items-center justify-between gap-2">
          <Link href="/" className={cx("flex min-w-0 items-center gap-[11px] px-1.5 text-rail-ink", collapsed && "lg:px-0")}>
            <BrandMark />
            <span className={cx("text-[17px] font-bold tracking-[-0.025em] whitespace-nowrap", collapsed && "lg:hidden")}>
              Soundbite
            </span>
          </Link>

          {/* Close on a phone, collapse on a laptop: the same corner, the job that makes sense there. */}
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="grid size-8 shrink-0 place-items-center rounded-full text-rail-text transition-colors hover:bg-rail-active hover:text-rail-ink lg:hidden"
          >
            <X size={17} />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx(
              "hidden size-8 shrink-0 place-items-center rounded-full text-rail-text transition-colors hover:bg-rail-active hover:text-rail-ink lg:grid",
              collapsed && "lg:hidden",
            )}
          >
            <CaretLineLeft size={17} />
          </button>
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="mx-auto mb-2 hidden size-8 place-items-center rounded-full text-rail-text transition-colors hover:bg-rail-active hover:text-rail-ink lg:grid"
          >
            <CaretLineRight size={17} />
          </button>
        )}

        <div className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavItem key={item.href} {...item} collapsed={collapsed} />
          ))}
        </div>

        <div className="mt-auto flex flex-col gap-1">
          <JobTray collapsed={collapsed} />
          {project && (
            <Link
              href={`/project/${project.id}`}
              title={`Continue editing ${project.name}`}
              aria-current={pathname === `/project/${project.id}` ? "page" : undefined}
              className={cx(
                "my-2 flex w-full items-center gap-[11px] rounded-[18px] bg-rail-active p-[9px] text-left text-rail-ink transition-shadow inset-ring inset-ring-rail-ring hover:inset-ring-[1.5px] hover:inset-ring-brand-soft",
                collapsed && "lg:justify-center lg:p-1.5",
              )}
            >
              <ProjectCover
                thumbnailPath={project.thumbnailPath}
                wave={meta?.wave}
                name={project.name}
                size="sm"
                className="size-11"
              />
              <span className={cx("flex min-w-0 flex-col", collapsed && "lg:hidden")}>
                <span className="truncate font-bold">{project.name}</span>
                <span className="text-xs whitespace-nowrap text-rail-text">
                  Continue editing
                  {meta ? <span className="mono"> {duration(meta.duration)}</span> : null}
                </span>
              </span>
            </Link>
          )}
          <NavItem href="/settings" label="Settings" icon={GearSix} collapsed={collapsed} />
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/sign-in";
            }}
            title="Sign out"
            className={cx(
              "relative flex min-h-[46px] w-full items-center gap-3 rounded-full px-2 py-1.5 text-left text-sm font-semibold text-rail-text transition-colors hover:text-rail-ink",
              collapsed && "lg:justify-center lg:px-0",
            )}
          >
            <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-rail-active">
              <SignOut size={17} />
            </span>
            <span className={cx("whitespace-nowrap", collapsed && "lg:hidden")}>Sign out</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            title={dark ? "Light mode" : "Dark mode"}
            className={cx(
              "relative flex min-h-[46px] w-full items-center gap-3 rounded-full px-2 py-1.5 text-left text-sm font-semibold text-rail-text transition-colors hover:text-rail-ink",
              collapsed && "lg:justify-center lg:px-0",
            )}
          >
            <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-rail-active">
              {dark ? <Sun size={17} /> : <MoonStars size={17} />}
            </span>
            <span className={cx("whitespace-nowrap", collapsed && "lg:hidden")}>{dark ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </nav>
    </>
  );
}
