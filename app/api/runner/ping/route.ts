import { NextResponse } from "next/server";
import { authenticateRunner, touchPresence, recordTelemetry } from "@/lib/runner-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Heartbeat + fallback presence. The runner pings this on a background thread so it
 * stays "online" even while busy on a long job (when it isn't polling for work).
 * A light lastSeenAt stamp by default; ?full=1 records the full machine stats too
 * so the resource monitor stays fresh without a heavy write every beat.
 */
export async function GET(req: Request) {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }
  await (full ? recordTelemetry(runner, req) : touchPresence(runner, req));
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
