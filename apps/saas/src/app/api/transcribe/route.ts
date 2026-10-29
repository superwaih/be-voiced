/**
 * Asking for a transcription.
 *
 * This does almost nothing, on purpose: it writes a row and puts a message on the queue, then
 * replies. The work happens in a worker process — see `server/worker.ts` — so a thousand people
 * asking at once produces a thousand rows and no load on the thing serving the app.
 *
 * The media was already uploaded straight to object storage (`/api/uploads`), so there is no file
 * here to hold, buffer or copy.
 *
 * The row and the queue message are written in **one transaction**. Either the job exists and is
 * queued, or neither happened; there is no state where someone is waiting for work nobody has.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { serverCanTranscribe, whisperModel } from "@/server/config";
import { currentUserId, Unauthorised } from "@/server/auth";
import { db } from "@/server/db";
import { jobs, recordings } from "@/server/db/schema";
import { enqueueTranscription } from "@/server/queue";

export const runtime = "nodejs";

/** What this deployment can do, so the browser knows before it uploads anything. */
export async function GET() {
  const whisper = serverCanTranscribe();
  return NextResponse.json({
    available: whisper,
    engine: whisper ? "whisper" : null,
    model: whisper ? whisperModel().split(/[\\/]/).pop() : null,
  });
}

export async function POST(request: Request) {
  let body: { recordingId?: string; language?: string; duration?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!body.recordingId) {
    return NextResponse.json({ error: "Which recording?" }, { status: 400 });
  }
  if (!serverCanTranscribe()) {
    return NextResponse.json(
      { error: "This server has no transcription set up. See the README for what it needs." },
      { status: 503 },
    );
  }

  try {
    const userId = await currentUserId();
    const [recording] = await db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, body.recordingId), eq(recordings.userId, userId)));

    if (!recording) return NextResponse.json({ error: "That recording is not yours." }, { status: 404 });
    if (!recording.storageKey) {
      return NextResponse.json({ error: "That recording has not finished uploading." }, { status: 409 });
    }

    const language = body.language || "auto";
    const duration = body.duration ?? recording.duration ?? 0;

    // One transaction: the row people poll and the message a worker picks up.
    const job = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(jobs)
        .values({ recordingId: recording.id, userId, kind: "transcribe", status: "queued", stage: "Waiting" })
        .returning();

      await enqueueTranscription({
        jobId: created.id,
        recordingId: recording.id,
        userId,
        storageKey: recording.storageKey,
        language,
        duration,
      });
      return created;
    });

    return NextResponse.json(
      { id: job.id, status: job.status, stage: job.stage, progress: null, detail: null },
      { status: 202 },
    );
  } catch (err) {
    if (err instanceof Unauthorised) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("Could not queue a transcription", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not queue that transcription." },
      { status: 500 },
    );
  }
}
