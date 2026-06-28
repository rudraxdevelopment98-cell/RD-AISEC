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

  // Tell the runner its desired anonymity + parallelism on every poll (idle or
  // not), so changing them in the portal takes effect without restarting it.
  const anon = runner.anonymity ? "on" : "off";
  const workers = String(Math.min(16, Math.max(1, runner.maxWorkers || 3)));
  const setHeaders = (r: NextResponse) => {
    r.headers.set("X-Runner-Anonymity", anon);
    r.headers.set("X-Runner-Max-Workers", workers);
    return r;
  };
  const idle = () => setHeaders(new NextResponse(null, { status: 204 }));

  // Claim the highest-priority queued job for this runner (ties broken by age),
  // with a guarded update so two concurrent polls can't grab the same job.
  // "Run next" / "Run first" raise a job's priority above the rest of the queue.
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.job.findFirst({
      where: { runnerId: runner.id, status: "queued" },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    if (!next) return idle();

    const claimed = await prisma.job.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "running", startedAt: new Date() },
    });
    if (claimed.count === 1) {
      return setHeaders(
        NextResponse.json({
          id: next.id,
          tool: next.tool,
          target: next.target,
          args: next.args,
        }),
      );
    }
    // Lost the race; loop and try the next queued job.
  }
  return idle();
}
