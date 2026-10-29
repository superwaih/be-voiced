"use client";

/**
 * Signing in, and signing up, on one screen.
 *
 * Two modes rather than two pages: most people arriving here are not sure which they need, and
 * making them find the other one is a small cruelty. The server treats them as separate endpoints;
 * only the form is shared.
 *
 * ## The direction
 *
 * Ethereal Glass on an asymmetrical bento. Every surface is a double bezel — an outer tray with a
 * hairline and a recessed inner plate with its own top highlight — so the panels read as machined
 * parts sitting in a frame rather than rectangles painted on a page. Behind them, two low mesh
 * blooms and a fixed film grain, because a flat field at this scale looks like a wireframe.
 *
 * The screen is dark whichever theme the app is in. The archetype is built out of OLED black,
 * glass and edge light; rendered on a pale ground it is none of those things. A sign-in is also a
 * single moment rather than a section inside a lit page, so committing it is honest — this is the
 * one screen in the product that does not follow the theme, and that is a decision, not an
 * oversight.
 *
 * ## What it does
 *
 * The product is named after what it makes, so the screen performs that: thirty-eight minutes of
 * recording reduced to one sixteen-second soundbite, and the play control walks the clip's words
 * in time. That is the live thing. It uses the product's own content, works with a thumb, and
 * leaves a readable transcript behind when nothing is pressed.
 *
 * Entrance motion is CSS, declared only under `prefers-reduced-motion: no-preference`, so the
 * resting state is the visible one. Doing this in JavaScript left the first screen at zero opacity
 * whenever the animation did not run.
 */

