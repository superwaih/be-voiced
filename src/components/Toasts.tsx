import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "../store/app";
import { Button, IconButton } from "./ui";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className={`toast is-${t.tone}`}
            role={t.tone === "error" ? "alert" : "status"}
          >
            {t.tone === "success" ? <CheckCircle weight="fill" /> : t.tone === "error" ? <WarningCircle weight="fill" /> : <Info weight="fill" />}
            <div>
              <div className="toast-title">{t.title}</div>
              {t.body && (
                <div className="toast-body" data-selectable>
                  {t.body}
                </div>
              )}
              {t.action && (
                <div className="toast-action">
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
