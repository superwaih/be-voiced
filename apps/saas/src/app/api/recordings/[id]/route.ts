import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser, Unauthorised } from "@/server/auth";
import { db } from "@/server/db";
import { recordings } from "@/server/db/schema";
import { playbackUrl } from "@/server/storage";

export const runtime = "nodejs";

/** One recording, with a URL the browser can play it from. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const [row] = await db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, id), eq(recordings.userId, user.id)));

    if (!row) return NextResponse.json({ error: "That recording is not here." }, { status: 404 });

    // Signed and short-lived, so the bucket itself never has to be public.
    const media = row.storageKey ? await playbackUrl(row.storageKey) : null;
    return NextResponse.json({ recording: row, media }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof Unauthorised) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}

/** Saves the project document — transcript, moments, clips, caption style. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const body = (await request.json()) as { name?: string; document?: unknown; duration?: number };

    const [updated] = await db
      .update(recordings)
      .set({
        ...(body.name ? { name: body.name.slice(0, 200) } : {}),
        ...(body.document !== undefined ? { document: body.document } : {}),
        ...(typeof body.duration === "number" ? { duration: body.duration } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(recordings.id, id), eq(recordings.userId, user.id)))
      .returning();

    if (!updated) return NextResponse.json({ error: "That recording is not here." }, { status: 404 });
    return NextResponse.json({ recording: updated });
  } catch (err) {
    if (err instanceof Unauthorised) return NextResponse.json({ error: err.message }, { status: 401 });
    return NextResponse.json({ error: "Could not save that recording." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    // Jobs cascade with the recording; the media is left to the retention sweep.
    const [gone] = await db
      .delete(recordings)
      .where(and(eq(recordings.id, id), eq(recordings.userId, user.id)))
      .returning({ id: recordings.id });

    if (!gone) return NextResponse.json({ error: "That recording is not here." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof Unauthorised) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }
}
