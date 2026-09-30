import { CheckCircle, CloudArrowUp, DownloadSimple, FolderOpen, HardDrives, Key, Trash, WarningCircle, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useState, type ReactNode } from "react";
import { Button, Field, IconButton, Progress, Segmented, Select, TextInput } from "../components/ui";
import { errorMessage, ipc } from "../lib/ipc";
import { reportError, useApp } from "../store/app";

export const WHISPER_LANGUAGES = [
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

export const DEEPGRAM_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "multi", label: "Multilingual (code-switching)" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "ja", label: "Japanese" },
  { value: "hi", label: "Hindi" },
];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

function ApiKeyRow({ provider, name, help }: { provider: "deepgram"; name: string; help: ReactNode }) {
  const status = useApp((s) => s.keys[provider]);
  const refreshKeys = useApp((s) => s.refreshKeys);
  const toast = useApp((s) => s.toast);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"save" | "verify" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const saveKey = async () => {
    setBusy("save");
    setResult(null);
    try {
      await ipc.setKey(provider, draft);
      setDraft("");
      await refreshKeys();
      setBusy("verify");
      await ipc.verifyKey(provider);
      setResult({ ok: true, text: "Saved and verified." });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    setBusy("verify");
    setResult(null);
    try {
      await ipc.verifyKey(provider);
      setResult({ ok: true, text: "Key works." });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    try {
      await ipc.deleteKey(provider);
      await refreshKeys();
      setResult(null);
      toast({ tone: "neutral", title: `${name} key removed` });
    } catch (err) {
      reportError("Could not remove key", err);
    }
  };

  return (
    <div className="key-row">
      <div className="key-row-head">
        <div>
          <div className="strong">{name}</div>
          <div className="faint key-help">{help}</div>
        </div>
        {status ? (
          <span className="key-status is-set">
            <Key /> Saved, {status}
          </span>
        ) : (
          <span className="key-status">Not set</span>
        )}
      </div>
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void saveKey();
        }}
      >
        <Field label={status ? "Replace key" : "API key"}>
          <TextInput
            type="password"
            autoComplete="off"
            placeholder={status ? "Paste a new key" : "Paste your key"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <div className="key-actions">
          <Button type="submit" variant="primary" disabled={!draft.trim() || busy !== null}>
            {busy === "save" ? "Saving" : "Save"}
          </Button>
          {status && (
            <>
              <Button type="button" onClick={() => void verify()} disabled={busy !== null}>
                {busy === "verify" ? "Checking" : "Test"}
              </Button>
              <IconButton type="button" label={`Remove ${name} key`} onClick={() => void remove()}>
                <Trash />
              </IconButton>
            </>
          )}
        </div>
      </form>
      {result && (
        <p className={`key-result ${result.ok ? "is-ok" : "is-error"}`} role="status">
          {result.ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
          {result.text}
        </p>
      )}
    </div>
  );
}

function WhisperModels() {
  const models = useApp((s) => s.models);
  const selected = useApp((s) => s.settings.whisperModel);
  const updateSettings = useApp((s) => s.updateSettings);
  const refreshModels = useApp((s) => s.refreshModels);
  const runJob = useApp((s) => s.runJob);
  const jobs = useApp((s) => s.jobs);
  const cancelJob = useApp((s) => s.cancelJob);

  const download = async (id: string) => {
    try {
      await runJob({ kind: "model", label: `Whisper ${id}`, modelId: id, stage: "Downloading model" }, (jobId) =>
        ipc.downloadWhisperModel(jobId, id),
      );
      await refreshModels();
      if (!models.some((m) => m.installed)) void updateSettings({ whisperModel: id });
    } catch (err) {
      reportError("Model download failed", err);
    }
  };

  const remove = async (id: string) => {
    try {
      await ipc.deleteWhisperModel(id);
      await refreshModels();
    } catch (err) {
      reportError("Could not delete model", err);
    }
  };

  return (
    <div className="model-list" role="radiogroup" aria-label="Whisper model">
      {models.map((m) => {
        const job = Object.values(jobs).find((j) => j.kind === "model" && j.modelId === m.id);
        const active = selected === m.id;
        return (
          <div key={m.id} className={`model-row ${active ? "is-selected" : ""}`}>
            <button
              role="radio"
              aria-checked={active}
              className="model-pick"
              disabled={!m.installed}
              onClick={() => void updateSettings({ whisperModel: m.id })}
              title={m.installed ? "Use this model" : "Download to use"}
            >
              <span className="radio-dot" />
              <span className="model-text">
                <span className="strong">{m.label}</span>
                <span className="faint">{m.note}</span>
              </span>
            </button>
            <span className="mono faint model-size">{m.size}</span>
            <span className="model-action">
              {job ? (
                <span className="model-progress">
                  <Progress value={job.progress} label={`Downloading ${m.label}`} />
                  <IconButton size="sm" label="Cancel download" onClick={() => cancelJob(job.id)}>
                    <X />
                  </IconButton>
                </span>
              ) : m.installed ? (
                <IconButton size="sm" label={`Delete ${m.label}`} onClick={() => void remove(m.id)}>
                  <Trash />
                </IconButton>
              ) : (
                <Button size="sm" icon={<DownloadSimple />} onClick={() => void download(m.id)}>
                  Download
                </Button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SettingsView() {
  const settings = useApp((s) => s.settings);
  const sidecars = useApp((s) => s.sidecars);
  const updateSettings = useApp((s) => s.updateSettings);

  const chooseExportDir = async () => {
    const dir = await open({ directory: true, multiple: false, defaultPath: settings.exportDir ?? undefined });
    if (typeof dir === "string") void updateSettings({ exportDir: dir });
  };

  return (
    <div className="page">
      <div className="page-inner settings">
        <header className="page-header">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-sub">Transcription, keys and where finished files land.</p>
          </div>
        </header>

        <Section title="Transcription" description="Local keeps audio on this computer. Cloud is faster on long files and separates speakers.">
          <Segmented<"local" | "cloud">
            label="Default transcription mode"
            value={settings.transcriptionMode}
            onChange={(v) => void updateSettings({ transcriptionMode: v })}
            options={[
              { value: "local", label: <><HardDrives /> Local, Whisper</> },
              { value: "cloud", label: <><CloudArrowUp /> Cloud, Deepgram</> },
            ]}
          />
          <div className="settings-grid">
            <Field label="Whisper language" hint="English-only models always transcribe English.">
              <Select value={settings.whisperLanguage} options={WHISPER_LANGUAGES} onChange={(v) => void updateSettings({ whisperLanguage: v })} />
            </Field>
            <Field label="Deepgram language">
              <Select value={settings.deepgramLanguage} options={DEEPGRAM_LANGUAGES} onChange={(v) => void updateSettings({ deepgramLanguage: v })} />
            </Field>
          </div>
          <div className="settings-subhead">
            <h3>Whisper models</h3>
            <p className="faint">Downloaded once from Hugging Face, then used offline.</p>
          </div>
          <WhisperModels />
        </Section>

        <Section title="Deepgram" description="Optional. Stored in your system keychain and used only from the app backend, so the key never reaches the interface.">
          <ApiKeyRow
            provider="deepgram"
            name="Deepgram API key"
            help="Cloud transcription with speaker labels, plus topic, intent and sentiment detection that sharpens suggested moments. Create a key at console.deepgram.com."
          />
          <p className="faint panel-note">Finding moments always runs on this computer. Without a key it uses the transcript alone.</p>
        </Section>

        <Section title="Appearance">
          <Segmented<"system" | "light" | "dark">
            label="Theme"
            value={settings.theme}
            onChange={(v) => void updateSettings({ theme: v })}
            options={[
              { value: "system", label: "Match system" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Section>

        <Section title="Exports">
          <Field label="Save exported clips to">
            <div className="path-row">
              <span className="path mono truncate" title={settings.exportDir ?? ""} data-selectable>
                {settings.exportDir ?? "Not set"}
              </span>
              <Button icon={<FolderOpen />} onClick={() => void chooseExportDir()}>
                Change
              </Button>
            </div>
          </Field>
        </Section>

        <Section title="Media engine" description="FFmpeg and whisper.cpp ship inside the app.">
          <ul className="engine-list">
            {[
              { name: "FFmpeg", ok: sidecars?.ffmpeg },
              { name: "ffprobe", ok: sidecars?.ffprobe },
              { name: "whisper.cpp", ok: sidecars?.whisper },
            ].map((e) => (
              <li key={e.name} className={e.ok ? "is-ok" : "is-missing"}>
                {e.ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
                <span className="strong">{e.name}</span>
                <span className="faint">{e.ok ? "Bundled" : "Missing from this build"}</span>
              </li>
            ))}
          </ul>
          {sidecars && (!sidecars.ffmpeg || !sidecars.ffprobe || !sidecars.whisper) && (
            <p className="faint engine-note" data-selectable>
              Developer builds need the sidecar binaries in src-tauri/binaries. Run <code>pnpm sidecars</code>, then restart the app.
              Expected folder: {sidecars.folder}
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}
