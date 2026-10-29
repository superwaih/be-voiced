"use client";

/**
 * The public page, at `/`.
 *
 * ## The direction
 *
 * Editorial Luxury on an Editorial Split. Neither archetype has been used elsewhere in this
 * product — the sign-in is Ethereal Glass on a bento — and the pairing is not arbitrary: this
 * product makes **quotes**, and a quote is an editorial object. Print is the world it belongs to,
 * so the page is built out of warm paper, a high-contrast serif, espresso ink and a single
 * vermilion, with grain over the whole thing so the ground reads as stock rather than as a value.
 *
 * The split runs the length of the page: the words hold the left, the product holds the right. It
 * collapses to one column below `md`, where a tilted or offset layout would only fight a thumb.
 *
 * ## What was learned on the way here
 *
 * Earlier passes failed in two opposite directions, and both lessons are built into this one.
 *
 * Reaching for "bright" produced gradient text, a glowing gradient pill, mesh blooms and a rainbow
 * waveform — the most recognisable generated-page look there is, and four effects standing in for
 * one decision. There are no gradients on this page.
 *
 * Reaching for Apple's restraint produced an empty page, because what carries those pages is a
 * photograph of the machine at twelve hundred pixels. Software has no such photograph, so here the
 * product itself is the picture: shown large, and running.
 *
 * Contrast is measured rather than judged. Every colour pairing below clears 4.5:1.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/* ---------------------------------------------------------------------------------------------
 * The press
 * ------------------------------------------------------------------------------------------- */

const PAPER = "#fbf7f0"; // warm stock
const PAPER_2 = "#f2ece1"; // a second signature, one step down
const INK = "#241c17"; // espresso — 14.8:1 on paper
const INK_2 = "#6b5f55"; // secondary — 5.2:1 on paper
const MARK = "#c43d14"; // vermilion — 5.1:1 on the paper, the one accent
const MARK_DEEP = "#ab3310"; // 5.5:1 on the second stock, where the vermilion fell to 4.4:1

const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

