import { NextResponse } from "next/server";
import { signIn, startSession } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  try {
    const user = await signIn(body.email ?? "", body.password ?? "");
    await startSession(user.id);
    return NextResponse.json({ user });
  } catch (err) {
    // Deliberately vague, and the same for an unknown address as for a wrong password.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not sign in." },
      { status: 401 },
    );
  }
}
