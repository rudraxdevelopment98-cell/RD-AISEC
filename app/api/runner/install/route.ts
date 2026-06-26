import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { INSTALLABLE_PKGS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/**
 * The runner polls this for the next pending install request assigned to it.
 * Atomically claims it (→ installing) and returns the tool id. 204 when none.
 */
export async function GET(req: Request) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.install.findFirst({
      where: { runnerId: runner.id, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return new NextResponse(null, { status: 204 });

    const claimed = await prisma.install.updateMany({
      where: { id: next.id, status: "pending" },
      data: { status: "installing" },
    });
    if (claimed.count === 1) {
      // Send the apt package name so the runner doesn't need its own map.
      return NextResponse.json({
        id: next.id,
        tool: next.tool,
        pkg: INSTALLABLE_PKGS[next.tool] ?? null,
      });
    }
  }
  return new NextResponse(null, { status: 204 });
}
