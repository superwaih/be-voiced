"use client";

/**
 * Settings: how recordings are transcribed, how the app looks, and what the service can do.
 *
 * There are no keys here. Transcription runs on our servers with our own credentials, which is the
 * whole point of the hosted version.
 */

import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Card, Page, PageHeader } from "@/components/Page";
import { Field, Segmented, Select } from "@/components/ui";
import { serviceCan } from "@/lib/api";
import { hasWebGPU } from "@/lib/transcribe";
import { LANGUAGES } from "@/components/workspace/TranscribeModal";
import { cx } from "@/lib/cx";
import type { Theme } from "@/lib/theme";
import { useApp } from "@/store/app";
import { useShell } from "@/store/shell";

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-b border-line py-6 first:pt-0 last:border-0 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6">
      <div>
        <h2 className="font-bold tracking-[-0.02em]">{title}</h2>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsScreen() {
  const settings = useApp((s) => s.settings);
  const models = useApp((s) => s.models);
  const updateSettings = useApp((s) => s.updateSettings);
  const theme = useShell((s) => s.theme);
  const setTheme = useShell((s) => s.setTheme);
  const [gpu, setGpu] = useState<boolean | null>(null);

  useEffect(() => {
    void hasWebGPU().then(setGpu);
  }, []);

  const capabilities = [
    {
      name: "Transcription",
      ok: serviceCan.transcribe,
      note: serviceCan.transcribe
        ? gpu === false
          ? "Whisper, in this browser, on the processor"
          : "Whisper, in this browser, on your graphics card"
        : "This browser cannot run it",
    },
    { name: "Media handling", ok: true, note: "Duration, thumbnails and waveforms, in this browser" },
    { name: "Moments and answers", ok: true, note: "Read from the transcript, in this browser" },
    {
      name: "Rendering video",
      ok: serviceCan.renderVideo,
      note: serviceCan.renderVideo
        ? "Captions burned in with WebCodecs, in this browser"
        : "This browser cannot encode video",
    },
    { name: "Link downloads", ok: false, note: "Desktop only" },
  ];

  return (
    <Page>
      <PageHeader title="Settings" sub="Transcription, quality and how the app looks." />

      <Card className="p-0 sm:p-0">
        <div className="px-4 sm:px-[22px]">
          <Section
            title="Transcription"
            description="Whisper runs on this machine, in your browser. Your recording is never uploaded, and there is nothing to queue behind."
          >
            {!serviceCan.transcribe && (
              <p className="rounded-panel bg-danger-soft p-3 text-[13px]">
                <strong>This browser cannot run it.</strong>{" "}
                <span className="text-muted">
                  Transcription needs web workers and WebAssembly. A current version of Chrome, Edge, Firefox or Safari will
                  do it.
                </span>
              </p>
            )}
            <Field label="Language" hint="English-only quality settings always transcribe English.">
              <Select
                value={settings.whisperLanguage}
                options={LANGUAGES}
                onChange={(v) => void updateSettings({ whisperLanguage: v })}
                className="max-w-xs"
              />
            </Field>

            <div>
              <h3 className="text-[12.5px] font-semibold text-muted">Quality</h3>
              <p className="mt-0.5 text-xs text-faint">
                Each downloads its model once, the first time you use it, and the browser keeps it afterwards.
              </p>
              <div role="radiogroup" aria-label="Quality" className="mt-2.5 flex flex-col gap-2">
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
            </div>
          </Section>

          <Section title="Appearance">
            <Field label="Theme">
              <Segmented<Theme>
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "system", label: "Match system" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </Field>
          </Section>

          <Section title="Exports">
            <p className="text-muted">
              Finished files download the way everything else does, to wherever your browser keeps downloads.
            </p>
          </Section>

          <Section title="What the service does" description="Audio is processed on our servers. Nothing is installed in your browser.">
            <ul className="flex flex-col gap-2">
              {capabilities.map((c) => (
                <li key={c.name} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 text-[13px]">
                  <span className={cx("mt-0.5 [&_svg]:size-4", c.ok ? "text-accent-text" : "text-faint")}>
                    {c.ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
                  </span>
                  <span className="font-semibold">{c.name}</span>
                  <span className="col-start-2 text-xs text-faint">{c.note}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-faint">
              Recordings are kept in this browser, so clearing site data clears them.
            </p>
          </Section>
        </div>
      </Card>
    </Page>
  );
}
