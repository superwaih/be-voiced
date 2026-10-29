"use client";

/**
 * The public page, at `/`.
 *
 * ## The direction
 *
 * Built to the discipline of Apple's product pages, which were read rather than remembered while
 * making this: a pure black ground with `#f5f5f7` type, headings at weight 600 with negative
 * tracking rather than bold, a single grey (`#86868b`) for everything secondary, full-bleed
 * sections alternating black and white, and — the part that matters most — **everything centred**.
 *
 * What makes those pages feel expensive is not an effect. It is that each screen holds one idea,
 * the type is enormous and quiet at the same time, the product is shown very large, and colour
 * appears almost nowhere. An earlier version of this page had gradient text, a glowing gradient
 * button, mesh blooms and a rainbow waveform: every one of those is an effect standing in for a
 * decision, and together they are the most recognisable generated-page look there is.
 *
 * So: no gradients, no glows, no shadows under resting cards, no tinted icon tiles. One accent,
 * used on the clip and on links, and nowhere else.
 *
 * ## What it shows
 *
 * Software has no product photograph, so the product itself is the picture: a transcript, a frame
 * with captions burned in, a search result. Each is shown large and centred, the way a laptop is.
 * No invented customers, logos, quotes or counts appear anywhere, and the single performance
 * figure is a measurement labelled with the machine it was measured on.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

/* ---------------------------------------------------------------------------------------------
 * Tokens
 * ------------------------------------------------------------------------------------------- */

/** The one accent. It marks the clip and it marks links. It is not used to decorate anything. */
const ACCENT = "#e45cc0";

const INK = "#1d1d1f"; // type on white
const SNOW = "#f5f5f7"; // type on black
const GREY = "#86868b"; // everything secondary, on either ground

/** Apple's headings are semibold with negative tracking, never heavy. */
const DISPLAY = "font-semibold tracking-[-0.025em] leading-[1.05] text-balance";

