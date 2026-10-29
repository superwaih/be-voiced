/**
 * How a job is getting on, and how to stop it.
 *
 * Read straight from the jobs table, so it does not matter which instance answers — the thing
 * doing the work is a different process on a different machine, and the row is the only thing
 * either of them shares.
 *
 * Polled rather than streamed. Server-sent events would be tidier and do not survive the proxies
 * and serverless front ends this is meant to run behind; a poll a second costs nothing next to
 * the transcription itself.
 */

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { currentUserId, Unauthorised } from "@/server/auth";
import { db } from "@/server/db";
import { jobs } from "@/server/db/schema";

export const runtime = "nodejs";

/** The job, only if it belongs to whoever is asking. Null covers both "missing" and "not yours". */
async function own(id: string) {
  const userId = await currentUserId();
  const [job] = await db.select().from(jobs).where(and(eq(jobs.id, id), eq(jobs.userId, userId)));
  return job;
}

const unauthorised = () => NextResponse.json({ error: "Sign in first." }, { status: 401 });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job;
  try {
    job = await own(id);
  } catch (err) {
    if (err instanceof Unauthorised) return unauthorised();
    throw err;
  }
  if (!job) return NextResponse.json({ error: "That job is not here." }, { status: 404 });

  return NextResponse.json(
    {
      id: job.id,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      detail: job.detail,
      error: job.error,
      result: job.result,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let job;
  try {
    job = await own(id);
  } catch (err) {
    if (err instanceof Unauthorised) return unauthorised();
    throw err;
  }
  if (!job) return NextResponse.json({ error: "That job is not here." }, { status: 404 });
  if (job.status === "done" || job.status === "failed") {
    return NextResponse.json({ cancelled: false });
  }

  // The worker checks this before each step and when a redelivery arrives, so marking it is
  // enough to stop it — there is no process here to signal.
  await db
    .update(jobs)
    .set({ status: "cancelled", stage: "Cancelled", finishedAt: new Date() })
    .where(eq(jobs.id, id));

  return NextResponse.json({ cancelled: true });
}
