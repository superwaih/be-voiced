"use client";

/**
 * The public page, at `/`.
 *
 * ## The direction
 *
 * Soft Structuralism on a Z-axis cascade — deliberately not the Ethereal Glass bento the sign-in
 * screen uses, because two screens of the same product should not be the same screen twice. Here
 * the ground is a silver off-white, the type is set very large, and the surfaces float on wide,
 * heavily diffused shadows tinted with the brand's plum rather than black, so the page reads as
 * paper and card rather than as glass.
 *
 * The cascade is the reason for the layout: clips are things you lift out of something longer, so
 * the hero stacks them as physical cards, overlapped and turned a degree or two off the grid. Below
 * `md` every rotation and negative offset is removed — tilted, overlapping cards fight the thumb.
 *
 * ## What it shows
 *
 * Software has no photographs worth showing, so every picture here is the product's own interface
 * built in markup: a transcript with its speakers, a frame with captions burned in, an answer with
 * its citations. No invented customers, logos, quotes or counts appear anywhere, and the one
 * performance figure is a measurement, labelled as the machine it was measured on.
 *
 * ## Motion
 *
 * Sections reveal on scroll through an IntersectionObserver, and the resting state is the visible
 * one: the animation class is added when a block comes into view, never removed from the markup.
 * With scripting off, or with less motion asked for, the whole page is simply there.
 */

import {
  ArrowRight,
  ChatCircleDots,
  ClosedCaptioning,
  Lightning,
  TextAlignLeft,
  Waveform,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";

/** One curve for the whole page: heavy at the start, settling rather than stopping. */
const SPRING = "ease-[cubic-bezier(0.32,0.72,0,1)]";

/**
 * The palette, bright on purpose.
 *
 * The deep plum the app is built from is a fine interface colour and a dull page: at the size a
 * landing page uses it, it reads as brown-black. These are its saturated cousins — a fuchsia that
 * carries the brand's hue at full strength, a cyan far enough away to be a real second voice, and
 * an amber to keep the two from reading as a cold gradient.
 *
 * The spectrum runs warm to cool rather than the purple-into-blue that marks a generated page, and
 * it means something here: it is the colour of a waveform across its own length.
 */
const FUCHSIA = "#e040c8";
const VIOLET = "#9b4dff";
const CYAN = "#22d3ee";
const AMBER = "#ffb020";

/** Wide, soft, and carrying the hue of what sits above it — never black at low opacity. */
const LIFT = "shadow-[0_2px_6px_rgba(120,20,110,0.06),0_34px_80px_-30px_rgba(120,20,110,0.30)]";
const LIFT_SOFT = "shadow-[0_1px_3px_rgba(120,20,110,0.05),0_18px_44px_-24px_rgba(120,20,110,0.20)]";

export function LandingScreen() {
  return (
    <div className="sb-grain relative h-full scroll-smooth overflow-y-auto bg-[#fbf7fd] text-[#1a1420] [scrollbar-gutter:stable_both-edges]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-full focus:bg-[#1a1420] focus:px-5 focus:py-2.5 focus:text-[13px] focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>

      <HeroGlow />
      <SiteNav />

      <main id="main" className="relative z-[1]">
        <Hero />
        <Speakers />
        <Seam />
        <Captions />
        <Ask />
        <Server />
        <Close />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Chrome
 * ------------------------------------------------------------------------------------------- */

/**
 * Two mesh blooms under the whole page.
 *
 * Fixed and inert, so the blur is painted once instead of on every scrolled frame, and kept at a
 * low opacity: they are meant to tint the ground, not to glow at anyone.
 */
function HeroGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute -top-[22rem] -left-[10rem] size-[52rem] rounded-full opacity-[0.22] blur-[130px]"
        style={{ background: `radial-gradient(circle, ${FUCHSIA}, transparent 66%)` }}
      />
      <div
        className="absolute -top-[14rem] right-[-16rem] size-[46rem] rounded-full opacity-[0.20] blur-[130px]"
        style={{ background: `radial-gradient(circle, ${CYAN}, transparent 68%)` }}
      />
    </div>
  );
}

function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-30 px-4 pt-4 md:px-8 md:pt-6">
      <div
        className={`mx-auto flex max-w-[1180px] items-center gap-6 rounded-full border border-[#1a1420]/[0.06] bg-white/80 py-2.5 pr-2.5 pl-5 backdrop-blur-xl ${LIFT_SOFT}`}
      >
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-[#1a1420]">
          <BrandMark size={21} tone="accent" />
          <span className="text-[15.5px] font-bold tracking-[-0.025em]">Soundbite</span>
        </Link>

        <div className="ml-auto hidden items-center gap-7 md:flex">
          {LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              className={`text-[13.5px] text-[#1a1420]/55 transition-colors duration-500 ${SPRING} hover:text-[#1a1420]`}
            >
              {label}
            </a>
          ))}
        </div>

        <Link
          href="/sign-in"
          className={`ml-auto shrink-0 rounded-full bg-[#1a1420] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-all duration-700 ${SPRING} hover:bg-[#000] focus-visible:outline-2 focus-visible:outline-[#e040c8] focus-visible:outline-offset-2 active:scale-[0.97] md:ml-0`}
        >
          Sign in
        </Link>

        <MenuButton open={open} onToggle={() => setOpen((v) => !v)} />
      </div>

      <MenuOverlay open={open} onClose={() => setOpen(false)} />
    </nav>
  );
}