export function LandingScreen() {
  return (
    <div className="h-full scroll-smooth overflow-y-auto bg-black [scrollbar-gutter:stable_both-edges]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-5 focus:py-2.5 focus:text-[13px] focus:font-medium focus:text-black"
      >
        Skip to content
      </a>

      <SiteNav />

      <main id="main">
        <Hero />
        <Speakers />
        <Seam />
        <Captions />
        <Search />
        <Specs />
        <Close />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Chrome
 * ------------------------------------------------------------------------------------------- */

const NAV: [string, string][] = [
  ["Transcripts", "#speakers"],
  ["Captions", "#captions"],
  ["Search", "#search"],
];

/**
 * A slim frosted bar, the full width of the window.
 *
 * Deliberately not a floating pill: Apple's bar is 44px tall, sits against the top edge, and gets
 * out of the way. The blur is allowed here because the element is sticky, so it is composited once
 * rather than repainted as the page moves under it.
 */
function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-black/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-12 max-w-[1024px] items-center px-5" aria-label="Main">
        <Link href="/" className="flex items-center gap-2 text-[#f5f5f7]">
          <BrandMark size={17} />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">Soundbite</span>
        </Link>

        <div className="mx-auto hidden items-center gap-9 md:flex">
          {NAV.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="text-[12px] text-[#f5f5f7]/80 transition-opacity duration-300 hover:opacity-60"
            >
              {label}
            </a>
          ))}
        </div>

        <Link
          href="/sign-in"
          className="ml-auto text-[12px] text-[#f5f5f7]/80 transition-opacity duration-300 hover:opacity-60 md:ml-0"
        >
          Sign in
        </Link>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "Close the menu" : "Open the menu"}
          className="relative ml-5 grid size-8 place-items-center md:hidden"
        >
          <span className="relative block h-[9px] w-[16px]" aria-hidden="true">
            <span
              className={`absolute left-0 block h-[1px] w-full bg-[#f5f5f7] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                open ? "top-1 rotate-45" : "top-0"
              }`}
            />
            <span
              className={`absolute left-0 block h-[1px] w-full bg-[#f5f5f7] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                open ? "top-1 -rotate-45" : "top-2"
              }`}
            />
          </span>
        </button>
      </nav>

      <div
        id="site-menu"
        hidden={!open}
        className="border-t border-white/[0.08] bg-black px-5 pt-2 pb-6 md:hidden"
      >
        {[...NAV, ["Sign in", "/sign-in"] as [string, string]].map(([label, href], i) => (
          <a
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            style={{ transitionDelay: `${i * 45}ms` }}
            className={`block border-b border-white/[0.06] py-4 text-[20px] font-semibold tracking-[-0.02em] text-[#f5f5f7] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] last:border-0 ${
              open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            {label}
          </a>
        ))}
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-[#f5f5f7] px-5 py-10">
      <div className="mx-auto max-w-[1024px]">
        <p className="text-[12px] leading-relaxed" style={{ color: GREY }}>
          A recording goes in. A transcript, a clip and its captions come out. Transcription runs on
          our machines, not yours.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-black/[0.08] pt-4 text-[12px]">
          <span style={{ color: GREY }}>Soundbite</span>
          <Link href="/sign-in" className="transition-opacity hover:opacity-60" style={{ color: ACCENT }}>
            Sign in
          </Link>
          <a
            href="mailto:hello@soundbite.app"
            className="transition-opacity hover:opacity-60"
            style={{ color: ACCENT }}
          >
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Sections. Each one holds a single idea, centred, with the product shown large beneath it.
 * ------------------------------------------------------------------------------------------- */

function Hero() {
  return (
    <Stage dark>
      <Reveal>
        <p className="text-center text-[19px] font-semibold tracking-[-0.01em]" style={{ color: ACCENT }}>
          Soundbite
        </p>
        <h1
          className={`mx-auto mt-3 max-w-[16ch] text-center text-[clamp(44px,7.4vw,96px)] ${DISPLAY}`}
          style={{ color: SNOW }}
        >
          Find the part worth posting.
        </h1>
        <p
          className="mx-auto mt-6 max-w-[34ch] text-center text-[clamp(19px,2vw,26px)] leading-snug font-medium tracking-[-0.015em]"
          style={{ color: GREY }}
        >
          It writes down what was said, marks who said it, and cuts the moment you want.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          <PillLink href="/sign-in">Create an account</PillLink>
          <TextLink href="#speakers">See how it works</TextLink>
        </div>
      </Reveal>

      <Reveal delay={120}>
        <div className="mt-16 md:mt-20">
          <Clips />
        </div>
      </Reveal>
    </Stage>
  );
}

function Speakers() {
  return (
    <Stage id="speakers">
      <Reveal>
        <Title>Every word. And who said it.</Title>
        <Lede>
          Voices are separated as the recording is transcribed, so a conversation reads like a script
          instead of a wall. Every word carries its own timestamp.
        </Lede>
      </Reveal>
      <Reveal delay={120}>
        <div className="mx-auto mt-14 max-w-[860px] md:mt-20">
          <TranscriptPanel />
        </div>
      </Reveal>
    </Stage>
  );
}

function Captions() {
  return (
    <Stage id="captions" dark>
      <Reveal>
        <Title dark>Captions, already burned in.</Title>
        <Lede dark>
          Because the words are timed to the audio, each one lights as it is spoken. Set the style
          once. The clip exports with the captions part of the picture.
        </Lede>
      </Reveal>
      <Reveal delay={120}>
        <div className="mx-auto mt-14 max-w-[900px] md:mt-20">
          <CaptionFrame />
        </div>
      </Reveal>
    </Stage>
  );
}

/**
 * Formerly "Ask", which told a first-time visitor nothing: it named the gesture rather than the
 * result, and a person scanning a navigation bar has no reason to guess what they would be asking
 * or what they would get back. "Search" is the word everyone already owns, and the heading says
 * plainly what it saves you from.
 */
function Search() {
  return (
    <Stage id="search">
      <Lede />
      <Reveal>
        <Title>Find it without listening again.</Title>
        <Lede>
          Ask a question of an hour of audio in plain words. The answer comes back with the
          timestamps it came from, so you can check it rather than trust it.
        </Lede>
      </Reveal>
      <Reveal delay={120}>
        <div className="mx-auto mt-14 max-w-[720px] md:mt-20">
          <SearchPanel />
        </div>
      </Reveal>
    </Stage>
  );
}

/**
 * The figures, set the way Apple sets a spec strip: very large numerals, a quiet grey caption, and
 * no cards or borders around any of it.
 *
 * The throughput is a real measurement on a known machine and says so. There is no customer count,
 * logo or quotation anywhere on this page, because none exists yet.
 */
function Specs() {
  const rows: [string, string, string][] = [
    ["5.2×", "faster than real time", "measured on 12 threads"],
    ["2 hrs", "in a single file", "longer on request"],
    ["0", "to install", "a browser is enough"],
  ];
  return (
    <Stage dark tight>
      <Reveal>
        <Title dark>Your laptop does none of the work.</Title>
        <Lede dark>
          Transcription runs on our machines. Nothing to install, no model to download, no graphics
          card to own. Upload a file and close the tab.
        </Lede>
      </Reveal>
      <Reveal delay={120}>
        <dl className="mx-auto mt-16 grid max-w-[900px] grid-cols-1 gap-12 sm:grid-cols-3 md:mt-20">
          {rows.map(([figure, label, note]) => (
            <div key={label} className="text-center">
              <dt
                className="text-[clamp(44px,5.4vw,64px)] font-semibold tracking-[-0.03em]"
                style={{ color: SNOW }}
              >
                {figure}
              </dt>
              <dd className="mt-2 text-[15px] font-medium" style={{ color: SNOW }}>
                {label}
              </dd>
              <dd className="mt-1 text-[12px]" style={{ color: GREY }}>
                {note}
              </dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </Stage>
  );
}

function Close() {
  return (
    <Stage tight>
      <Reveal>
        <Title>Start with one recording.</Title>
        <Lede>Free to begin. No card, and no trial counting down at you.</Lede>
        <div className="mt-9 flex justify-center">
          <PillLink href="/sign-in">Create an account</PillLink>
        </div>
      </Reveal>
    </Stage>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Composition
 * ------------------------------------------------------------------------------------------- */

function Stage({
  id,
  dark,
  tight,
  children,
}: {
  id?: string;
  dark?: boolean;
  tight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-12 px-5 ${dark ? "bg-black" : "bg-[#f5f5f7]"} ${
        tight ? "py-24 md:py-32" : "py-24 md:py-36"
      }`}
    >
      <div className="mx-auto max-w-[1024px]">{children}</div>
    </section>
  );
}

function Title({ dark, children }: { dark?: boolean; children: React.ReactNode }) {
  return (
    <h2
      className={`mx-auto max-w-[18ch] text-center text-[clamp(32px,5vw,64px)] ${DISPLAY}`}
      style={{ color: dark ? SNOW : INK }}
    >
      {children}
    </h2>
  );
}

function Lede({ dark, children }: { dark?: boolean; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      className="mx-auto mt-5 max-w-[46ch] text-center text-[clamp(16px,1.6vw,19px)] leading-relaxed"
      style={{ color: dark ? GREY : GREY }}
    >
      {children}
    </p>
  );
}

/** A solid pill. One flat colour, no ramp, no glow, and it shrinks a little when pressed. */
function PillLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{ background: ACCENT }}
      className="rounded-full px-6 py-3 text-[15px] font-medium text-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:brightness-[0.93] focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-4 active:scale-[0.97]"
    >
      {children}
    </Link>
  );
}

