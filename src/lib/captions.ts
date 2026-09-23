import { assTime, srtTime, vttTime } from "./format";
import type { CaptionStyle, Transcript, Word } from "./types";

/**
 * Caption engine shared by the live preview, SRT/VTT export and burned-in (ASS) export,
 * so what you see in the editor is what FFmpeg renders.
 */

export const CAPTION_FONTS = ["Arial", "Arial Black", "Verdana", "Trebuchet MS", "Tahoma", "Georgia", "Impact"] as const;

/**
 * libass sizes fonts by their line height, CSS by the em box. These ratios (ascent + descent / em
 * from each font's metrics) keep burned-in captions the same size as the preview.
 */
const LIBASS_SIZE_RATIO: Record<string, number> = {
  Arial: 1.117,
  "Arial Black": 1.41,
  Verdana: 1.215,
  "Trebuchet MS": 1.161,
  Tahoma: 1.207,
  Georgia: 1.136,
  Impact: 1.22,
};

export const CAPTION_PRESETS: { id: string; name: string; description: string; style: CaptionStyle }[] = [
  {
    id: "studio",
    name: "Studio",
    description: "Clean white with a violet active word",
    style: {
      presetId: "studio",
      font: "Arial",
      size: 58,
      bold: true,
      uppercase: false,
      color: "#FFFFFF",
      activeWord: true,
      highlightColor: "#B8A9FF",
      outline: true,
      outlineColor: "#121118",
      outlineWidth: 4,
      shadow: false,
      shadowColor: "#000000",
      background: false,
      backgroundColor: "#121118",
      backgroundOpacity: 0.7,
      position: "bottom",
      offset: 12,
      wordsPerCaption: 5,
    },
  },
  {
    id: "punch",
    name: "Punch",
    description: "Big, three words at a time",
    style: {
      presetId: "punch",
      font: "Arial Black",
      size: 76,
      bold: false,
      uppercase: true,
      color: "#FFFFFF",
      activeWord: true,
      highlightColor: "#F2D65C",
      outline: true,
      outlineColor: "#000000",
      outlineWidth: 7,
      shadow: true,
      shadowColor: "#000000",
      background: false,
      backgroundColor: "#000000",
      backgroundOpacity: 0.7,
      position: "middle",
      offset: 0,
      wordsPerCaption: 3,
    },
  },
  {
    id: "subtitle",
    name: "Subtitle",
    description: "Readable lines on a soft box",
    style: {
      presetId: "subtitle",
      font: "Verdana",
      size: 42,
      bold: false,
      uppercase: false,
      color: "#F5F4FA",
      activeWord: false,
      highlightColor: "#B8A9FF",
      outline: false,
      outlineColor: "#000000",
      outlineWidth: 3,
      shadow: false,
      shadowColor: "#000000",
      background: true,
      backgroundColor: "#121118",
      backgroundOpacity: 0.72,
      position: "bottom",
      offset: 7,
      wordsPerCaption: 7,
    },
  },
];

export const defaultCaptionStyle = (): CaptionStyle => ({ ...CAPTION_PRESETS[0].style });

export interface CaptionGroup {
  start: number;
  end: number;
  words: Word[];
}

