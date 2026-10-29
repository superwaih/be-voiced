/**
 * Page chrome: the scrolling area, its heading, and the white cards that sit on it.
 *
 * Panelled screens — the workspace, the captions editor — do their own layout and do not use this.
 */

import { cx } from "@/lib/cx";

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className={cx("mx-auto max-w-[1320px] px-4 pt-5 pb-10 sm:px-6 sm:pt-7 lg:px-[38px] lg:pt-[34px] lg:pb-15", className)}>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, sub, tools }: { title: string; sub?: React.ReactNode; tools?: React.ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-4 lg:mb-6.5 lg:gap-6">
      <div className="min-w-0">
        <h1 className="text-[23px] leading-[1.08] font-bold tracking-[-0.035em] sm:text-[26px] lg:text-[32px]">{title}</h1>
        {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
      </div>
      {tools && <div className="flex items-center gap-2.5">{tools}</div>}
    </header>
  );
}

/** A white card on the sheet; a hairline-bordered black one in dark mode. */
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-[18px] bg-surface p-4 shadow-[0_1px_2px_rgba(30,10,32,0.04)] sm:rounded-[22px] sm:p-[22px] dark:inset-ring dark:inset-ring-line dark:shadow-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
