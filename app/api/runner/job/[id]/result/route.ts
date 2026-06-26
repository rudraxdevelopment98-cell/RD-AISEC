import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";
import { parseJobFindings } from "@/lib/job-parser";
import { tagFindings } from "@/lib/finding-map";

export const dynamic = "force-dynamic";

/**
 * The runner posts a job's result here when it finishes executing.
 * Body: { output: string, exitCode: number, status?: "done" | "failed" }.
 * Authenticated by the runner token; the job must belong to this runner.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const runner = await authenticateRunner(req);
  if (!runner) {
    return NextResponse.json({ error: "Invalid runner token" }, { status: 401 });
  }

  let body: { output?: unknown; exitCode?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const job = await prisma.job.findUnique({ where: { id: params.id } });
  if (!job || job.runnerId !== runner.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const output = String(body.output ?? "").slice(0, MAX_OUTPUT_CHARS);
  const exitCode =
    typeof body.exitCode === "number" ? body.exitCode : Number(body.exitCode ?? 0) || 0;
  const status = body.status === "failed" || exitCode !== 0 ? "failed" : "done";

  await prisma.job.update({
    where: { id: job.id },
    data: { output, exitCode, status, finishedAt: new Date() },
  });

  // Bug-bounty automation: parse results into findings automatically (deduped),
  // since there's no human to click "Import".
  if (status === "done" && job.autoImport && job.engagementId) {
    const parsed = tagFindings(parseJobFindings(job.tool, job.target, output), job.tool);
    if (parsed.length > 0) {
      const existing = await prisma.finding.findMany({
        where: { engagementId: job.engagementId },
        select: { title: true },
      });
      const seen = new Set(existing.map((f) => f.title));
      const fresh = parsed.filter((f) => !seen.has(f.title));
      if (fresh.length > 0) {
        await prisma.finding.createMany({
          data: fresh.map((f) => ({ ...f, engagementId: job.engagementId! })),
        });
        await prisma.engagement.update({
          where: { id: job.engagementId },
          data: { updatedAt: new Date() },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
