/**
 * Someone's recordings.
 *
 * These used to live in the browser's localStorage, which is per-browser rather than per-person:
 * two people signing in on one machine saw each other's work. They live here now, scoped to the
 * account, which is also what lets a library follow someone between devices.
 */

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser, Unauthorised } from "@/server/auth";
import { db } from "@/server/db";
import { recordings } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(recordings)
      .where(eq(recordings.userId, user.id))
      .orderBy(desc(recordings.updatedAt));

    return NextResponse.json({ recordings: rows }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof Unauthorised) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
