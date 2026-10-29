/**
 * Somewhere to put a recording.
 *
 * Returns a short-lived URL the browser PUTs the file to **directly**, plus the recording row it
 * belongs to. The file does not pass through this server: that is what stops a thousand
 * simultaneous uploads from being a thousand buffers in its memory.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUserId, Unauthorised } from "@/server/auth";
import { db } from "@/server/db";
import { recordings } from "@/server/db/schema";
import { keyFor, uploadUrl } from "@/server/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { name?: string; contentType?: string; bytes?: number; duration?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const name = (body.name ?? "recording").slice(0, 200);
  const contentType = body.contentType || "application/octet-stream";

  try {
    const userId = await currentUserId();
    const [recording] = await db
      .insert(recordings)
      .values({
        userId,
        name,
        storageKey: "",
        contentType,
        bytes: body.bytes ?? null,
        duration: body.duration ?? null,
      })
      .returning();

    const key = keyFor(userId, recording.id, name);
    await db.update(recordings).set({ storageKey: key }).where(eq(recordings.id, recording.id));

    return NextResponse.json({
      recordingId: recording.id,
      storageKey: key,
      uploadUrl: await uploadUrl(key, contentType),
    });
  } catch (err) {
    if (err instanceof Unauthorised) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("Could not start an upload", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start an upload." },
      { status: 500 },
    );
  }
}
