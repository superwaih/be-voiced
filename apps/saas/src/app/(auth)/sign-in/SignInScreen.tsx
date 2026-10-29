"use client";

/**
 * Signing in, and signing up, on one screen.
 *
 * Two modes rather than two pages: most people arriving here are not sure which they need, and
 * making them find the other one is a small cruelty. The server treats them as separate endpoints;
 * only the form is shared.
 *
 * Built to the accent-ladder rule the rest of the product follows: the full plum appears only on
 * small marks — the submit button, the active word, the speaker dots — and every area is carried by
 * the ground or a pale tint of it. An earlier version of this screen put a full-plum slab down one
 * half of the page, which is the stock "brand block beside a form" every SaaS sign-in has, and it
 * spent the entire colour budget on decoration before the form had any.
 *
 * What fills the space instead is the product's own object: a real transcript panel, speaker
 * labelled, with the word under the playhead lit. That is the thing being signed into, and it is
 * the one claim that separates this from every other box that turns audio into text.
 *
 * On a phone the form comes first and the transcript sits under it. The order is the job: someone
 * here to sign in should reach the fields without scrolling past an advert for a product they have
 * already chosen.
 */

import { Eye, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Field, IconButton, Segmented, TextInput } from "@/components/ui";

type Mode = "in" | "up";

/** The shortest password worth having. Length is the only thing that reliably helps. */
const MIN_PASSWORD = 10;

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
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-[1060px] flex-col px-5 py-8 lg:py-14">
        {/* The wordmark travels with the cards rather than being pinned to the top edge: centred
            apart, it left a void between the two and the screen stopped reading as one thing. */}
        <div className="my-auto">
        <div className="mb-5 flex items-center gap-[10px]">
          <BrandMark size={23} tone="accent" />
          <span className="text-[17px] font-bold tracking-[-0.025em]">Soundbite</span>
        </div>

        {/* The form leads on a phone and sits in the right-hand column on a desktop; the transcript
            follows it in the source so the reading order is the working order at every width.
            `my-auto` centres the pair in whatever is left under the wordmark, so a tall window does
            not leave the whole screen stacked against its top edge. */}
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px] lg:gap-7">
          <section className="order-2 lg:order-1">
            <Transcript />
          </section>

          <section className="order-1 rounded-panel border border-line bg-surface p-6 lg:order-2 lg:p-7">
            <Segmented
              label="Sign in or create an account"
              value={mode}
              onChange={(v) => {
                setMode(v);
                setError(null);
              }}
              options={[
                { value: "in" as Mode, label: "Sign in" },
                { value: "up" as Mode, label: "Create account" },
              ]}
              className="mb-6"
            />

            <h1 className="text-[24px] leading-tight font-bold tracking-[-0.03em]">
              {signingUp ? "Start with one recording" : "Welcome back"}
            </h1>
            <p className="mt-1.5 mb-6 text-muted">
              {signingUp
                ? "Free to start. No card, and no trial counting down at you."
                : "Your recordings and transcripts are where you left them."}
            </p>

            <form onSubmit={submit} className="flex flex-col gap-[18px]">
              {signingUp && (
                <Field label="Name" hint="Optional — it is only used to address you.">
                  <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </Field>
              )}

              <Field label="Email">
                <TextInput
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                />
              </Field>

              <Field
                label="Password"
                hint={signingUp ? `At least ${MIN_PASSWORD} characters. Length matters more than symbols.` : undefined}
              >
                <TextInput
                  type={reveal ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCapsOn(e.getModifierState?.("CapsLock") ?? false)}
                  autoComplete={signingUp ? "new-password" : "current-password"}
                  trailing={
                    <IconButton
                      size="sm"
                      label={reveal ? "Hide password" : "Show password"}
                      active={reveal}
                      onClick={() => setReveal((v) => !v)}
                    >
                      {reveal ? <EyeSlash /> : <Eye />}
                    </IconButton>
                  }
                />
              </Field>

              {/* Honest about what it measures: this is length, and it says so. */}
              {signingUp && password.length > 0 && <LengthMeter length={password.length} />}

              {capsOn && (
                <p className="-mt-2 text-xs text-faint" aria-live="polite">
                  Caps lock is on.
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-control bg-danger-soft p-3 text-[13px] [&_svg]:size-[18px] [&_svg]:shrink-0"
                >
                  <WarningCircle weight="fill" className="mt-px text-danger" />
                  <span>{error}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={busy || tooShort}
                className="inline-flex h-10 w-full items-center justify-center rounded-full bg-accent text-[14px] font-semibold tracking-[-0.005em] text-accent-ink transition-colors duration-[120ms] hover:not-disabled:bg-accent-hover disabled:opacity-45"
              >
                {busy ? "One moment" : signingUp ? "Create account" : "Sign in"}
              </button>
            </form>

            <p className="mt-5 text-[13px] text-faint">
              {signingUp
                ? "Transcription runs on our servers, not your laptop."
                : "Trouble signing in? Check which email you used."}
            </p>
          </section>
        </div>
        </div>
      </div>
    </div>
  );
}

