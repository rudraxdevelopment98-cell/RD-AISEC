import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

/**
 * The runner polls this endpoint for its next job. Authenticated by the runner
 * bearer token (NOT a user session). Atomically claims the oldest queued job
 * assigned to this runner and returns its tool/target/args. 204 when idle.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  // Find the oldest queued job for this runner, then claim it with a guarded
  // update so two concurrent polls can't grab the same job.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.job.findFirst({
      where: { runnerId: runner.id, status: "queued" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return new NextResponse(null, { status: 204 });

    const claimed = await prisma.job.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: new Date() },
    });
    if (claimed.count === 1) {
      return NextResponse.json({
        id: next.id,
        tool: next.tool,
        target: next.target,
        args: next.args,
      });
    }
    // Lost the race; loop and try the next queued job.
  }
  return new NextResponse(null, { status: 204 });
}
