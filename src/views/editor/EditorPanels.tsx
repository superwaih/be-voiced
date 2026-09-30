import { CaretDown, CheckCircle, FilmStrip, FolderOpen, Minus, Play, Plus, Subtitles, X } from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ColorInput, Field, IconButton, Modal, Progress, Segmented, Select, Slider, Switch, TextInput } from "../../components/ui";
import { exportClipCaptions, exportClipVideo, outputFrame } from "../../lib/actions";
import { CAPTION_FONTS, CAPTION_PRESETS, previewVars } from "../../lib/captions";
import { bytes, clock, relativeDate } from "../../lib/format";
import { ipc } from "../../lib/ipc";
import { player, usePlayerTime } from "../../lib/player";
import { CATEGORY_LABEL } from "../../lib/project";
import { buildUnits, nudgeBySentence, wordAt, type FlatWord } from "../../lib/transcript";
import type { CaptionStyle, Clip, ExportRecord, Resolution } from "../../lib/types";
import { reportError, useApp } from "../../store/app";
import { useProject } from "../../store/project";

/** One titled block in the editor's side column. */
function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="block">
      <div className="block-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// --- Clip ----------------------------------------------------------------------------------------

export function ClipPanel({ clip }: { clip: Clip }) {
  const project = useProject((s) => s.project)!;
  const updateClip = useProject((s) => s.updateClip);
  const units = useMemo(() => buildUnits(project.transcript), [project.transcript]);
  const length = clip.end - clip.start;
  const src = project.source;
  const frame = outputFrame(project, clip.aspect, 1080);
  const cropped = src.hasVideo && Math.abs((src.width ?? 16) / (src.height ?? 9) - frame.width / frame.height) > 0.01;

  const nudge = (edge: "start" | "end", dir: -1 | 1) =>
    updateClip(clip.id, nudgeBySentence(units, clip.start, clip.end, edge, dir), { coalesce: `nudge-${clip.id}` });

  return (
    <>
      <Block title="Length" aside={<span className="mono block-value">{clock(length, { tenths: true })}</span>}>
        <div className="chip-rows">
          <div className="chip-row">
            <button className="chip" onClick={() => nudge("start", -1)}>
              <Plus /> sentence before
            </button>
            <button className="chip is-quiet" onClick={() => nudge("start", 1)} title="Remove the first sentence" aria-label="Remove the first sentence">
              <Minus />
            </button>
          </div>
          <div className="chip-row">
            <button className="chip" onClick={() => nudge("end", 1)}>
              <Plus /> sentence after
            </button>
            <button className="chip is-quiet" onClick={() => nudge("end", -1)} title="Remove the last sentence" aria-label="Remove the last sentence">
              <Minus />
            </button>
          </div>
        </div>
        <p className="faint block-note">
          {length > 95 ? "Long for social. " : length < 25 ? "Very short. " : ""}
          Whole sentences only, so nobody is cut off mid-thought.
        </p>
      </Block>

      {cropped && (
        <Block title="Framing">
          <Slider
            label="Horizontal position"
            min={0}
            max={1}
            step={0.01}
            value={clip.framing}
            format={(v) => (v < 0.4 ? "Left" : v > 0.6 ? "Right" : "Center")}
            onChange={(framing) => updateClip(clip.id, { framing }, { coalesce: `framing-${clip.id}` })}
          />
        </Block>
      )}
      {!src.hasVideo && <p className="faint block-note">Audio only, so exports place captions over a dark frame.</p>}

      {(clip.why || clip.summary) && (
        <Block title="Why it was picked">
          {clip.category && <span className="block-tag">{CATEGORY_LABEL[clip.category]}</span>}
          {clip.summary && <p className="block-text">{clip.summary}</p>}
          {clip.why && <p className="block-text muted">{clip.why}</p>}
        </Block>
      )}
    </>
  );
}

