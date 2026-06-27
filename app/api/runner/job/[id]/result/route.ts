import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";
import { parseJobFindings } from "@/lib/job-parser";
import { tagFindings } from "@/lib/finding-map";
import { parseSubdomains } from "@/lib/bugbounty-core";
import { queueHostScans, queueExploitJobs, RECON_TOOLS } from "@/lib/bug-pipeline";
import { onPipelineJobFinished } from "@/lib/pipeline-engine";
import { notifyFindings } from "@/lib/notify";

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

  // Only the first result for a still-active job is processed. A retried POST
  // (network hiccup after a successful save) would otherwise re-auto-import
  // findings or re-queue amass host scans.
  const claimed = await prisma.job.updateMany({
    where: { id: job.id, status: { in: ["queued", "running"] } },
    data: { output, exitCode, status, finishedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ ok: true, alreadyFinished: true });
  }

  // Bug-bounty automation (no human in the loop). Pipeline-staged jobs
  // (job.stage set) still auto-import findings, but their downstream chaining is
  // driven by the pipeline's own approval gates — so the result-route chains
  // (amass→scan, recon→auto-exploit) are suppressed for them.
  const pipelineJob = !!job.stage;
  if (status === "done" && job.autoImport && job.engagementId) {
    if (job.tool === "amass" || job.tool === "subfinder") {
      // Chain: discovered subdomains → httpx + nuclei scans on the same runner.
      const hosts = parseSubdomains(output);
      if (hosts.length > 0 && !pipelineJob) {
        await queueHostScans(
          job.engagementId,
          job.runnerId ?? runner.id,
          hosts,
          job.queuedBy,
          15,
        );
      }
    } else {
      // Parse results into findings automatically (deduped), then notify.
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
          const eng = await prisma.engagement.update({
            where: { id: job.engagementId },
            data: { updatedAt: new Date() },
            select: { name: true },
          });
          await notifyFindings(fresh, eng.name);

          // Auto-exploit: from fresh RECON findings, queue exploit-validation
          // jobs (searchsploit / nmap vuln) on the same runner. Their results
          // come back through this same route and become findings too.
          if (RECON_TOOLS.has(job.tool) && job.runnerId && !pipelineJob) {
            await queueExploitJobs(job.engagementId, job.runnerId, fresh, job.queuedBy);
          }
        }
      }
    }
  }

  // Guided-assessment pipeline: when a staged job reaches a terminal state, let
  // the engine check whether the stage is complete and advance / await approval.
  if (pipelineJob && job.engagementId) {
    await onPipelineJobFinished({ engagementId: job.engagementId, stage: job.stage });
  }

  return NextResponse.json({ ok: true });
}