/** The quiet second action, as a coloured text link with a chevron, the way Apple sets one. */
function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-1 text-[15px] font-medium transition-opacity duration-300 hover:opacity-70"
      style={{ color: ACCENT }}
    >
      {children}
      <span
        aria-hidden="true"
        className="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5"
      >
        &rsaquo;
      </span>
    </a>
  );
}

/**
 * Reveals a block the first time it scrolls into view.
 *
 * The resting state is visible: the class is added, never removed, so with scripting off or with
 * less motion asked for the page is simply there. Getting this backwards once left a whole screen
 * at zero opacity, which is the worst way for an entrance to fail.
 */
function Reveal({ delay = 0, children }: { delay?: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={seen ? "sb-rise" : undefined} style={seen ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The product, shown large
 * ------------------------------------------------------------------------------------------- */

const SPEAKERS = {
  a: { name: "Mara", mark: ACCENT },
  b: { name: "Tomas", mark: "#6e6e73" },
} as const;

/**
 * Fixed series, not random: this renders on the server too, and a waveform that differed between
 * server and client would hydrate into a mismatch for the sake of noise nobody reads.
 */
const wave = (n: number, seed: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = Math.sin(i * 0.31 + seed) * 0.5 + 0.5;
    const b = Math.sin(i * 0.73 + seed * 2.1) * 0.5 + 0.5;
    const c = Math.sin(i * 1.27 + seed * 0.7) * 0.5 + 0.5;
    return 0.16 + (a * 0.5 + b * 0.32 + c * 0.18) * 0.84;
  });

/** Three clips from one recording, level and evenly spaced. No rotation, no overlap, no shadow. */
function Clips() {
  const clips = [
    { at: "00:14:22", run: "16s", who: "Tomas", line: "They remember the one sentence that came out wrong." },
    { at: "00:31:08", run: "22s", who: "Mara", line: "We stopped planning the episode. We plan the clip now." },
    { at: "00:47:51", run: "11s", who: "Tomas", line: "Nobody plays a two-hour file. They play your forty seconds." },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3 md:gap-5">
      {clips.map((c, i) => (
        <article key={c.at} className="rounded-[18px] bg-[#1d1d1f] p-6">
          <div className="flex items-center justify-between">
            <span className="mono text-[11px]" style={{ color: GREY }}>
              {c.at}
            </span>
            <span className="mono text-[11px]" style={{ color: ACCENT }}>
              {c.run}
            </span>
          </div>
          <Wave bars={wave(26, i + 1)} from={7} to={17} className="mt-5 h-9" />
          <p className="mt-5 text-[14px] leading-relaxed" style={{ color: SNOW }}>
            {c.line}
          </p>
          <p className="mt-4 text-[12px]" style={{ color: GREY }}>
            {c.who}
          </p>
        </article>
      ))}
    </div>
  );
}

/** One row of bars. The clip's span is the only coloured thing in it. */
function Wave({
  bars,
  from,
  to,
  className = "",
  litColour = ACCENT,
  dimColour = "rgba(255,255,255,0.22)",
}: {
  bars: number[];
  from: number;
  to: number;
  className?: string;
  litColour?: string;
  dimColour?: string;
}) {
  return (
    <div className={`flex items-center gap-[2px] ${className}`} aria-hidden="true">
      {bars.map((h, i) => {
        const lit = i >= from && i <= to;
        return (
          <span
            key={i}
            className="min-w-0 flex-1 rounded-full"
            style={{
              height: `${Math.round(h * (lit ? 100 : 66))}%`,
              background: lit ? litColour : dimColour,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The seam: one recording, edge to edge, with the clip lit inside it.
 *
 * The page's one full-bleed element and its only motif — thirty-eight minutes of grey, sixteen
 * seconds of colour. It states the whole product as a picture, and it is a picture no competitor
 * can borrow, because none of them is named after the short part.
 */
function Seam() {
  const bars = wave(170, 4);
  return (
    <section aria-hidden="true" className="bg-black pb-20 md:pb-28">
      <Wave bars={bars} from={96} to={114} className="h-[120px] px-5 md:h-[180px]" />
      <div className="mx-auto mt-6 flex max-w-[1024px] items-baseline justify-between px-5">
        <span className="mono text-[11px]" style={{ color: GREY }}>
          00:00:00
        </span>
        <span className="text-[13px] font-medium" style={{ color: SNOW }}>
          Sixteen seconds of thirty-eight minutes.
        </span>
        <span className="mono text-[11px]" style={{ color: GREY }}>
          00:38:02
        </span>
      </div>
    </section>
  );
}

function TranscriptPanel() {
  const lines: { who: keyof typeof SPEAKERS; at: string; text: string; lit?: boolean }[] = [
    { who: "a", at: "14:09", text: "We cut the first twenty minutes entirely, because the room was still filling up." },
    { who: "b", at: "14:22", text: "Right, and that is the part everyone quotes back at us afterwards.", lit: true },
    { who: "a", at: "14:38", text: "Which is the argument for cutting it, not for recording less." },
  ];

  return (
    <div className="rounded-[22px] bg-white p-8 md:p-10">
      <div className="flex items-baseline justify-between border-b border-black/[0.08] pb-5">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>
          Tuesday standup, episode 14
        </h3>
        <span className="mono text-[12px]" style={{ color: GREY }}>
          38:02
        </span>
      </div>

      <div className="flex flex-col gap-6 pt-7">
        {lines.map((l) => {
          const sp = SPEAKERS[l.who];
          return (
            <p key={l.at} className="grid grid-cols-[auto_1fr] gap-x-5 text-[16px] leading-relaxed">
              <span className="flex w-[104px] shrink-0 items-baseline gap-2">
                <span className="text-[13px] font-medium" style={{ color: sp.mark }}>
                  {sp.name}
                </span>
                <span className="mono text-[11px]" style={{ color: GREY }}>
                  {l.at}
                </span>
              </span>
              <span style={{ color: l.lit ? INK : GREY }}>{l.text}</span>
            </p>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-black/[0.08] pt-5 text-[12px]">
        <span style={{ color: GREY }}>2 speakers found</span>
        <span style={{ color: GREY }}>Word timings on</span>
        <span style={{ color: GREY }}>English</span>
        <span className="mono ml-auto" style={{ color: GREY }}>
          transcribed in 7m 18s
        </span>
      </div>
    </div>
  );
}

function CaptionFrame() {
  return (
    <div className="overflow-hidden rounded-[22px] bg-[#1d1d1f]">
      <div className="flex aspect-[16/9] w-full items-end justify-center p-10">
        <p
          className="max-w-[22ch] text-center text-[clamp(20px,3.4vw,40px)] font-semibold tracking-[-0.02em] text-white"
          style={{ textShadow: "0 2px 14px rgba(0,0,0,0.45)" }}
        >
          they remember the <span style={{ color: ACCENT }}>one sentence</span> that came out wrong
        </p>
      </div>
      <div className="flex items-center gap-5 border-t border-white/[0.08] px-7 py-4">
        <span className="mono text-[11px]" style={{ color: GREY }}>
          00:14:22
        </span>
        <span className="h-[2px] flex-1 overflow-hidden rounded-full bg-white/15">
          <span className="block h-full w-[42%] rounded-full" style={{ background: ACCENT }} />
        </span>
        <span className="mono text-[11px]" style={{ color: GREY }}>
          00:14:38
        </span>
      </div>
    </div>
  );
}

function SearchPanel() {
  return (
    <div className="rounded-[22px] bg-white p-8 md:p-10">
      <p
        className="rounded-full border border-black/[0.1] px-5 py-3.5 text-[16px]"
        style={{ color: INK }}
      >
        What did we decide about the intro?
      </p>

      <p className="mt-7 text-[16px] leading-relaxed" style={{ color: INK }}>
        You agreed to cut it, keep recording the full session, and pull a short clip from the middle
        instead. Mara made the case twice.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {["14:38", "31:08"].map((t) => (
          <span
            key={t}
            className="mono rounded-full border border-black/[0.1] px-3 py-1.5 text-[12px]"
            style={{ color: GREY }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
