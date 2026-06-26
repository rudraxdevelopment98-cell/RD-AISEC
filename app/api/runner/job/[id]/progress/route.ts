import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/**
 * The runner streams a running job's partial output here (live verbose). Updates
 * the job's stored output without changing its status. Authenticated by the
 * runner token; the job must belong to this runner and still be running.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  let body: { output?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job || job.runnerId !== runner.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  // Only update while running — ignore late progress after completion.
  if (job.status !== "running") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const output = String(body.output ?? "").slice(0, MAX_OUTPUT_CHARS);
  await prisma.job.update({ where: { id: job.id }, data: { output } });
  return NextResponse.json({ ok: true });
}