/** Group words into captions: by count, sentence ends, pauses and line length. Times are relative to `offset`. */
export function groupCaptions(words: Word[], wordsPerCaption: number, offset = 0): CaptionGroup[] {
  const maxChars = Math.max(14, wordsPerCaption * 8);
  const groups: CaptionGroup[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    groups.push({ start: cur[0].start - offset, end: cur[cur.length - 1].end - offset, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = { ...words[i] };
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
      // Let a sentence's last word ride along instead of stranding it alone on the next caption.
      const closesSentence = cur.length === wordsPerCaption && wordsPerCaption > 1 && /[.?!]["')\]]*$/.test(w.text) && chars <= maxChars + 10;
      if ((cur.length >= wordsPerCaption && !closesSentence) || /[.?!]["')\]]*$/.test(prev.text) || gap > 0.75 || chars > maxChars + (closesSentence ? 10 : 0)) flush();
    }
    cur.push(w);
  }
  flush();
  // Hold each caption until the next one starts when the gap is short, so text does not flicker.
  for (let i = 0; i < groups.length; i++) {
    const next = groups[i + 1];
    const hold = groups[i].end + 0.35;
    groups[i].end = next && next.start - groups[i].end < 0.9 ? next.start : next ? Math.min(hold, next.start) : hold;
  }
  return groups;
}

const displayText = (text: string, style: CaptionStyle) => (style.uppercase ? text.toUpperCase() : text);

// --- SRT / VTT -------------------------------------------------------------------------------

export function toSrt(groups: CaptionGroup[], style?: CaptionStyle): string {
  return groups
    .map((g, i) => {
      const text = g.words.map((w) => (style ? displayText(w.text, style) : w.text)).join(" ");
      return `${i + 1}\n${srtTime(g.start)} --> ${srtTime(g.end)}\n${text}\n`;
    })
    .join("\n");
}

export function toVtt(groups: CaptionGroup[], style?: CaptionStyle): string {
  const body = groups
    .map((g) => {
      const text = g.words.map((w) => (style ? displayText(w.text, style) : w.text)).join(" ");
      return `${vttTime(g.start)} --> ${vttTime(g.end)}\n${text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

/** Full-transcript subtitles with speaker labels on turn changes. */
export function transcriptSubtitles(t: Transcript, format: "srt" | "vtt"): string {
  const names = new Map(t.speakers.map((s) => [s.id, s.name]));
  const cues: CaptionGroup[] = [];
  let lastSpeaker = "";
  for (const seg of t.segments) {
    const groups = groupCaptions(seg.words, 12);
    groups.forEach((g, idx) => {
      if (idx === 0 && t.speakers.length > 1 && seg.speaker !== lastSpeaker) {
        g.words = [{ ...g.words[0], text: `${names.get(seg.speaker) ?? seg.speaker}: ${g.words[0].text}` }, ...g.words.slice(1)];
      }
      cues.push(g);
    });
    lastSpeaker = seg.speaker;
  }
  return format === "srt" ? toSrt(cues) : toVtt(cues);
}

export function transcriptText(t: Transcript, title: string): string {
  const names = new Map(t.speakers.map((s) => [s.id, s.name]));
  const lines = [title, ""];
  for (const seg of t.segments) {
    const h = Math.floor(seg.start / 3600);
    const m = Math.floor((seg.start % 3600) / 60);
    const s = Math.floor(seg.start % 60);
    const stamp = `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    lines.push(`[${stamp}] ${names.get(seg.speaker) ?? seg.speaker}`);
    lines.push(seg.words.map((w) => w.text).join(" "));
    lines.push("");
  }
  return lines.join("\n");
}

// --- ASS (burned-in) -------------------------------------------------------------------------

/** "#RRGGBB" + opacity -> ASS "&HAABBGGRR" (alpha 00 = opaque). */
function assColor(hex: string, opacity = 1): string {
  const clean = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255)
    .toString(16)
    .padStart(2, "0");
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

const escapeAss = (text: string) => text.replace(/\\/g, "⧵").replace(/[{}]/g, (c) => (c === "{" ? "(" : ")"));

export function buildAss(groups: CaptionGroup[], style: CaptionStyle, width: number, height: number): string {
  const unit = Math.min(width, height) / 1080;
  const fontSize = Math.round(style.size * unit * (LIBASS_SIZE_RATIO[style.font] ?? 1.15));
  const alignment = style.position === "top" ? 8 : style.position === "middle" ? 5 : 2;
  const marginV = style.position === "middle" ? 0 : Math.round((style.offset / 100) * height);
  const marginH = Math.round(width * 0.08);
  const boxed = style.background;
  const outline = boxed ? Math.round(style.size * unit * 0.28) : style.outline ? Math.max(0, style.outlineWidth * unit) : 0;
  const shadow = !boxed && style.shadow ? Math.max(1, Math.round(style.size * unit * 0.05)) : 0;
  const outlineColour = boxed ? assColor(style.backgroundColor, style.backgroundOpacity) : assColor(style.outlineColor);
  const backColour = boxed ? assColor(style.backgroundColor, style.backgroundOpacity) : assColor(style.shadowColor, 0.85);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${style.font},${fontSize},${assColor(style.color)},${assColor(style.color)},${outlineColour},${backColour},${style.bold ? -1 : 0},0,0,0,100,100,0,0,${boxed ? 3 : 1},${outline.toFixed(1)},${shadow},${alignment},${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events: string[] = [];
  // Override tags take &HBBGGRR& without the alpha byte.
  const highlight = assColor(style.highlightColor).replace(/^&H[0-9A-F]{2}/, "&H");
  for (const g of groups) {
    const texts = g.words.map((w) => escapeAss(displayText(w.text, style)));
    if (!style.activeWord) {
      events.push(`Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Caption,,0,0,0,,${texts.join(" ")}`);
      continue;
    }
    // One event per word so the spoken word changes colour exactly on its timestamp.
    g.words.forEach((w, idx) => {
      const start = idx === 0 ? g.start : Math.max(g.start, w.start);
      const nextStart = g.words[idx + 1]?.start;
      const end = nextStart !== undefined ? Math.max(start + 0.01, nextStart) : g.end;
      const line = texts.map((t, k) => (k === idx ? `{\\c${highlight}&}${t}{\\r}` : t)).join(" ");
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${line}`);
    });
  }
  return [...header, ...events, ""].join("\n");
}

/** CSS custom properties for the HTML preview overlay (sizes in container-min units). */
export function previewVars(style: CaptionStyle): Record<string, string> {
  const u = (px: number) => `calc(${(px / 10.8).toFixed(3)} * 1cqmin)`;
  const shadow = style.shadow && !style.background ? `${u(style.size * 0.05)} ${u(style.size * 0.05)} 0 ${style.shadowColor}` : "none";
  return {
    "--cap-font": `"${style.font}", Arial, sans-serif`,
    "--cap-size": u(style.size),
    "--cap-weight": style.bold ? "700" : "400",
    "--cap-color": style.color,
    "--cap-highlight": style.highlightColor,
    "--cap-stroke": style.outline && !style.background ? u(style.outlineWidth * 2) : "0px",
    "--cap-stroke-color": style.outlineColor,
    "--cap-shadow": shadow,
    "--cap-bg": style.background ? hexWithAlpha(style.backgroundColor, style.backgroundOpacity) : "transparent",
    "--cap-pad": style.background ? `${u(style.size * 0.12)} ${u(style.size * 0.28)}` : "0",
    "--cap-offset": `${style.offset}%`,
  };
}

function hexWithAlpha(hex: string, a: number) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
