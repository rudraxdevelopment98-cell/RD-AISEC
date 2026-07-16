import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

// Keep a single event line bounded — the full output still rides on /progress and
// /result; these are the live task-graph step beats.
const MAX_MSG = 2000;
const KINDS = new Set(["progress", "step", "status", "log"]);

/**
 * Runner v2 realtime bus — INGEST. The agent appends task-graph step events here
 * as they happen (running / done / error / refused / skipped). Each row gets a
 * monotonic `seq` the UI tails by. Authenticated by the runner token; the job
 * must belong to this runner. Accepts one event or a batch.
 *
 *   POST { events: [{ kind, step, status, message }, ...] }
 *   POST { kind, step, status, message }
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const runner = await authenticateRunner(req, { light: true });
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: { id: true, runnerId: true },
  });
  if (!job || job.runnerId !== runner.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const raw = Array.isArray(body.events) ? body.events : [body];
  const rows = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .slice(0, 100) // never let one post write an unbounded batch
    .map((e) => {
      const kind = String(e.kind ?? "progress");
      return {
        jobId: job.id,
        kind: KINDS.has(kind) ? kind : "log",
        step: String(e.step ?? "").slice(0, 200),
        status: String(e.status ?? "").slice(0, 40),
        message: String(e.message ?? "").slice(0, MAX_MSG),
      };
    });

  if (rows.length === 0) return NextResponse.json({ ok: true, written: 0 });

  await prisma.taskEvent.createMany({ data: rows }).catch(() => {});
  return NextResponse.json({ ok: true, written: rows.length });
}
