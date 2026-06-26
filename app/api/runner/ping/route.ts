import { NextResponse } from "next/server";
import { authenticateRunner } from "@/lib/runner-auth";

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
  return new NextResponse(null, { status: 204 });
}
