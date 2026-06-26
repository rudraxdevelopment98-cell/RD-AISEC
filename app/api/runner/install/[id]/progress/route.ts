import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/**
 * The runner streams a running install's partial output here (live verbose).
 * Updates the install's output without changing its status. Auth by runner token.
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

  const install = await prisma.install.findUnique({ where: { id: params.id } });
  if (!install || install.runnerId !== runner.id) {
    return NextResponse.json({ error: "Install not found" }, { status: 404 });
  }
  if (install.status !== "installing") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const output = String(body.output ?? "").slice(0, MAX_OUTPUT_CHARS);
  await prisma.install.update({ where: { id: install.id }, data: { output } });
  return NextResponse.json({ ok: true });
}