/** Length, drawn. Scaled with a transform, so nothing animates its own box. */
function LengthMeter({ length }: { length: number }) {
  const ratio = Math.min(1, length / 16);
  const verdict = length < MIN_PASSWORD ? "Too short" : length < 14 ? "Long enough" : "Good length";
  return (
    <div className="-mt-2 flex items-center gap-2.5">
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
        <span
          className={`block h-full origin-left rounded-full transition-transform duration-200 ease-out ${
            length < MIN_PASSWORD ? "bg-danger" : "bg-accent"
          }`}
          style={{ transform: `scaleX(${Math.max(0.04, ratio)})` }}
        />
      </span>
      <span className="shrink-0 text-xs text-faint">{verdict}</span>
    </div>
  );
}

/**
 * Two speakers, told apart by a dot of their own.
 *
 * Identity, not data: the dots stay small and the lines stay in ink, because a transcript where
 * every speaker's words are tinted is unreadable by the third person. Separating people by hue is
 * the product's whole job, so it is worth the two marks it costs.
 */
const SPEAKERS = {
  a: { name: "Mara", dot: "var(--accent-line)" },
  b: { name: "Tomas", dot: "#3f8f8a" },
} as const;

/**
 * Fixed sample, not random: this renders on the server too, and a waveform that differed between
 * server and client would hydrate into a mismatch for the sake of noise nobody reads.
 *
 * The clip's own range is the only part drawn in the accent — one hue, on the thing the panel is
 * about, which is the span being lifted out.
 */
const BARS = [
  7, 11, 18, 26, 21, 31, 37, 29, 40, 34, 24, 30, 44, 39, 27, 19, 25, 35, 47, 40, 28, 17, 13, 22, 33,
  42, 36, 25, 15, 20, 31, 38, 27, 19, 12, 16, 23, 34, 29, 15, 22, 30, 25, 18, 11, 14, 20, 28,
];
const CLIP_FROM = 12;
const CLIP_TO = 23;

function Transcript() {
  return (
    // `data-ui`: this is a fragment of the real product, not page furniture, so it keeps the
    // hairlines a panel in the app would have — separation by a 1px rule is the app's own rule.
    <div data-ui className="rounded-panel border border-line bg-surface">
      <header data-ui className="flex items-center gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-bold tracking-[-0.02em]">Tuesday standup, episode 14</h2>
        <span className="mono ml-auto shrink-0 text-[11.5px] text-faint">38:02</span>
      </header>

      <div className="px-5 pt-4">
        <div className="flex h-[52px] items-end gap-[2px]" aria-hidden="true">
          {BARS.map((h, i) => {
            const inClip = i >= CLIP_FROM && i <= CLIP_TO;
            return (
              <span
                key={i}
                className="min-w-0 flex-1 rounded-full"
                style={{
                  height: `${h}px`,
                  background: inClip ? "var(--wave-hot)" : "var(--line-strong)",
                }}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="mono text-[11px] text-faint">00:00</span>
          <span className="mono text-[11px] text-accent-text">00:14:22 → 00:14:38 · the clip</span>
          <span className="mono text-[11px] text-faint">38:02</span>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5">
        <Line who="a" time="14:09">
          We cut the first twenty minutes entirely, because the room was still filling up and you can
          hear every chair.
        </Line>
        <Line who="b" time="14:22" active>
          Right, and that is the <span className="tw-word is-now">part</span> everyone quotes back at
          us afterwards. Nobody mentions the half hour we rehearsed.
        </Line>
        <Line who="a" time="14:38">
          Which is the argument for cutting it, not for recording less.
        </Line>
        <Line who="b" time="14:51">
          We keep the whole thing and pull three minutes out of it. That is the format now.
        </Line>
        <Line who="a" time="15:04">
          Agreed. I will mark the two places it happened last week so you can hear the difference.
        </Line>
      </div>

      <footer data-ui className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3">
        <span className="text-[12.5px] text-muted">2 speakers found</span>
        <span className="text-[12.5px] text-muted">Word timings on</span>
        <span className="text-[12.5px] text-muted">English</span>
        <span className="mono ml-auto text-[11.5px] text-faint">transcribed in 7m 18s</span>
      </footer>
    </div>
  );
}

function Line({
  who,
  time,
  active,
  children,
}: {
  who: keyof typeof SPEAKERS;
  time: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const speaker = SPEAKERS[who];
  return (
    <p className="grid grid-cols-[auto_1fr] gap-x-3 text-[13.5px] leading-relaxed">
      {/* Aligned to the first line, not centred on the paragraph: on a narrow screen these wrap to
          four lines and a centred label floats away from the words it names. */}
      <span className="flex items-start gap-2 pt-[3px]">
        <span
          aria-hidden="true"
          className="size-[7px] shrink-0 rounded-full"
          style={{ background: speaker.dot }}
        />
        <span className={`w-[52px] shrink-0 text-[12.5px] font-semibold ${active ? "text-ink" : "text-muted"}`}>
          {speaker.name}
        </span>
        <span className="mono w-[38px] shrink-0 text-[11px] text-faint">{time}</span>
      </span>
      <span className={active ? "text-ink" : "text-muted"}>{children}</span>
    </p>
  );
}
