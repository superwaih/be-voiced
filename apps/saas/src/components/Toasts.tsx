"use client";

import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { Button, IconButton } from "@/components/ui";
import { cx } from "@/lib/cx";
import { useApp } from "@/store/app";

const TONE = {
  success: "text-accent-text",
  error: "text-danger",
  neutral: "text-muted",
};

/** Brief notices, bottom right on a laptop and across the bottom on a phone. */
export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[min(380px,calc(100vw-2rem))]"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-2.5 rounded-panel bg-surface p-3 shadow-pop"
          >
            <span className={cx("mt-px shrink-0 [&_svg]:size-[18px]", TONE[t.tone])}>
              {t.tone === "success" ? (
                <CheckCircle weight="fill" />
              ) : t.tone === "error" ? (
                <WarningCircle weight="fill" />
              ) : (
                <Info weight="fill" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t.title}</div>
              {t.body && (
                <div className="mt-0.5 text-xs break-words text-muted" data-selectable>
                  {t.body}
                </div>
              )}
              {t.action && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      t.action!.run();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </Button>
                </div>
              )}
            </div>
            <IconButton label="Dismiss" size="sm" onClick={() => dismiss(t.id)}>
              <X />
            </IconButton>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
