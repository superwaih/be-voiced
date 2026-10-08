import { CheckCircle, CloudArrowUp, HardDrives, WarningCircle } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Button, Field, Modal, Select } from "../../components/ui";
import { transcribe } from "../../lib/actions";
import { duration } from "@be-voiced/engine/format";
import { useApp } from "../../store/app";
import { useProject } from "../../store/project";
import { DEEPGRAM_LANGUAGES, WHISPER_LANGUAGES } from "../SettingsView";

function Option({
  selected,
  onSelect,
  icon,
  title,
  body,
  status,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  body: string;
  status: { ok: boolean; text: string };
}) {
  return (
    <button role="radio" aria-checked={selected} className={`engine-option ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <span className="engine-option-icon">{icon}</span>
      <span className="engine-option-text">
        <span className="strong">{title}</span>
        <span className="muted">{body}</span>
        <span className={`engine-option-status ${status.ok ? "is-ok" : "is-missing"}`}>
          {status.ok ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}
          {status.text}
        </span>
      </span>
      <span className="radio-dot" />
    </button>
  );
}

export function TranscribeModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const project = useProject((s) => s.project)!;
  const settings = useApp((s) => s.settings);
  const models = useApp((s) => s.models);
  const keys = useApp((s) => s.keys);
  const sidecars = useApp((s) => s.sidecars);
  const updateSettings = useApp((s) => s.updateSettings);
  const setView = useApp((s) => s.setView);
  const [engine, setEngine] = useState<"local" | "cloud">(settings.transcriptionMode);

  const installed = models.filter((m) => m.installed);
  const modelOk = installed.some((m) => m.id === settings.whisperModel);
  const localReady = !!sidecars?.whisper && modelOk;
  const cloudReady = !!keys.deepgram;
  const ready = engine === "local" ? localReady : cloudReady;
  const replacing = !!project.transcript;

  const start = () => {
    onClose();
    void updateSettings({ transcriptionMode: engine });
    // onDone lets a caller chain the next step, like Clips running the moment finder straight after.
    void transcribe(engine).then((ok) => ok && onDone?.());
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={replacing ? "Transcribe again" : "Transcribe conversation"}
      width={560}
      footer={
        <>
          {!ready && (
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                setView("settings");
              }}
            >
              Open Settings
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={start}>
            Start transcription
          </Button>
        </>
      }
    >
      <p className="muted modal-lead">
        {duration(project.source.duration)} of audio.{" "}
        {replacing ? "The current transcript, topics and unsaved suggestions will be replaced. Saved clips stay." : ""}
      </p>
      <div className="engine-options" role="radiogroup" aria-label="Transcription engine">
        <Option
          selected={engine === "local"}
          onSelect={() => setEngine("local")}
          icon={<HardDrives />}
          title="Local with Whisper"
          body="Private and offline. Runs on this computer, so long files take a while. One speaker label."
          status={
            !sidecars?.whisper
              ? { ok: false, text: "whisper.cpp is missing from this build" }
              : modelOk
                ? { ok: true, text: `Ready with ${installed.find((m) => m.id === settings.whisperModel)?.label}` }
                : { ok: false, text: installed.length ? "Choose an installed model below" : "Download a model in Settings" }
          }
        />
        <Option
          selected={engine === "cloud"}
          onSelect={() => setEngine("cloud")}
          icon={<CloudArrowUp />}
          title="Cloud with Deepgram"
          body="Fast, with speaker labels, punctuation and word confidence. Audio is uploaded to Deepgram."
          status={cloudReady ? { ok: true, text: "API key saved" } : { ok: false, text: "Add a Deepgram API key in Settings" }}
        />
      </div>

      <div className="modal-fields">
        {engine === "local" ? (
          <>
            <Field label="Model">
              <Select
                value={modelOk ? settings.whisperModel : ""}
                disabled={!installed.length}
                options={installed.length ? installed.map((m) => ({ value: m.id, label: `${m.label}, ${m.size}` })) : [{ value: "", label: "No models downloaded" }]}
                onChange={(v) => v && void updateSettings({ whisperModel: v })}
              />
            </Field>
            <Field label="Language">
              <Select value={settings.whisperLanguage} options={WHISPER_LANGUAGES} onChange={(v) => void updateSettings({ whisperLanguage: v })} />
            </Field>
          </>
        ) : (
          <Field label="Language">
            <Select value={settings.deepgramLanguage} options={DEEPGRAM_LANGUAGES} onChange={(v) => void updateSettings({ deepgramLanguage: v })} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