export function ClipTranscript({ words }: { words: FlatWord[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const activeRef = useRef(-1);
  usePlayerTime(
    (t) => {
      const idx = wordAt(words, t);
      if (idx === activeRef.current || !ref.current) return;
      ref.current.children[activeRef.current]?.classList.remove("is-now");
      ref.current.children[idx]?.classList.add("is-now");
      activeRef.current = idx;
    },
    [words],
  );
  if (!words.length) return <p className="faint">No words in this range.</p>;
  return (
    <p ref={ref} className="clip-words" data-selectable>
      {words.map((w) => (
        <span key={w.i} onClick={() => player.seek(w.start)}>
          {w.text}{" "}
        </span>
      ))}
    </p>
  );
}

// --- Captions -------------------------------------------------------------------------------------

export function CaptionsPanel({ clip }: { clip: Clip }) {
  const updateClip = useProject((s) => s.updateClip);
  const [expanded, setExpanded] = useState(false);
  const style = clip.captions;
  const set = (patch: Partial<CaptionStyle>) =>
    updateClip(clip.id, (c) => ({ captions: { ...c.captions, ...patch, presetId: "custom" } }), {
      coalesce: `captions-${clip.id}-${Object.keys(patch).join()}`,
    });

  return (
    <Block
      title="Captions"
      aside={<Switch label="Captions on" checked={clip.captionsEnabled} onChange={(v) => updateClip(clip.id, { captionsEnabled: v })} />}
    >
      <fieldset className="caption-fields" disabled={!clip.captionsEnabled}>
        <div className="preset-grid">
          {CAPTION_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset ${style.presetId === p.id ? "is-selected" : ""}`}
              aria-pressed={style.presetId === p.id}
              onClick={() => updateClip(clip.id, { captions: { ...p.style } })}
              title={p.description}
            >
              <span className="preset-sample" style={previewVars(p.style) as React.CSSProperties}>
                <span className="cap-text" style={{ fontWeight: p.style.bold ? 700 : 400 }}>
                  <span className="cap-word">{p.style.uppercase ? "SAY " : "Say "}</span>
                  <span className={`cap-word ${p.style.activeWord ? "is-active" : ""}`}>{p.style.uppercase ? "IT" : "it"}</span>
                </span>
              </span>
              <span className="preset-name">{p.name}</span>
            </button>
          ))}
        </div>

        <button className={`disclosure ${expanded ? "is-open" : ""}`} onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          Customize style <CaretDown />
        </button>

        {expanded && (
          <div className="custom-style">
            <div className="field-grid">
              <Field label="Font">
                <Select value={style.font} options={CAPTION_FONTS.map((f) => ({ value: f, label: f }))} onChange={(font) => set({ font })} />
              </Field>
              <Field label="Words per caption">
                <Slider label="Words per caption" min={1} max={10} value={style.wordsPerCaption} onChange={(wordsPerCaption) => set({ wordsPerCaption })} />
              </Field>
            </div>
            <Field label="Size">
              <Slider label="Caption size" min={24} max={120} value={style.size} onChange={(size) => set({ size })} />
            </Field>
            <div className="switch-row">
              <label>
                <Switch label="Bold" checked={style.bold} onChange={(bold) => set({ bold })} /> Bold
              </label>
              <label>
                <Switch label="Uppercase" checked={style.uppercase} onChange={(uppercase) => set({ uppercase })} /> Uppercase
              </label>
            </div>
            <div className="field-grid">
              <Field label="Color">
                <ColorInput label="Text color" value={style.color} onChange={(color) => set({ color })} />
              </Field>
              <Field label="Active word">
                <div className="inline-controls">
                  <Switch label="Highlight active word" checked={style.activeWord} onChange={(activeWord) => set({ activeWord })} />
                  <ColorInput label="Active word color" value={style.highlightColor} onChange={(highlightColor) => set({ highlightColor })} />
                </div>
              </Field>
            </div>
            <div className="control-row">
              <span>Outline</span>
              <Switch label="Outline" checked={style.outline} disabled={style.background} onChange={(outline) => set({ outline })} />
              <ColorInput label="Outline color" value={style.outlineColor} onChange={(outlineColor) => set({ outlineColor })} />
            </div>
            {style.outline && !style.background && (
              <Slider label="Outline width" min={1} max={12} value={style.outlineWidth} onChange={(outlineWidth) => set({ outlineWidth })} />
            )}
            <div className="control-row">
              <span>Shadow</span>
              <Switch label="Shadow" checked={style.shadow} disabled={style.background} onChange={(shadow) => set({ shadow })} />
              <ColorInput label="Shadow color" value={style.shadowColor} onChange={(shadowColor) => set({ shadowColor })} />
            </div>
            <div className="control-row">
              <span>Background</span>
              <Switch label="Background box" checked={style.background} onChange={(background) => set({ background })} />
              <ColorInput label="Background color" value={style.backgroundColor} onChange={(backgroundColor) => set({ backgroundColor })} />
            </div>
            {style.background && (
              <Slider
                label="Background opacity"
                min={0.2}
                max={1}
                step={0.01}
                value={style.backgroundOpacity}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(backgroundOpacity) => set({ backgroundOpacity })}
              />
            )}
            <Field label="Position">
              <Segmented
                label="Caption position"
                size="sm"
                value={style.position}
                onChange={(position) => set({ position })}
                options={[
                  { value: "top", label: "Top" },
                  { value: "middle", label: "Middle" },
                  { value: "bottom", label: "Bottom" },
                ]}
              />
            </Field>
            {style.position !== "middle" && (
              <Field label="Distance from edge">
                <Slider label="Distance from edge" min={0} max={40} value={style.offset} format={(v) => `${v}%`} onChange={(offset) => set({ offset })} />
              </Field>
            )}
          </div>
        )}
      </fieldset>
    </Block>
  );
}

// --- Export ---------------------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  clip: "Video",
  captioned: "Video with captions",
  srt: "SRT captions",
  vtt: "VTT captions",
};

export function ExportDialog({ clip, open: isOpen, onClose }: { clip: Clip; open: boolean; onClose: () => void }) {
  const project = useProject((s) => s.project)!;
  const updateClip = useProject((s) => s.updateClip);
  const exportDir = useApp((s) => s.settings.exportDir);
  const updateSettings = useApp((s) => s.updateSettings);
  const job = useApp((s) => Object.values(s.jobs).find((j) => j.kind === "export" && j.clipId === clip.id));
  const cancel = useApp((s) => s.cancelJob);
  const [fileName, setFileName] = useState(clip.title);
  const [last, setLast] = useState<ExportRecord | null>(null);
  useEffect(() => setFileName(clip.title), [clip.title]);

  const frame = outputFrame(project, clip.aspect, clip.resolution);
  const hasWords = !!project.transcript;
  const history = [...clip.exports].reverse();

  const run = async () => {
    setLast(null);
    const rec = await exportClipVideo(clip, {
      burnCaptions: clip.captionsEnabled && hasWords,
      resolution: clip.resolution,
      fileName: fileName || clip.title,
    });
    if (rec) setLast(rec);
  };

  const chooseDir = async () => {
    const dir = await open({ directory: true, multiple: false, defaultPath: exportDir ?? undefined });
    if (typeof dir === "string") void updateSettings({ exportDir: dir });
  };

  const openFile = async (path: string, reveal: boolean) => {
    try {
      if (!(await ipc.pathExists(path))) throw new Error("That file was moved or deleted.");
      await (reveal ? ipc.revealPath(path) : ipc.openPath(path));
    } catch (err) {
      reportError("Could not open export", err);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Export clip"
      width={560}
      footer={
        job ? (
          <>
            <span className="export-status mono">
              {job.stage}
              {job.progress !== null ? ` ${Math.round(job.progress * 100)}%` : ""}
            </span>
            <Button icon={<X />} onClick={() => cancel(job.id)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" icon={<FilmStrip />} onClick={() => void run()}>
              Export video
            </Button>
          </>
        )
      }
    >
      <div className="export-sheet">
        <dl className="export-summary">
          <dt>Frame</dt>
          <dd className="mono">
            {clip.aspect === "original" ? "Original" : clip.aspect}, {frame.width} x {frame.height}
          </dd>
          <dt>Length</dt>
          <dd className="mono">{clock(clip.end - clip.start, { tenths: true })}</dd>
        </dl>

        <div className="field-grid">
          <Field label="Resolution">
            <Segmented<Resolution>
              label="Resolution"
              size="sm"
              value={clip.resolution}
              onChange={(resolution) => updateClip(clip.id, { resolution })}
              options={[
                { value: 720, label: "720p" },
                { value: 1080, label: "1080p" },
              ]}
            />
          </Field>
          <Field label="Captions">
            <div className="inline-controls">
              <Switch
                label="Burn in captions"
                checked={clip.captionsEnabled}
                disabled={!hasWords}
                onChange={(v) => updateClip(clip.id, { captionsEnabled: v })}
              />
              <span className="faint">{clip.captionsEnabled && hasWords ? "Burned in" : "None"}</span>
            </div>
          </Field>
        </div>

        <Field label="File name">
          <TextInput value={fileName} onChange={(e) => setFileName(e.target.value)} />
        </Field>
        <Field label="Save to">
          <div className="path-row">
            <span className="path mono truncate" title={exportDir ?? ""}>
              {exportDir ?? "Videos folder"}
            </span>
            <IconButton label="Change folder" onClick={() => void chooseDir()}>
              <FolderOpen />
            </IconButton>
          </div>
        </Field>

        {job && <Progress value={job.progress} label="Export progress" />}

        {last && !job && (
          <div className="export-done" role="status">
            <CheckCircle weight="fill" />
            <div className="export-done-text">
              <strong>Exported</strong>
              <span className="faint truncate" title={last.path}>
                {last.path}
              </span>
            </div>
            <div className="export-done-actions">
              <Button size="sm" icon={<Play />} onClick={() => void openFile(last.path, false)}>
                Open
              </Button>
              <Button size="sm" icon={<FolderOpen />} onClick={() => void openFile(last.path, true)}>
                Show
              </Button>
            </div>
          </div>
        )}

        <div className="export-extras">
          <div>
            <span className="field-label">Caption files</span>
            <div className="button-row">
              <Button size="sm" icon={<Subtitles />} disabled={!hasWords} onClick={() => void exportClipCaptions(clip, "srt")}>
                SRT
              </Button>
              <Button size="sm" icon={<Subtitles />} disabled={!hasWords} onClick={() => void exportClipCaptions(clip, "vtt")}>
                VTT
              </Button>
            </div>
          </div>
          {history.length > 0 && (
            <div className="export-history-wrap">
              <span className="field-label">Earlier exports</span>
              <ul className="export-history">
                {history.slice(0, 4).map((e) => (
                  <li key={e.id}>
                    <div className="export-history-text">
                      <span className="strong">{KIND_LABEL[e.kind] ?? e.kind}</span>
                      <span className="faint">
                        {relativeDate(e.createdAt)}
                        {e.resolution ? `, ${e.resolution}p` : ""}
                        {e.bytes ? `, ${bytes(e.bytes)}` : ""}
                      </span>
                    </div>
                    <IconButton size="sm" label="Open" onClick={() => void openFile(e.path, false)}>
                      <Play />
                    </IconButton>
                    <IconButton size="sm" label="Show in folder" onClick={() => void openFile(e.path, true)}>
                      <FolderOpen />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