export function LandingScreen() {
  return (
    <div
      className="sb-paper h-full scroll-smooth overflow-y-auto [scrollbar-gutter:stable_both-edges]"
      style={{ background: PAPER, color: INK }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-sm focus:px-5 focus:py-2.5 focus:text-[13px] focus:font-medium focus:!text-white"
        style={{ background: INK }}
      >
        Skip to content
      </a>

      <Masthead />

      <main id="main">
        <Hero />
        <PullQuote />
        <Speakers />
        <Captions />
        <Search />
        <Figures />
        <Close />
      </main>

      <Colophon />
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

/** A masthead, not a navbar: a rule, a wordmark set in the display face, and the sections. */
function Masthead() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className="sticky top-0 z-30 border-b backdrop-blur-xl"
      style={{ borderColor: "rgba(36,28,23,0.14)", background: "rgba(251,247,240,0.86)" }}
    >
      <nav className="mx-auto flex h-14 max-w-[1240px] items-center px-5 md:px-8" aria-label="Main">
        <Link href="/" className="font-display text-[22px] leading-none" style={{ color: INK }}>
          Soundbite
        </Link>

        <div className="mx-auto hidden items-center gap-10 md:flex">
          {NAV.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className={`text-[13px] tracking-[0.01em] transition-opacity duration-500 ${EASE} hover:opacity-55`}
              style={{ color: INK_2 }}
            >
              {label}
            </a>
          ))}
        </div>

        <Link
          href="/sign-in"
          className={`ml-auto text-[13px] transition-opacity duration-500 ${EASE} hover:opacity-55 md:ml-0`}
          style={{ color: INK }}
        >
          Sign in
        </Link>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="masthead-menu"
          aria-label={open ? "Close the menu" : "Open the menu"}
          className="relative ml-6 grid size-8 place-items-center md:hidden"
        >
          <span className="relative block h-[9px] w-[18px]" aria-hidden="true">
            <span
              className={`absolute left-0 block h-[1.5px] w-full transition-all duration-500 ${EASE} ${open ? "top-1 rotate-45" : "top-0"}`}
              style={{ background: INK }}
            />
            <span
              className={`absolute left-0 block h-[1.5px] w-full transition-all duration-500 ${EASE} ${open ? "top-1 -rotate-45" : "top-2"}`}
              style={{ background: INK }}
            />
          </span>
        </button>
      </nav>

      <div
        id="masthead-menu"
        hidden={!open}
        className="border-t px-5 pb-6 md:hidden"
        style={{ borderColor: "rgba(36,28,23,0.12)", background: PAPER }}
      >
        {[...NAV, ["Sign in", "/sign-in"] as [string, string]].map(([label, href], i) => (
          <a
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            style={{ color: INK, borderColor: "rgba(36,28,23,0.1)", transitionDelay: `${i * 45}ms` }}
            className={`font-display block border-b py-4 text-[28px] leading-tight transition-all duration-500 ${EASE} last:border-0 ${
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

function Colophon() {
  return (
    <footer className="px-5 py-14 md:px-8" style={{ background: PAPER_2 }}>
      <div className="mx-auto flex max-w-[1240px] flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-display text-[26px] leading-none" style={{ color: INK }}>
            Soundbite
          </p>
          <p className="mt-3 max-w-[40ch] text-[14px] leading-relaxed" style={{ color: INK_2 }}>
            A recording goes in. A transcript, a clip and its captions come out. The work happens on
            our machines, not yours.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]">
          <Link href="/sign-in" className="underline-offset-4 hover:underline" style={{ color: MARK_DEEP }}>
            Sign in
          </Link>
          <a
            href="mailto:hello@soundbite.app"
            className="underline-offset-4 hover:underline"
            style={{ color: MARK_DEEP }}
          >
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Sections
 * ------------------------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="px-5 pt-16 pb-24 md:px-8 md:pt-24 md:pb-32">
      <div className="mx-auto grid max-w-[1240px] items-center gap-14 md:grid-cols-12 md:gap-12">
        <Reveal className="md:col-span-5">
          <p className="text-[12px] tracking-[0.18em] uppercase" style={{ color: MARK }}>
            Transcripts · Clips · Captions
          </p>
          <h1
            className="font-display mt-6 text-[clamp(52px,7.6vw,104px)] leading-[0.92] tracking-[-0.025em] text-balance"
            style={{ color: INK }}
          >
            The part worth quoting.
          </h1>
          <p
            className="mt-7 max-w-[40ch] text-[clamp(17px,1.5vw,20px)] leading-relaxed"
            style={{ color: INK_2 }}
          >
            Upload an hour. Soundbite writes down every word, marks who said it, and hands you the
            forty seconds people will actually repeat.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Action href="/sign-in">Create an account</Action>
            <Quiet href="#speakers">See how it works</Quiet>
          </div>
        </Reveal>

        <Reveal delay={120} className="md:col-span-7">
          <Studio />
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The pull quote.
 *
 * A magazine sets the best sentence very large and lets it hold a page on its own. That is exactly
 * what this product produces, so the page performs it once, at full width, in the display face.
 */
function PullQuote() {
  return (
    <section className="border-y px-5 py-20 md:px-8 md:py-28" style={{ borderColor: "rgba(36,28,23,0.14)", background: PAPER_2 }}>
      <Reveal>
        <figure className="mx-auto max-w-[1240px]">
          <blockquote
            className="font-display text-[clamp(30px,4.6vw,62px)] leading-[1.08] tracking-[-0.02em] text-balance"
            style={{ color: INK }}
          >
            <span style={{ color: MARK }}>“</span>Nobody plays a two-hour file. They play the forty
            seconds you sent them.<span style={{ color: MARK }}>”</span>
          </blockquote>
          <figcaption className="mt-8 flex items-center gap-4 text-[13px]" style={{ color: INK_2 }}>
            <span className="h-px w-12" style={{ background: MARK }} aria-hidden="true" />
            Cut from a 38-minute recording, in one click
          </figcaption>
        </figure>
      </Reveal>
    </section>
  );
}

function Speakers() {
  return (
    <Spread
      id="speakers"
      rule="01"
      kicker="Who said what"
      title="Every word, and the voice behind it."
      body="Voices are separated as the recording is transcribed, so a conversation reads like a script instead of a wall of text. Every word carries its own timestamp, which is what makes the clip, the captions and the search possible."
    >
      <TranscriptSheet />
    </Spread>
  );
}

function Captions() {
  return (
    <Spread
      id="captions"
      rule="02"
      kicker="Captions"
      title="Set once. Burned in forever."
      body="Because the words are timed to the audio, each one lights as it is spoken. Choose the style once and every clip exports with the captions already part of the picture."
      flip
    >
      <CaptionPlate />
    </Spread>
  );
}

/**
 * Formerly "Ask", which named the gesture rather than the result: a visitor scanning a navigation
 * bar has no way to guess what they would be asking, or what comes back. "Search" is a word
 * everyone already owns.
 */
function Search() {
  return (
    <Spread
      id="search"
      rule="03"
      kicker="Search"
      title="Find it without listening again."
      body="Ask a question of an hour of audio in plain words. The answer comes back with the timestamps it was drawn from, so you can check it rather than trust it."
    >
      <SearchSheet />
    </Spread>
  );
}

/** Figures set as a print spec strip: rules, big numerals, quiet captions, no boxes. */
function Figures() {
  const rows: [string, string, string][] = [
    ["5.2×", "faster than real time", "measured on twelve threads"],
    ["2 hrs", "in a single file", "longer on request"],
    ["Nil", "to install", "a browser is enough"],
  ];
  return (
    <section className="border-y px-5 py-20 md:px-8 md:py-28" style={{ borderColor: "rgba(36,28,23,0.14)" }}>
      <div className="mx-auto max-w-[1240px]">
        <Reveal>
          <h2
            className="font-display max-w-[20ch] text-[clamp(30px,4.2vw,56px)] leading-[1.04] tracking-[-0.02em] text-balance"
            style={{ color: INK }}
          >
            Your laptop does none of the work.
          </h2>
          <p className="mt-6 max-w-[52ch] text-[17px] leading-relaxed" style={{ color: INK_2 }}>
            Transcription runs on our machines. Nothing to install, no model to download, no graphics
            card to own. Upload a file and close the tab.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <dl className="mt-16 grid grid-cols-1 sm:grid-cols-3">
            {rows.map(([figure, label, note], i) => (
              <div
                key={label}
                className={`border-t py-8 sm:border-t-0 sm:py-0 ${i > 0 ? "sm:border-l sm:pl-10" : ""} ${i < 2 ? "sm:pr-10" : ""}`}
                style={{ borderColor: "rgba(36,28,23,0.16)" }}
              >
                <dt
                  className="font-display text-[clamp(46px,5.4vw,68px)] leading-none tracking-[-0.03em]"
                  style={{ color: INK }}
                >
                  {figure}
                </dt>
                <dd className="mt-3 text-[15px]" style={{ color: INK }}>
                  {label}
                </dd>
                <dd className="mt-1 text-[12.5px]" style={{ color: INK_2 }}>
                  {note}
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

function Close() {
  return (
    <section className="px-5 py-24 md:px-8 md:py-36">
      <Reveal>
        <div className="mx-auto max-w-[1240px] text-center">
          <h2
            className="font-display mx-auto max-w-[16ch] text-[clamp(38px,5.6vw,76px)] leading-[0.98] tracking-[-0.025em] text-balance"
            style={{ color: INK }}
          >
            Start with one recording.
          </h2>
          <p className="mx-auto mt-6 max-w-[42ch] text-[17px] leading-relaxed" style={{ color: INK_2 }}>
            Free to begin. No card, and no trial counting down at you.
          </p>
          <div className="mt-10 flex justify-center">
            <Action href="/sign-in">Create an account</Action>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Composition
 * ------------------------------------------------------------------------------------------- */

/** The split, numbered like a chapter. Words on one side, the product on the other. */
function Spread({
  id,
  rule,
  kicker,
  title,
  body,
  flip,
  children,
}: {
  id: string;
  rule: string;
  kicker: string;
  title: string;
  body: string;
  flip?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 px-5 py-20 md:px-8 md:py-28">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 md:grid-cols-12 md:gap-12">
        <Reveal className={flip ? "md:col-span-4 md:col-start-9 md:row-start-1" : "md:col-span-4"}>
          <div className="flex items-baseline gap-4">
            <span className="mono text-[12px]" style={{ color: MARK }}>
              {rule}
            </span>
            <span className="text-[12px] tracking-[0.18em] uppercase" style={{ color: INK_2 }}>
              {kicker}
            </span>
          </div>
          <h2
            className="font-display mt-5 text-[clamp(30px,3.6vw,48px)] leading-[1.05] tracking-[-0.02em] text-balance"
            style={{ color: INK }}
          >
            {title}
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed" style={{ color: INK_2 }}>
            {body}
          </p>
        </Reveal>

        <Reveal
          delay={110}
          className={flip ? "md:col-span-7 md:col-start-1 md:row-start-1" : "md:col-span-7 md:col-start-6"}
        >
          {children}
        </Reveal>
      </div>
    </section>
  );
}

/** The primary action: a solid block of the one accent, square-ish like a press stamp. */
function Action({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{ background: MARK }}
      className={`rounded-[4px] px-7 py-3.5 text-[15px] font-medium text-white transition-all duration-500 ${EASE} hover:brightness-[0.92] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#241c17] active:scale-[0.98]`}
    >
      {children}
    </Link>
  );
}

function Quiet({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-2 text-[15px] underline-offset-[6px] hover:underline"
      style={{ color: INK }}
    >
      {children}
      <span
        aria-hidden="true"
        className={`transition-transform duration-500 ${EASE} group-hover:translate-x-1`}
        style={{ color: MARK }}
      >
        &rarr;
      </span>
    </a>
  );
}

/**
 * Reveals a block the first time it scrolls into view.
 *
 * The resting state is the visible one: the class is added, never removed, so with scripting off
 * or with less motion asked for the page is simply there. Getting this backwards once left a whole
 * screen at zero opacity, which is the worst way for an entrance to fail.
 */
function Reveal({
  delay = 0,
  className,
  children,
}: {
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
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
    <div
      ref={ref}
      className={[className, seen ? "sb-rise" : null].filter(Boolean).join(" ") || undefined}
      style={seen ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The product, shown large and running
 * ------------------------------------------------------------------------------------------- */

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

const LINE = {
  who: "Tomas",
  at: "14:22",
  words: (
    "Right, and that is the part everyone quotes back at us afterwards. Nobody mentions the half " +
    "hour we rehearsed, or the three takes before it."
  ).split(" "),
};
const STEP_MS = 320;

/**
 * The hero's picture: the product, at the size a photograph would be, and running.
 *
 * The playhead walks the clip, the word under it lights, the waveform fills behind it. It is not a
 * video of the product — it is the product's own markup, which also means it cannot drift out of
 * date with the app.
 *
 * It loops, and it stops when it scrolls out of view: a timer firing three times a second behind a
 * screen nobody is looking at is a flat battery for nothing.
 */
function Studio() {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(
        () => setAt((i) => (i === null ? 0 : (i + 1) % (LINE.words.length + 6))),
        STEP_MS,
      );
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    if (typeof IntersectionObserver === "undefined") {
      start();
      return stop;
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop()), {
      threshold: 0.15,
    });
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, []);

  const spoken = at === null ? 5 : Math.min(at, LINE.words.length - 1);
  const playing = at !== null && at < LINE.words.length;
  const progress = at === null ? 0.34 : Math.min(1, (at + 1) / LINE.words.length);

  const bars = wave(90, 7);
  const FROM = 36;
  const TO = 58;

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-[6px] border"
      style={{ borderColor: "rgba(36,28,23,0.18)", background: "#fffdf9" }}
    >
      <div
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: "rgba(36,28,23,0.12)", background: PAPER_2 }}
      >
        <span className="text-[12.5px] font-medium" style={{ color: INK }}>
          Tuesday standup, episode 14
        </span>
        <span className="mono ml-auto text-[11px]" style={{ color: INK_2 }}>
          38:02
        </span>
      </div>

      <div className="px-5 py-7 md:px-8">
        <div className="relative">
          <div className="flex h-[92px] items-center gap-[2px] md:h-[118px]" aria-hidden="true">
            {bars.map((h, i) => {
              const inClip = i >= FROM && i <= TO;
              const played = inClip && (i - FROM) / (TO - FROM) <= progress;
              return (
                <span
                  key={i}
                  className="min-w-0 flex-1"
                  style={{
                    height: `${Math.round(h * (inClip ? 100 : 52))}%`,
                    background: played ? MARK : inClip ? "rgba(196,61,20,0.28)" : "rgba(36,28,23,0.16)",
                  }}
                />
              );
            })}
          </div>
          <div
            aria-hidden="true"
            className="absolute -bottom-3 h-[2px]"
            style={{
              left: `${(FROM / bars.length) * 100}%`,
              width: `${((TO - FROM + 1) / bars.length) * 100}%`,
              background: MARK,
            }}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="mono text-[11.5px]" style={{ color: MARK }}>
            00:14:22 &rarr; 00:14:38
          </span>
          <span className="text-[12.5px]" style={{ color: INK_2 }}>
            {playing ? "Playing the clip" : "Sixteen seconds, captions on"}
          </span>
        </div>

        <p className="mt-6 grid grid-cols-[auto_1fr] gap-x-5 text-[clamp(15px,1.5vw,18px)] leading-relaxed">
          <span className="flex w-[92px] shrink-0 items-baseline gap-2 pt-[3px]">
            <span className="text-[13px] font-medium" style={{ color: INK }}>
              {LINE.who}
            </span>
            <span className="mono text-[11px]" style={{ color: INK_2 }}>
              {LINE.at}
            </span>
          </span>
          <span>
            {LINE.words.map((w, i) => (
              <span
                key={i}
                className="transition-colors duration-150"
                style={{
                  color: i === spoken ? MARK : i < spoken ? INK : "rgba(36,28,23,0.42)",
                  fontWeight: i === spoken ? 600 : 400,
                }}
              >
                {w}
                {i < LINE.words.length - 1 ? " " : ""}
              </span>
            ))}
          </span>
        </p>
      </div>

      <div
        className="flex flex-wrap gap-x-8 gap-y-2 border-t px-5 py-3.5 text-[12px] md:px-8"
        style={{ borderColor: "rgba(36,28,23,0.12)", background: PAPER_2 }}
      >
        <span style={{ color: INK_2 }}>2 speakers found</span>
        <span style={{ color: INK_2 }}>Word timings on</span>
        <span className="mono ml-auto" style={{ color: INK_2 }}>
          transcribed in 7m 18s
        </span>
      </div>
    </div>
  );
}

/** The transcript set as a page of a script, with the speakers in the margin. */
function TranscriptSheet() {
  const lines: { who: string; at: string; text: string; lit?: boolean }[] = [
    { who: "Mara", at: "14:09", text: "We cut the first twenty minutes entirely, because the room was still filling up and you can hear every chair." },
    { who: "Tomas", at: "14:22", text: "Right, and that is the part everyone quotes back at us afterwards.", lit: true },
    { who: "Mara", at: "14:38", text: "Which is the argument for cutting it, not for recording less." },
  ];
  return (
    <div className="border p-7 md:p-10" style={{ borderColor: "rgba(36,28,23,0.18)", background: "#fffdf9" }}>
      <div className="flex flex-col gap-7">
        {lines.map((l) => (
          <p key={l.at} className="grid gap-x-6 text-[17px] leading-relaxed md:grid-cols-[108px_1fr]">
            <span className="flex items-baseline gap-2 md:flex-col md:gap-1">
              <span className="text-[13px] font-medium" style={{ color: l.lit ? MARK : INK }}>
                {l.who}
              </span>
              <span className="mono text-[11px]" style={{ color: INK_2 }}>
                {l.at}
              </span>
            </span>
            <span style={{ color: l.lit ? INK : INK_2 }}>{l.text}</span>
          </p>
        ))}
      </div>
      <div
        className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t pt-5 text-[12.5px]"
        style={{ borderColor: "rgba(36,28,23,0.14)", color: INK_2 }}
      >
        <span>2 speakers found</span>
        <span>Word timings on</span>
        <span>English</span>
      </div>
    </div>
  );
}

/** The caption plate: the only dark object on the page, because a frame is a lit screen. */
function CaptionPlate() {
  return (
    <div className="overflow-hidden rounded-[6px]" style={{ background: INK }}>
      <div className="flex aspect-[16/9] w-full items-end justify-center p-10">
        <p className="max-w-[20ch] text-center text-[clamp(20px,3vw,38px)] leading-snug font-semibold tracking-[-0.01em] text-white">
          they remember the <span style={{ color: "#ff8a5c" }}>one sentence</span> that came out
          wrong
        </p>
      </div>
      <div
        className="flex items-center gap-5 border-t px-6 py-4"
        style={{ borderColor: "rgba(255,255,255,0.14)" }}
      >
        <span className="mono text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>
          00:14:22
        </span>
        <span className="h-[2px] flex-1 overflow-hidden" style={{ background: "rgba(255,255,255,0.22)" }}>
          <span className="block h-full w-[42%]" style={{ background: "#ff8a5c" }} />
        </span>
        <span className="mono text-[11px]" style={{ color: "rgba(255,255,255,0.65)" }}>
          00:14:38
        </span>
      </div>
    </div>
  );
}

function SearchSheet() {
  return (
    <div className="border p-7 md:p-10" style={{ borderColor: "rgba(36,28,23,0.18)", background: "#fffdf9" }}>
      <p
        className="font-display text-[clamp(21px,2.4vw,30px)] leading-snug"
        style={{ color: INK }}
      >
        What did we decide about the intro?
      </p>
      <div className="my-7 h-px" style={{ background: "rgba(36,28,23,0.14)" }} />
      <p className="text-[17px] leading-relaxed" style={{ color: INK_2 }}>
        You agreed to cut it, keep recording the full session, and pull a short clip from the middle
        instead. Mara made the case twice.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {["14:38", "31:08"].map((t) => (
          <span
            key={t}
            className="mono border px-3 py-1.5 text-[12px]"
            style={{ borderColor: "rgba(196,61,20,0.4)", color: MARK }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
