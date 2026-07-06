import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/runner-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Heartbeat. The runner pings this on a background thread so it stays "online"
 * even while it's busy executing a long job or install (when it isn't polling
 * for new work). authenticateRunner stamps lastSeenAt.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  // Deliver a portal-requested restart once, then clear the flag.
  if (runner.restartRequested) {
    await prisma.runner
      .update({ where: { id: runner.id }, data: { restartRequested: false } })
      .catch(() => {});
    const res = new NextResponse(null, { status: 204 });
    res.headers.set("X-Runner-Command", "restart");
    return res;
  }
  return new NextResponse(null, { status: 204 });
}
