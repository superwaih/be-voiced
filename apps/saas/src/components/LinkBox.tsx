"use client";

/**
 * Pasting a link.
 *
 * Two steps on purpose. The probe reads the link and shows what it found — title, who posted it,
 * how long — before anything is downloaded, so a wrong link is obvious before it costs a hundred
 * megabytes. Only then does Add fetch it.
 *
 * Errors stay next to the box rather than in a toast: a download that stops has to say why
 * somewhere that stays put long enough to read.
 */

import { ArrowRight, LinkSimple, WarningCircle, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobCard } from "@/components/JobCard";
import { Button, IconButton, TextInput } from "@/components/ui";
import { importLink } from "@/lib/actions";
import { probeLink } from "@/lib/links";
import { duration as fmtDuration } from "@/lib/engine/format";
import type { LinkInfo } from "@/lib/engine/types";
import { useApp } from "@/store/app";

export function LinkBox({ onAdded }: { onAdded?: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [found, setFound] = useState<LinkInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "import"));
  const router = useRouter();

  const reset = () => {
    setFound(null);
    setError(null);
  };

  const probe = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      setFound(await probeLink(trimmed));
    } catch (err) {
      setFound(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async (info: LinkInfo) => {
    setBusy(true);
    setError(null);
    const result = await importLink(url.trim(), info);
    setBusy(false);
    if (result.ok) {
      setUrl("");
      reset();
      onAdded?.(result.id);
      router.push(`/project/${result.id}`);
    } else if (!result.cancelled) {
      setError(result.error);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (found ? add(found) : probe());
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <TextInput
          icon={<LinkSimple />}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            reset();
          }}
          placeholder="Paste a podcast, episode or media link"
          aria-label="Link to a recording"
          inputMode="url"
          spellCheck={false}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="primary" disabled={!url.trim() || busy} icon={<ArrowRight />}>
          {busy ? (found ? "Adding" : "Reading") : found ? "Add" : "Look"}
        </Button>
      </form>

      {job && <JobCard job={job} title={job.label === "Importing" ? "Reading media" : `Downloading ${job.label}`} />}

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-panel bg-danger-soft p-3 text-[13px] [&_svg]:size-[18px] [&_svg]:shrink-0">
          <WarningCircle weight="fill" className="mt-px text-danger" />
          <div className="min-w-0 flex-1">
            <p data-selectable>{error}</p>
            {!!url.trim() && (
              <button
                type="button"
                onClick={() => void (found ? add(found) : probe())}
                className="mt-1 text-accent-text hover:underline"
              >
                Try again
              </button>
            )}
          </div>
          <IconButton size="sm" label="Dismiss" onClick={() => setError(null)}>
            <X />
          </IconButton>
        </div>
      )}

      <AnimatePresence>
        {found && !job && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-3 rounded-panel bg-sunken p-3"
          >
            {found.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail from the link
              <img src={found.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-[10px] object-cover" />
            ) : (
              <span className="grid h-12 w-20 shrink-0 place-items-center rounded-[10px] bg-cover text-cover-ink/60">
                <LinkSimple size={18} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{found.title}</p>
              <p className="truncate text-xs text-faint">
                {[found.site, found.uploader, found.duration ? fmtDuration(found.duration) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {found.isLive && <span className="shrink-0 text-xs text-danger">Live</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