import { ArrowRight, Eye, EyeSlash, Pause, Play, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";

type Mode = "in" | "up";

/** The shortest password worth having. Length is the only thing that reliably helps. */
const MIN_PASSWORD = 10;

/** One curve for the whole screen: heavy at the start, settling rather than stopping. */
const SPRING = "ease-[cubic-bezier(0.32,0.72,0,1)]";

export function SignInScreen() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [reveal, setReveal] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signingUp = mode === "up";
  const tooShort = signingUp && password.length > 0 && password.length < MIN_PASSWORD;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(signingUp ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signingUp ? { email, password, name } : { email, password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "That did not work.");
      // A full navigation, so every server component re-renders knowing who this is.
      window.location.href = "/home";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="sb-grain relative h-full overflow-y-auto bg-[#050505] text-white/90 [scrollbar-gutter:stable_both-edges]">
      <Blooms />

      <div className="relative z-[2] mx-auto flex min-h-[100dvh] w-full max-w-[1240px] flex-col px-4 py-10 md:px-8 md:py-16">
        {/* The island: detached from the top edge, its own pill. */}
        <nav className="sb-rise mx-auto flex w-max items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.05] px-5 py-2.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]">
          <BrandMark size={20} />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-white">Soundbite</span>
        </nav>

        {/* Asymmetrical bento. Below md every span resets and the cells stack in reading order:
            the claim, then the form, then the proof. */}
        <div className="my-auto grid grid-cols-1 gap-4 py-14 md:grid-cols-12 md:py-24">
          <section className="sb-rise order-1 md:col-span-7" style={{ animationDelay: "60ms" }}>
            <Bezel className="h-full">
              <div className="flex h-full flex-col justify-center p-7 md:p-11">
                <span className="mb-6 w-max rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-medium tracking-[0.2em] text-white/55 uppercase">
                  Speaker-labelled transcripts
                </span>
                <h1 className="text-[clamp(34px,5.2vw,58px)] leading-[1.02] font-bold tracking-[-0.045em] text-balance text-white">
                  Thirty-eight minutes.
                  <br />
                  <span className="text-[#d9a6dd]">One soundbite.</span>
                </h1>
                <p className="mt-6 max-w-[46ch] text-[16px] leading-relaxed text-pretty text-white/55">
                  Upload the recording. Read it back by speaker, find the part people will quote, and
                  cut it with the captions already on.
                </p>
              </div>
            </Bezel>
          </section>

          <section className="sb-rise order-2 md:col-span-5 md:row-span-2" style={{ animationDelay: "120ms" }}>
            <Bezel className="h-full">
              <div className="flex h-full flex-col p-7 md:p-9">
                <ModeSwitch
                  mode={mode}
                  onChange={(v) => {
                    setMode(v);
                    setError(null);
                  }}
                />

                <h2 className="mt-7 text-[26px] leading-tight font-bold tracking-[-0.035em] text-white">
                  {signingUp ? "Start with one recording" : "Welcome back"}
                </h2>
                <p className="mt-2 mb-7 text-[14.5px] leading-relaxed text-white/50">
                  {signingUp
                    ? "Free to start. No card, and no trial counting down at you."
                    : "Your recordings and transcripts are where you left them."}
                </p>

                <form onSubmit={submit} className="flex flex-col gap-5">
                  {signingUp && (
                    <GlassField label="Name" hint="Optional — it is only used to address you.">
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="name"
                        className={FIELD_INPUT}
                      />
                    </GlassField>
                  )}

                  <GlassField label="Email">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      autoFocus
                      placeholder="you@example.com"
                      className={FIELD_INPUT}
                    />
                  </GlassField>

                  <GlassField
                    label="Password"
                    hint={
                      signingUp
                        ? `At least ${MIN_PASSWORD} characters. Length matters more than symbols.`
                        : undefined
                    }
                  >
                    <input
                      type={reveal ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={(e) => setCapsOn(e.getModifierState?.("CapsLock") ?? false)}
                      autoComplete={signingUp ? "new-password" : "current-password"}
                      className={FIELD_INPUT}
                    />
                    <button
                      type="button"
                      onClick={() => setReveal((v) => !v)}
                      aria-label={reveal ? "Hide password" : "Show password"}
                      aria-pressed={reveal}
                      className={`mr-1.5 grid size-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/60 transition-all duration-500 ${SPRING} hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#c58fc9] focus-visible:outline-offset-2 active:scale-[0.94] [&_svg]:size-[15px]`}
                    >
                      {reveal ? <EyeSlash weight="light" /> : <Eye weight="light" />}
                    </button>
                  </GlassField>

                  {/* Honest about what it measures: this is length, and it says so. */}
                  {signingUp && password.length > 0 && <LengthMeter length={password.length} />}

                  {capsOn && (
                    <p className="-mt-2 text-[12.5px] text-white/40" aria-live="polite">
                      Caps lock is on.
                    </p>
                  )}

                  {error && (
                    <p
                      role="alert"
                      className="flex items-start gap-2.5 rounded-2xl border border-[#f59488]/20 bg-[#f59488]/10 p-3.5 text-[13px] text-[#f8b5ac] [&_svg]:size-[18px] [&_svg]:shrink-0"
                    >
                      <WarningCircle weight="light" className="mt-px" />
                      <span>{error}</span>
                    </p>
                  )}

                  <SubmitButton busy={busy} disabled={busy || tooShort}>
                    {busy ? "One moment" : signingUp ? "Create account" : "Sign in"}
                  </SubmitButton>
                </form>

                <p className="mt-auto pt-8 text-[12.5px] text-white/35">
                  {signingUp
                    ? "Transcription runs on our servers, not your laptop."
                    : "Trouble signing in? Check which email you used."}
                </p>
              </div>
            </Bezel>
          </section>

          <section className="sb-rise order-3 md:col-span-7" style={{ animationDelay: "180ms" }}>
            <Clip />
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The surfaces
 * ------------------------------------------------------------------------------------------- */

/**
 * The double bezel: an outer tray that catches the light, and a recessed plate inside it.
 *
 * The inner radius is the outer radius less the tray's padding, so the two curves stay concentric
 * instead of drifting apart at the corners — the detail that separates machined-looking hardware
 * from a rectangle with a border on it.
 */
function Bezel({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-[2rem] border border-white/[0.07] bg-white/[0.025] p-1.5 ${className}`}>
      <div className="h-full rounded-[calc(2rem-0.375rem)] bg-[#0c0c0e]/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.08)]">
        {children}
      </div>
    </div>
  );
}

const FIELD_INPUT =
  "h-11 min-w-0 flex-1 border-0 bg-transparent px-4 text-[14.5px] text-white outline-0 placeholder:text-white/25";

/** A field built as its own small bezel, so the inputs belong to the same hardware as the panels. */
function GlassField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-medium text-white/55">{label}</span>
      <span
        className={`flex items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] transition-all duration-500 ${SPRING} focus-within:border-[#c58fc9]/45 focus-within:bg-white/[0.05]`}
      >
        {children}
      </span>
      {hint && <span className="text-[11.5px] leading-relaxed text-white/35">{hint}</span>}
    </label>
  );
}

/** Two modes, on a sliding track rather than two buttons that merely change colour. */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Sign in or create an account"
      className="relative grid grid-cols-2 rounded-full border border-white/[0.08] bg-white/[0.03] p-1"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-white/[0.1] shadow-[inset_0_1px_1px_rgba(255,255,255,0.14)] transition-transform duration-700 ${SPRING} ${
          mode === "up" ? "translate-x-full" : "translate-x-0"
        }`}
      />
      {(
        [
          ["in", "Sign in"],
          ["up", "Create account"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={`relative z-[1] h-8 rounded-full text-[13px] font-medium transition-colors duration-500 ${SPRING} focus-visible:outline-2 focus-visible:outline-[#c58fc9] focus-visible:outline-offset-2 ${
            mode === value ? "text-white" : "text-white/45 hover:text-white/75"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The primary action, with its arrow nested in its own circle flush to the inner padding.
 *
 * The press takes the whole button down a little and throws the circle diagonally, so the two
 * move against each other instead of together — the tension is what makes it feel physical.
 */
function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`group mt-1 flex h-14 w-full items-center justify-between rounded-full bg-white pr-1.5 pl-7 text-[14.5px] font-semibold text-[#17060f] transition-all duration-700 ${SPRING} hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-[#c58fc9] focus-visible:outline-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40`}
    >
      <span>{children}</span>
      <span
        className={`grid size-11 place-items-center rounded-full bg-[#17060f]/[0.07] transition-transform duration-700 ${SPRING} group-hover:translate-x-1 group-hover:-translate-y-px group-hover:scale-105 [&_svg]:size-[18px]`}
      >
        <ArrowRight weight="light" className={busy ? "animate-pulse" : undefined} />
      </span>
    </button>
  );
}

/** Length, drawn. Scaled with a transform, so nothing animates its own box. */
function LengthMeter({ length }: { length: number }) {
  const ratio = Math.min(1, length / 16);
  const verdict = length < MIN_PASSWORD ? "Too short" : length < 14 ? "Long enough" : "Good length";
  return (
    <div className="-mt-2 flex items-center gap-3">
      <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.08]">
        <span
          className={`block h-full origin-left rounded-full transition-transform duration-700 ${SPRING} motion-reduce:transition-none ${
            length < MIN_PASSWORD ? "bg-[#f59488]" : "bg-[#c58fc9]"
          }`}
          style={{ transform: `scaleX(${Math.max(0.04, ratio)})` }}
        />
      </span>
      <span className="shrink-0 text-[11.5px] text-white/40">{verdict}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * The proof
 * ------------------------------------------------------------------------------------------- */

/**
 * Two speakers, told apart by a dot of their own.
 *
 * Identity, not data: the dots stay small and the lines stay in ink, because a transcript where
 * every speaker's words are tinted is unreadable by the third person.
 */
const SPEAKERS = {
  a: { name: "Mara", dot: "#c58fc9" },
  b: { name: "Tomas", dot: "#4fa39d" },
} as const;

/**
 * Fixed sample, not random: this renders on the server too, and a waveform that differed between
 * server and client would hydrate into a mismatch for the sake of noise nobody reads.
 */
const BARS = [
  7, 11, 18, 26, 21, 31, 37, 29, 40, 34, 24, 30, 44, 39, 27, 19, 25, 35, 47, 40, 28, 17, 13, 22, 33,
  42, 36, 25, 15, 20, 31, 38, 27, 19, 12, 16, 23, 34, 29, 15, 22, 30, 25, 18, 11, 14, 20, 28,
];
const CLIP_FROM = 12;
const CLIP_TO = 23;

/**
 * The clip's words, which the playhead walks through.
 *
 * Sixteen seconds of speech is about forty words, so there are forty: a dozen words paced across
 * sixteen seconds would crawl at half of anyone's talking speed, and the figures on this panel are
 * meant to be ones that add up.
 */
const CLIP = (
  "Right, and that is the part everyone quotes back at us afterwards. Nobody mentions the half " +
  "hour we rehearsed, or the three takes before it. They remember the one sentence that came out " +
  "wrong and was better for it."
).split(" ");
const CLIP_SECONDS = 16;
const PER_WORD = (CLIP_SECONDS * 1000) / CLIP.length;

function Clip() {
  const [at, setAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const playing = at !== null;

  // One interval, cleared on stop and on unmount. The playhead returns to silence at the end
  // rather than sticking on the last word, so the panel ends where it started.
  //
  // Asked for less motion it does not step: pressing play lights the clip and stops, which shows
  // what the control does without forty flashes to get there.
  useEffect(() => {
    if (!playing) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) return;
    timer.current = setInterval(() => {
      setAt((i) => (i === null || i + 1 >= CLIP.length ? null : i + 1));
    }, PER_WORD);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const progress = at === null ? 0 : (at + 1) / CLIP.length;

  return (
    <Bezel>
      <div className="p-7 md:p-8">
        <header className="flex items-center gap-4">
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-white">
            Tuesday standup, episode 14
          </h2>
          <span className="mono ml-auto shrink-0 text-[11.5px] text-white/35">38:02</span>
        </header>

        <div className="mt-6 flex items-start gap-5">
          <button
            type="button"
            onClick={() => setAt(playing ? null : 0)}
            aria-label={playing ? "Stop the clip" : "Play the clip"}
            className={`grid size-12 shrink-0 place-items-center rounded-full bg-white text-[#17060f] transition-all duration-700 ${SPRING} hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-[#c58fc9] focus-visible:outline-offset-2 active:scale-[0.94] [&_svg]:size-[18px]`}
          >
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex h-[52px] items-end gap-[2px]" aria-hidden="true">
              {BARS.map((h, i) => {
                const inClip = i >= CLIP_FROM && i <= CLIP_TO;
                const played = inClip && (i - CLIP_FROM) / (CLIP_TO - CLIP_FROM + 1) < progress;
                return (
                  <span
                    key={i}
                    className={`min-w-0 flex-1 rounded-full transition-colors duration-500 ${SPRING} motion-reduce:transition-none`}
                    style={{
                      height: `${h}px`,
                      background: played ? "#e7cbe8" : inClip ? "#a86aad" : "rgba(255,255,255,0.13)",
                    }}
                  />
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="mono text-[11px] text-white/30">00:00</span>
              <span className="mono text-[11px] text-[#d9a6dd]">00:14:22 → 00:14:38 · the clip</span>
              <span className="mono text-[11px] text-white/30">38:02</span>
            </div>
          </div>
        </div>

        <div className="mt-7 flex flex-col gap-5">
          <Line who="a" time="14:09">
            We cut the first twenty minutes entirely, because the room was still filling up and you
            can hear every chair.
          </Line>

          {/* The clip itself: the only line whose words are addressable, because it is the only one
              being played. Without script it is a plain sentence with one word already lit. */}
          <Line who="b" time="14:22" lit>
            {CLIP.map((w, i) => {
              const now = at === null ? i === 5 : i === at;
              return (
                <span
                  key={i}
                  className={
                    now
                      ? "rounded-[5px] bg-[#c58fc9]/25 px-[3px] text-white shadow-[inset_0_0_0_1px_rgba(197,143,201,0.35)]"
                      : undefined
                  }
                >
                  {w}
                  {i < CLIP.length - 1 ? " " : ""}
                </span>
              );
            })}
          </Line>

          <Line who="a" time="14:38">
            Which is the argument for cutting it, not for recording less.
          </Line>
        </div>

        <footer className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/[0.07] pt-5">
          <span className="text-[12.5px] text-white/45">2 speakers found</span>
          <span className="text-[12.5px] text-white/45">Word timings on</span>
          <span className="text-[12.5px] text-white/45">English</span>
          <span className="mono ml-auto text-[11.5px] text-white/30">transcribed in 7m 18s</span>
        </footer>
      </div>
    </Bezel>
  );
}

function Line({
  who,
  time,
  lit,
  children,
}: {
  who: keyof typeof SPEAKERS;
  time: string;
  lit?: boolean;
  children: React.ReactNode;
}) {
  const speaker = SPEAKERS[who];
  return (
    <p className="grid grid-cols-[auto_1fr] gap-x-4 text-[14px] leading-relaxed">
      {/* Aligned to the first line, not centred on the paragraph: on a narrow screen these wrap to
          four lines and a centred label floats away from the words it names. */}
      <span className="flex items-start gap-2.5 pt-[3px]">
        <span
          aria-hidden="true"
          className="mt-[5px] size-[6px] shrink-0 rounded-full"
          style={{ background: speaker.dot }}
        />
        <span
          className={`w-[50px] shrink-0 text-[12.5px] font-medium ${lit ? "text-white/85" : "text-white/45"}`}
        >
          {speaker.name}
        </span>
        <span className="mono w-[36px] shrink-0 text-[11px] text-white/25">{time}</span>
      </span>
      <span className={lit ? "text-white/90" : "text-white/45"}>{children}</span>
    </p>
  );
}

/**
 * Two mesh blooms, fixed and inert.
 *
 * Kept well under the saturation a glowing orb reaches by default, and in the product's own plum
 * and the second speaker's teal rather than the purple-to-blue wash that marks a generated page.
 */
function Blooms() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute -top-[18rem] -right-[12rem] size-[46rem] rounded-full opacity-[0.16] blur-[120px]"
        style={{ background: "radial-gradient(circle, #9a4fa1, transparent 68%)" }}
      />
      <div
        className="absolute -bottom-[22rem] -left-[14rem] size-[42rem] rounded-full opacity-[0.1] blur-[130px]"
        style={{ background: "radial-gradient(circle, #2f7f79, transparent 70%)" }}
      />
    </div>
  );
}
