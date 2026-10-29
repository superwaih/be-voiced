"use client";

/**
 * Signing in, and signing up, on one screen.
 *
 * Two modes rather than two pages: most people arriving here are not sure which they need, and
 * making them find the other one is a small cruelty. The server treats them as separate endpoints;
 * only the form is shared.
 */

import { WarningCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Button, Field, TextInput } from "@/components/ui";

type Mode = "in" | "up";

export function SignInScreen() {
  const [mode, setMode] = useState<Mode>("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === "in" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "in" ? { email, password } : { email, password, name }),
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
    <div className="grid min-h-dvh place-items-center bg-rail p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-[11px] text-rail-ink">
          <BrandMark size={26} />
          <span className="text-xl font-bold tracking-[-0.025em]">Be Voiced</span>
        </div>

        <div className="rounded-[22px] bg-surface p-6 shadow-pop">
          <h1 className="text-xl font-bold tracking-[-0.03em]">
            {mode === "in" ? "Sign in" : "Create an account"}
          </h1>
          <p className="mt-1 mb-5 text-sm text-muted">
            {mode === "in"
              ? "Your recordings and transcripts are waiting."
              : "Free to start. No card, no trial countdown."}
          </p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === "up" && (
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
              />
            </Field>

            <Field label="Password" hint={mode === "up" ? "At least 10 characters. Length matters more than symbols." : undefined}>
              <TextInput
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
              />
            </Field>

            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-panel bg-danger-soft p-3 text-[13px] [&_svg]:size-[18px] [&_svg]:shrink-0">
                <WarningCircle weight="fill" className="mt-px text-danger" />
                <span>{error}</span>
              </p>
            )}

            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy ? "One moment" : mode === "in" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted">
            {mode === "in" ? "No account yet?" : "Already have one?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setError(null);
              }}
              className="font-semibold text-accent-text hover:underline"
            >
              {mode === "in" ? "Create one" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