const LINKS: [string, string][] = [
  ["Transcripts", "#speakers"],
  ["Captions", "#captions"],
  ["Ask", "#ask"],
];

/**
 * Two bars that become a cross.
 *
 * They rotate and meet rather than one of them vanishing, so the control reads as the same object
 * in two states. Both bars are absolutely placed on one centre line, which is what lets them land
 * exactly on top of each other when open.
 */
function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="site-menu"
      aria-label={open ? "Close the menu" : "Open the menu"}
      className={`relative grid size-10 shrink-0 place-items-center rounded-full border border-[#1a1420]/[0.08] bg-white transition-all duration-700 ${SPRING} focus-visible:outline-2 focus-visible:outline-[#e040c8] focus-visible:outline-offset-2 active:scale-[0.94] md:hidden`}
    >
      <span className="relative block h-3 w-[18px]" aria-hidden="true">
        <span
          className={`absolute left-0 block h-[1.5px] w-full rounded-full bg-[#1a1420] transition-all duration-700 ${SPRING} ${
            open ? "top-[5px] rotate-45" : "top-0 rotate-0"
          }`}
        />
        <span
          className={`absolute left-0 block h-[1.5px] w-full rounded-full bg-[#1a1420] transition-all duration-700 ${SPRING} ${
            open ? "top-[5px] -rotate-45" : "top-[10px] rotate-0"
          }`}
        />
      </span>
    </button>
  );
}

/**
 * The expansion: a fixed sheet over the whole screen, so the heavy blur is allowed here and
 * nowhere else on the page.
 *
 * The links do not simply appear. Each one lifts out of an invisible box on its own delay, and the
 * sheet stays mounted but inert when closed so the staggering has something to animate from —
 * `hidden` on the container keeps it out of the tab order while it is away.
 */
function MenuOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      id="site-menu"
      hidden={!open}
      className={`fixed inset-0 z-20 bg-white/85 backdrop-blur-3xl transition-opacity duration-700 ${SPRING} md:hidden ${
        open ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="flex h-full flex-col justify-center gap-2 px-8">
        {LINKS.map(([label, href], i) => (
          <a
            key={href}
            href={href}
            onClick={onClose}
            style={{ transitionDelay: open ? `${120 + i * 70}ms` : "0ms" }}
            className={`text-[clamp(32px,9vw,44px)] leading-tight font-bold tracking-[-0.04em] text-[#1a1420] transition-all duration-700 ${SPRING} ${
              open ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
            }`}
          >
            {label}
          </a>
        ))}

        <Link
          href="/sign-in"
          onClick={onClose}
          style={{ transitionDelay: open ? `${120 + LINKS.length * 70}ms` : "0ms" }}
          className={`mt-8 w-max rounded-full bg-[#e040c8] px-7 py-3.5 text-[15px] font-semibold text-white transition-all duration-700 ${SPRING} ${
            open ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
          }`}
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-[#1a1420]/[0.07] px-4 py-14 md:px-8">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark size={21} tone="accent" />
            <span className="text-[15.5px] font-bold tracking-[-0.025em]">Soundbite</span>
          </div>
          <p className="mt-3 max-w-[38ch] text-[13.5px] leading-relaxed text-[#1a1420]/50">
            Recordings in, transcripts and captioned clips out. Everything runs on our machines.
          </p>
        </div>

        {/* A privacy policy and terms belong here and are not written yet. Linking to routes that
            do not exist is worse than leaving them out, and inventing the text would be worse
            still, so the row carries what is real until those two pages are written. */}
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 text-[13px] text-[#1a1420]/50">
          <Link
            href="/sign-in"
            className={`text-[#1a1420]/50 transition-colors duration-500 ${SPRING} hover:text-[#1a1420]`}
          >
            Sign in
          </Link>
          <a
            href="mailto:hello@soundbite.app"
            className={`text-[#1a1420]/50 transition-colors duration-500 ${SPRING} hover:text-[#1a1420]`}
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
    <section className="px-4 pt-16 pb-28 md:px-8 md:pt-20 md:pb-40">
      <div className="mx-auto grid max-w-[1180px] items-center gap-14 md:grid-cols-12 md:gap-10">
        <div className="md:col-span-6 lg:col-span-7">
          <Reveal>
            <span className="inline-block rounded-full border border-[#1a1420]/[0.08] bg-white px-3.5 py-1.5 text-[10px] font-medium tracking-[0.2em] text-[#1a1420]/50 uppercase">
              Transcripts · clips · captions
            </span>
            <h1 className="mt-7 max-w-[11ch] text-[clamp(44px,7vw,88px)] leading-[0.95] font-bold tracking-[-0.05em] text-balance">
              Find the{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(100deg, ${FUCHSIA}, ${VIOLET} 55%, ${CYAN})` }}
              >
                part worth
              </span>{" "}
              posting.
            </h1>
            <p className="mt-7 max-w-[44ch] text-[19px] leading-relaxed text-pretty text-[#1a1420]/55">
              Upload a recording. Soundbite writes it down, marks who spoke, and cuts the moment you
              want with the captions already burned in.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-5">
              <CallToAction href="/sign-in">Create an account</CallToAction>
              <a
                href="#speakers"
                className={`text-[15px] font-medium text-[#1a1420]/60 underline decoration-[#1a1420]/20 underline-offset-[6px] transition-colors duration-500 ${SPRING} hover:text-[#1a1420] hover:decoration-[#1a1420]/50`}
              >
                See what it does
              </a>
            </div>
          </Reveal>
        </div>

        <div className="md:col-span-6 lg:col-span-5">
          <Cascade />
        </div>
      </div>
    </section>
  );
}

/**
 * The cascade: three clips from one recording, stacked like cards dropped on a desk.
 *
 * They genuinely overlap — each absolutely placed, turned a degree or two, layered above the one
 * before it — because three evenly spaced cards in a row is a grid, not a cascade. Below `md` the
 * whole thing becomes a plain flex column: a tilted card that covers its neighbour puts half of
 * each touch target underneath the other one.
 */
const CLIPS = [
  {
    at: "00:14:22",
    run: "16s",
    who: "Tomas",
    dot: CYAN,
    line: "They remember the one sentence that came out wrong.",
    place: "md:absolute md:top-0 md:right-0 md:z-[1] md:w-[318px] md:rotate-[3deg]",
  },
  {
    at: "00:31:08",
    run: "22s",
    who: "Mara",
    dot: FUCHSIA,
    line: "We stopped planning the episode. We plan the clip now.",
    place: "md:absolute md:top-[196px] md:right-[74px] md:z-[2] md:w-[318px] md:-rotate-[2deg]",
  },
  {
    at: "00:47:51",
    run: "11s",
    who: "Tomas",
    dot: CYAN,
    line: "Nobody plays a two-hour file. They play your forty seconds.",
    place: "md:absolute md:top-[392px] md:right-[18px] md:z-[3] md:w-[318px] md:rotate-[1deg]",
  },
];

function Cascade() {
  return (
    <div className="relative flex flex-col gap-5 md:block md:h-[640px]">
      {CLIPS.map((c, i) => (
        <Reveal key={c.at} delay={i * 110}>
          <article
            className={`${c.place} ${LIFT} rounded-[2rem] border border-[#1a1420]/[0.06] bg-white p-2 transition-transform duration-700 ${SPRING} md:hover:z-[4] md:hover:-translate-y-2 md:hover:rotate-0`}
          >
            <div className="rounded-[calc(2rem-0.5rem)] bg-[#faf9fb] p-6">
              <div className="flex items-center justify-between">
                <span className="mono text-[11px] text-[#1a1420]/40">{c.at}</span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
                  style={{ background: FUCHSIA }}>
                  {c.run}
                </span>
              </div>

              <MiniWave seed={i} />

              <p className="mt-5 text-[15px] leading-relaxed text-[#1a1420]/85">&ldquo;{c.line}&rdquo;</p>

              <div className="mt-5 flex items-center gap-2.5 border-t border-[#1a1420]/[0.07] pt-4">
                <span
                  aria-hidden="true"
                  className="size-[7px] shrink-0 rounded-full"
                  style={{ background: c.dot }}
                />
                <span className="text-[13px] font-medium text-[#1a1420]/60">{c.who}</span>
                <span className="mono ml-auto text-[11px] text-[#1a1420]/35">captions on</span>
              </div>
            </div>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

/**
 * Who said what. Composed wide rather than half-and-half: the transcript takes seven columns and
 * the words four, with a column of air between, so this does not read as the same shape as the two
 * sections that follow it.
 */
function Speakers() {
  return (
    <Band id="speakers" tone="plum" flush>
      <div className="grid items-center gap-12 md:grid-cols-12 md:gap-8">
        <Reveal className="md:col-span-7">
          <TranscriptCard />
        </Reveal>
        <Reveal delay={110} className="md:col-span-4 md:col-start-9">
            <SectionHead
              icon={<TextAlignLeft weight="light" />}
              onDark
              kicker="Who said what"
              title="Two people, told apart."
            body="Soundbite separates the voices as it transcribes, so a conversation reads like a script instead of a wall. Every word carries its own timestamp, which is what makes everything after this possible."
          />
        </Reveal>
      </div>
    </Band>
  );
}

/**
 * Captions, as a full-width statement rather than a split. The frame is the section: set large and
 * centred on the deep band. This is the one place a picture takes the whole width.
 */
function Captions() {
  return (
    <Band id="captions">
      <Reveal>
        <div className="mx-auto max-w-[760px] text-center">
          <SectionHead
            centred
            icon={<ClosedCaptioning weight="light" />}
            kicker="Captions"
            title="Burned in, not bolted on."
            body="Because the words are timed to the audio, each one lights as it is spoken. Set the style once and the clip exports with the captions already part of the picture."
          />
        </div>
      </Reveal>

      <Reveal delay={120}>
        <div className="mx-auto mt-16 max-w-[1060px]">
          <CaptionCard />
        </div>
      </Reveal>
    </Band>
  );
}

/** Ask, mirrored and narrower, so no two neighbouring sections share a composition. */
function Ask() {
  return (
    <Band id="ask" tone="tint">
      <div className="grid items-center gap-12 md:grid-cols-12 md:gap-8">
        <Reveal className="md:col-span-4">
            <SectionHead
              icon={<ChatCircleDots weight="light" />}
              kicker="Ask"
              title="Ask the recording."
            body="Put a question to an hour of audio and get the answer with the timestamps it came from, so you can check it rather than take its word for it."
          />
        </Reveal>
        <Reveal delay={110} className="md:col-span-7 md:col-start-6">
          <AskCard />
        </Reveal>
      </div>
    </Band>
  );
}

/**
 * The honest technical claim, and the one measured figure on the page.
 *
 * The throughput is a real measurement on a known machine and is labelled as one. It is not a
 * promise about anyone else's recording, and no customer count, logo or quotation appears anywhere
 * on this page, because none exists yet.
 *
 * The three facts are deliberately not an equal three-up: the measured one takes its own wide cell
 * and the other two stack beside it.
 */
function Server() {
  return (
    <Band tone="ink">
      <div className="grid items-end gap-12 md:grid-cols-12 md:gap-10">
        <Reveal className="md:col-span-6">
            <span className="inline-grid size-14 place-items-center rounded-2xl bg-white/10 text-[#ffb020] [&_svg]:size-[26px]">
              <Lightning weight="light" />
            </span>
            <h2 className="mt-7 max-w-[13ch] text-[clamp(38px,5.4vw,68px)] leading-[0.98] font-bold tracking-[-0.05em] text-balance text-white">
              Your laptop does none of the work.
            </h2>
            <p className="mt-6 max-w-[42ch] text-[18px] leading-relaxed text-pretty text-white/55">
              Transcription runs on our machines. Nothing to install, no model to download, no
              graphics card to own. Upload a file and close the tab.
            </p>
        </Reveal>

        <Reveal delay={120} className="flex flex-col gap-4 md:col-span-5 md:col-start-8">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8">
              <p className="text-[clamp(44px,6vw,64px)] leading-none font-bold tracking-[-0.05em] text-white">
                5.2&times;
              </p>
              <p className="mt-3 text-[15px] text-white/60">faster than real time</p>
              <p className="mono mt-1 text-[11px] text-white/30">measured on 12 threads, base model</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                ["2 hours", "a file, longer on ask"],
                ["Nothing", "to install, ever"],
              ].map(([figure, label]) => (
                <div key={label} className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-6">
                  <p className="text-[19px] font-bold tracking-[-0.03em] text-white">{figure}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">{label}</p>
                </div>
              ))}
            </div>
        </Reveal>
      </div>
    </Band>
  );
}

function Close() {
  return (
    <section className="px-4 py-28 md:px-8 md:py-40">
      <Reveal>
        <div className={`${LIFT} mx-auto max-w-[1180px] rounded-[2.5rem] border border-[#1a1420]/[0.06] bg-white p-2`}>
          <div className="flex flex-col items-start gap-8 rounded-[calc(2.5rem-0.5rem)] bg-[#faf9fb] p-9 md:flex-row md:items-center md:justify-between md:p-14">
            <div>
              <h2 className="max-w-[14ch] text-[clamp(38px,5.4vw,68px)] leading-[0.98] font-bold tracking-[-0.05em] text-balance">
                Start with one recording.
              </h2>
              <p className="mt-5 max-w-[44ch] text-[18px] leading-relaxed text-[#1a1420]/55">
                Free to begin. No card, and no trial counting down at you.
              </p>
            </div>
            <CallToAction href="/sign-in">Create an account</CallToAction>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** One head, shared by every section, so the rhythm holds even where the composition changes. */
function SectionHead({
  icon,
  kicker,
  title,
  body,
  centred,
  onDark,
}: {
  icon: React.ReactNode;
  kicker: string;
  title: string;
  body: string;
  centred?: boolean;
  onDark?: boolean;
}) {
  return (
    <div className={centred ? "flex flex-col items-center" : undefined}>
      <span
        className={`inline-grid size-14 place-items-center rounded-2xl [&_svg]:size-[26px] ${
          onDark ? "bg-white/10 text-[#ffb020]" : "bg-[#e040c8]/[0.12] text-[#b01f9c]"
        }`}
      >
        {icon}
      </span>
      <p
        className={`mt-7 text-[11px] font-medium tracking-[0.2em] uppercase ${onDark ? "text-white/40" : "text-[#1a1420]/40"}`}
      >
        {kicker}
      </p>
      <h2
        className={`mt-4 text-[clamp(38px,5.4vw,68px)] leading-[0.98] font-bold tracking-[-0.05em] text-balance ${
          centred ? "" : "max-w-[13ch]"
        } ${onDark ? "text-white" : ""}`}
      >
        {title}
      </h2>
      <p
        className={`mt-6 text-[18px] leading-relaxed text-pretty ${centred ? "max-w-[54ch]" : "max-w-[40ch]"} ${
          onDark ? "text-white/55" : "text-[#1a1420]/55"
        }`}
      >
        {body}
      </p>
    </div>
  );
}

/**
 * The seam: one recording, edge to edge, with the clip lit inside it.
 *
 * This is the page's one motif and the only element that spans the full width. It is also the
 * whole product stated as a picture — thirty-eight minutes of grey, sixteen seconds of plum — which
 * is a thing no competitor's page can borrow, because none of them is named after the short part.
 *
 * The bars are a fixed series rather than a random one: this renders on the server too, and a
 * waveform that differed between server and client would hydrate into a mismatch.
 */
const SEAM = Array.from({ length: 150 }, (_, i) => {
  // A deterministic, slightly musical profile: three overlapping cycles, never a flat comb.
  const a = Math.sin(i * 0.21) * 0.5 + 0.5;
  const b = Math.sin(i * 0.57 + 1.1) * 0.5 + 0.5;
  const c = Math.sin(i * 1.13 + 2.7) * 0.5 + 0.5;
  return 0.18 + (a * 0.5 + b * 0.32 + c * 0.18) * 0.82;
});
const SEAM_FROM = 84;
const SEAM_TO = 101;

/** Fuchsia through violet to cyan and out to amber, sampled across the seam's length. */
const SPECTRUM = [FUCHSIA, VIOLET, CYAN, AMBER];

function hueAt(t: number) {
  const span = 1 / (SPECTRUM.length - 1);
  const i = Math.min(SPECTRUM.length - 2, Math.floor(t / span));
  const k = (t - i * span) / span;
  const [a, b] = [SPECTRUM[i], SPECTRUM[i + 1]];
  const mix = (x: string, y: string, o: number) => {
    const n = (c: string, at: number) => parseInt(c.slice(1 + at * 2, 3 + at * 2), 16);
    const ch = [0, 1, 2].map((at) => Math.round(n(x, at) + (n(y, at) - n(x, at)) * o));
    return `rgb(${ch.join(",")})`;
  };
  return mix(a, b, k);
}

function Seam() {
  return (
    <section aria-hidden="true" className="bg-[#1b0732] pb-20 md:pb-28">
      <div className="flex h-[150px] items-center gap-[3px] px-4 md:h-[230px] md:px-8">
        {SEAM.map((h, i) => {
          const lit = i >= SEAM_FROM && i <= SEAM_TO;
          return (
            <span
              key={i}
              className="min-w-0 flex-1 rounded-full"
              style={{
                height: `${Math.round(h * (lit ? 100 : 62))}%`,
                background: hueAt(i / (SEAM.length - 1)),
                opacity: lit ? 1 : 0.26,
                boxShadow: lit ? `0 0 26px ${hueAt(i / (SEAM.length - 1))}` : undefined,
              }}
            />
          );
        })}
      </div>

      <div className="mx-auto flex max-w-[1180px] items-baseline justify-between px-4 md:px-8">
        <span className="mono text-[11px] text-white/35">00:00:00</span>
        <span className="text-[14px] font-semibold text-white">
          sixteen seconds of thirty-eight minutes
        </span>
        <span className="mono text-[11px] text-white/35">00:38:02</span>
      </div>
    </section>
  );
}

function Band({
  id,
  tone = "plain",
  flush,
  children,
}: {
  id?: string;
  tone?: "plain" | "tint" | "plum" | "ink";
  /** Drops the bottom padding where the next block continues the same ground. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  // Four grounds, all drawn from the brand's own plum: the page alternates between them so the
  // scroll has a rhythm. Every section on one silver ground was the single biggest reason this
  // page read as flat — nothing to look forward to, and no reason for any section to feel
  // different from the one above it.
  const skin = {
    plain: "bg-transparent",
    tint: "bg-[#e6f7fb]",
    plum: "bg-[#1b0732]",
    ink: "bg-[#12041f]",
  }[tone];

  return (
    <section
      id={id}
      className={`${skin} scroll-mt-24 px-4 pt-24 md:scroll-mt-28 md:px-8 md:pt-32 ${flush ? "pb-10 md:pb-14" : "pb-24 md:pb-32"}`}
    >
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </section>
  );
}

function CallToAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{ backgroundImage: `linear-gradient(100deg, ${FUCHSIA}, ${VIOLET} 70%, ${CYAN})` }}
      className={`group flex h-14 w-max items-center gap-5 rounded-full pr-1.5 pl-7 text-[14.5px] font-semibold text-white shadow-[0_14px_38px_-10px_rgba(224,64,200,0.6)] transition-all duration-700 ${SPRING} hover:brightness-110 focus-visible:outline-2 focus-visible:outline-[#e040c8] focus-visible:outline-offset-2 active:scale-[0.98]`}
    >
      {children}
      <span
        className={`grid size-11 place-items-center rounded-full bg-white/[0.12] transition-transform duration-700 ${SPRING} group-hover:translate-x-1 group-hover:-translate-y-px group-hover:scale-105 [&_svg]:size-[18px]`}
      >
        <ArrowRight weight="light" />
      </span>
    </Link>
  );
}

/**
 * Reveals a block the first time it scrolls into view.
 *
 * The resting state is visible: the animation class is added, never removed, so with scripting off
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
 * The pictures: the product's own interface, built in markup
 * ------------------------------------------------------------------------------------------- */

const WAVES = [
  [9, 16, 24, 19, 31, 38, 27, 35, 44, 33, 22, 28, 40, 30, 18, 25, 34, 26, 15, 21],
  [14, 22, 30, 25, 18, 35, 41, 29, 23, 37, 45, 32, 20, 27, 36, 24, 16, 31, 39, 26],
  [11, 19, 27, 36, 29, 21, 33, 42, 30, 24, 17, 28, 38, 31, 22, 15, 26, 35, 28, 19],
];

function MiniWave({ seed }: { seed: number }) {
  const bars = WAVES[seed % WAVES.length];
  return (
    <div className="mt-5 flex h-9 items-end gap-[3px]" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 rounded-full"
          style={{
            height: `${h}px`,
            background: i > 4 && i < 14 ? hueAt(i / bars.length) : "rgba(26,20,32,0.12)",
          }}
        />
      ))}
    </div>
  );
}

function TranscriptCard() {
  const lines = [
    { who: "Mara", dot: FUCHSIA, at: "14:09", text: "We cut the first twenty minutes entirely, because the room was still filling up." },
    { who: "Tomas", dot: CYAN, at: "14:22", text: "Right, and that is the part everyone quotes back at us afterwards.", lit: true },
    { who: "Mara", dot: FUCHSIA, at: "14:38", text: "Which is the argument for cutting it, not for recording less." },
  ];
  return (
    <div className={`${LIFT} rounded-[2rem] border border-[#1a1420]/[0.06] bg-white p-2`}>
      <div className="rounded-[calc(2rem-0.5rem)] bg-[#faf9fb] p-7">
        <header className="flex items-center justify-between border-b border-[#1a1420]/[0.07] pb-4">
          <h3 className="text-[14px] font-semibold tracking-[-0.02em]">Tuesday standup, episode 14</h3>
          <span className="mono text-[11.5px] text-[#1a1420]/35">38:02</span>
        </header>
        <div className="flex flex-col gap-5 pt-5">
          {lines.map((l) => (
            <p key={l.at} className="grid grid-cols-[auto_1fr] gap-x-3.5 text-[13.5px] leading-relaxed">
              <span className="flex items-start gap-2.5 pt-[3px]">
                <span aria-hidden="true" className="mt-[5px] size-[6px] shrink-0 rounded-full" style={{ background: l.dot }} />
                <span className={`w-[46px] shrink-0 text-[12px] font-medium ${l.lit ? "text-[#1a1420]" : "text-[#1a1420]/50"}`}>
                  {l.who}
                </span>
                <span className="mono w-[34px] shrink-0 text-[11px] text-[#1a1420]/30">{l.at}</span>
              </span>
              <span className={l.lit ? "text-[#1a1420]/90" : "text-[#1a1420]/50"}>{l.text}</span>
            </p>
          ))}
        </div>
        <footer className="mt-6 flex items-center gap-5 border-t border-[#1a1420]/[0.07] pt-4">
          <span className="text-[12px] text-[#1a1420]/45">2 speakers found</span>
          <span className="text-[12px] text-[#1a1420]/45">Word timings on</span>
          <span className="mono ml-auto text-[11px] text-[#1a1420]/30">7m 18s</span>
        </footer>
      </div>
    </div>
  );
}

function CaptionCard() {
  return (
    <div className={`${LIFT} rounded-[2rem] border border-[#1a1420]/[0.06] bg-white p-2`}>
      <div className="relative overflow-hidden rounded-[calc(2rem-0.5rem)] bg-[#17141b]">
        {/* The frame: a still of a clip, drawn rather than photographed, because the product has no
            photograph of someone else's recording to show. */}
        <div className="aspect-[16/10] w-full bg-[radial-gradient(120%_90%_at_30%_20%,#3a2b40,transparent_60%),radial-gradient(90%_80%_at_80%_80%,#2a3a39,transparent_55%)]">
          <div className="flex h-full items-end justify-center p-7">
            <p className="max-w-[26ch] text-center text-[clamp(16px,2.2vw,22px)] leading-snug font-bold tracking-[-0.02em] text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">
              they remember the{" "}
              <span className="rounded-[6px] bg-[#e040c8] px-1.5 py-0.5 text-white">one sentence</span>{" "}
              that came out wrong
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t border-white/10 px-5 py-3.5">
          <span className="mono text-[11px] text-white/40">00:14:22</span>
          <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15">
            <span className="block h-full w-[42%] rounded-full bg-[#c58fc9]" />
          </span>
          <span className="mono text-[11px] text-white/40">00:14:38</span>
        </div>
      </div>
    </div>
  );
}

function AskCard() {
  return (
    <div className={`${LIFT} rounded-[2rem] border border-[#1a1420]/[0.06] bg-white p-2`}>
      <div className="rounded-[calc(2rem-0.5rem)] bg-[#faf9fb] p-7">
        <p className="ml-auto w-max max-w-[80%] rounded-[1.25rem] rounded-br-md bg-[#9b4dff] px-4 py-3 text-[14px] leading-relaxed text-white">
          What did we decide about the intro?
        </p>

        <div className="mt-5 flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#e040c8]/[0.12] text-[#b01f9c] [&_svg]:size-[15px]">
            <Waveform weight="light" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] leading-relaxed text-[#1a1420]/85">
              You agreed to cut it and keep recording the full session, then pull a short clip from
              the middle instead. Mara made the case twice.
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {["14:38", "31:08"].map((t) => (
                <span
                  key={t}
                  className="mono rounded-full border border-[#1a1420]/[0.08] bg-white px-2.5 py-1 text-[11px] text-[#1a1420]/55"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
