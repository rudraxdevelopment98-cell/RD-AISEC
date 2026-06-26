import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

/**
 * The runner posts the result of an install here.
 * Body: { output: string, exitCode: number }.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  let body: { output?: unknown; exitCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const install = await prisma.install.findUnique({ where: { id: params.id } });
  if (!install || install.runnerId !== runner.id) {
    return NextResponse.json({ error: "Install not found" }, { status: 404 });
  }

  const output = String(body.output ?? "").slice(0, MAX_OUTPUT_CHARS);
  const exitCode =
    typeof body.exitCode === "number" ? body.exitCode : Number(body.exitCode ?? 0) || 0;

  await prisma.install.update({
    where: { id: install.id },
    data: {
      status: exitCode === 0 ? "done" : "failed",
      output,
      exitCode,
      finishedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
