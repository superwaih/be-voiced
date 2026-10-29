import { NextResponse } from "next/server";
import { passwordProblem, register, startSession } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email.includes("@")) return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const user = await register(email, password, body.name);
    await startSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not create that account." },
      { status: 409 },
    );
  }
}
