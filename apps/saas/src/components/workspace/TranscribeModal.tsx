"use client";

/**
 * Choosing how carefully to transcribe, and starting it.
 *
 * Both options run on our servers; the choice is quality against time, which is why the labels say
 * that rather than naming a model file.
 */

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button, Field, Modal, Select } from "@/components/ui";
import { transcribe } from "@/lib/actions";
import { serviceCan } from "@/lib/api";
import { hasWebGPU } from "@/lib/transcribe";
import { RUNTIME_SIZE } from "@/lib/transcribe/models";
import { cx } from "@/lib/cx";
import { duration } from "@/lib/engine/format";
import { useApp } from "@/store/app";
import { useProject } from "@/store/project";

export const LANGUAGES = [
  { value: "auto", label: "Detect automatically" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "hi", label: "Hindi" },
];

export function TranscribeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const settings = useApp((s) => s.settings);
  const models = useApp((s) => s.models);
  const updateSettings = useApp((s) => s.updateSettings);
  const [busy, setBusy] = useState(false);

  const replacing = !!project.transcript;
  const ready = serviceCan.transcribe;
  const [gpu, setGpu] = useState<boolean | null>(null);

  useEffect(() => {
    void hasWebGPU().then(setGpu);
  }, []);

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Transcribe recording"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !ready}
            onClick={async () => {
              setBusy(true);
              onClose();
              await transcribe();
              setBusy(false);
            }}
          >
            Start transcription
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          {duration(project.source.duration)} of audio.{" "}
          {replacing && "The current transcript, topics and unreviewed suggestions will be replaced. Saved clips stay."}
        </p>

        {!ready && (
          <div className="flex items-start gap-2.5 rounded-panel bg-danger-soft p-3 text-[13px] [&_svg]:size-[18px] [&_svg]:shrink-0">
            <WarningCircle weight="fill" className="mt-px text-danger" />
            <div>
              <strong>This browser cannot transcribe</strong>
              <p className="mt-0.5 text-muted">
                Transcription needs web workers and WebAssembly. A current version of Chrome, Edge, Firefox or Safari
                will do it.
              </p>
            </div>
          </div>
        )}

        <div role="radiogroup" aria-label="Quality" className="flex flex-col gap-2">
          {models.map((m) => {
            const on = settings.whisperModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void updateSettings({ whisperModel: m.id })}
                className={cx(
                  "flex items-start gap-3 rounded-panel border p-3 text-left transition-colors",
                  on ? "border-accent-line bg-accent-surface" : "border-line-strong hover:bg-hover",
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2",
                    on ? "border-accent" : "border-line-strong",
                  )}
                >
                  {on && <span className="size-1.5 rounded-full bg-accent" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <strong>{m.label}</strong>
                    <span className="mono text-xs text-faint">{m.size}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">{m.note}</span>
                </span>
              </button>
            );
          })}
        </div>

        <Field label="Language" hint="English-only quality settings always transcribe English.">
          <Select
            value={settings.whisperLanguage}
            options={LANGUAGES}
            onChange={(v) => void updateSettings({ whisperLanguage: v })}
          />
        </Field>

        {ready && (
          <div className="flex flex-col gap-1 text-xs text-faint">
            <p className="flex items-center gap-1.5 [&_svg]:size-4">
              <CheckCircle weight="fill" className="shrink-0 text-accent-text" />
              Runs on this machine. Your recording is never uploaded.
            </p>
            <p className="flex items-center gap-1.5 [&_svg]:size-4">
              <CheckCircle weight="fill" className="shrink-0 text-accent-text" />
              {gpu === null
                ? "Checking what this machine can do."
                : gpu
                  ? "Using your graphics card, which is much the quicker way."
                  : "This browser has no WebGPU, so it runs on the processor and takes longer."}
            </p>
            <p className="mt-1">
              The model downloads once the first time and stays cached, with {RUNTIME_SIZE} for the runtime on the very
              first run.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
