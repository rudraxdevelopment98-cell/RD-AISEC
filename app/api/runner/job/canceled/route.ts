import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";

export const dynamic = "force-dynamic";

/**
 * The runner polls this to learn which of its jobs were canceled from the portal
 * so it can kill the still-running process and free its worker slot. Returns the
 * ids of recently-canceled jobs for this runner (last 30 min).
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  const since = new Date(Date.now() - 30 * 60_000);
  const jobs = await prisma.job.findMany({
    where: { runnerId: runner.id, status: "canceled", finishedAt: { gte: since } },
    select: { id: true },
    take: 200,
  });
  return NextResponse.json({ ids: jobs.map((j) => j.id) });
}
