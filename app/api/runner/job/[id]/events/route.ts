import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Runner v2 realtime bus — TAIL (for the UI). Returns this job's task-graph events
 * with `seq` greater than the `?after=` cursor, in order, so a client can poll
 * every second or two and render a live step stream. User-session authenticated
 * (this is the portal side, not the runner). Also reports the job's current
 * status so the poller knows when to stop.
 *
 *   GET /api/runner/job/<id>/events?after=<seq>&limit=<n>
 *   → { status, events: [{ seq, kind, step, status, message, createdAt }], cursor }
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200));

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: { id: true, status: true },
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const events = await prisma.taskEvent.findMany({
    where: { jobId: job.id, seq: { gt: after } },
    orderBy: { seq: "asc" },
    take: limit,
  });

  const cursor = events.length > 0 ? events[events.length - 1].seq : after;
  return NextResponse.json({ status: job.status, events, cursor });
}
