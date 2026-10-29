import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";

export const runtime = "nodejs";

/** Who is signed in, if anyone. The shell asks this once on load. */
export async function GET() {
  return NextResponse.json({ user: await currentUser() }, { headers: { "cache-control": "no-store" } });
}
