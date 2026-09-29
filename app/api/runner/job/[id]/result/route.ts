import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner, recordTelemetry } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";
import { parseJobFindings, parseSecrets } from "@/lib/job-parser";
import { IDOR_TOOL, parseIdorResult } from "@/lib/idor-scan";
import { ingestFindings } from "@/lib/finding-ingest";
import { parseSubdomains } from "@/lib/bugbounty-core";
import { queueHostScans, queueExploitJobs, queueEndpointScans, queueJsSecretScans, queueParamDiscovery, RECON_TOOLS } from "@/lib/bug-pipeline";
import { parseValidationProof, VALIDATE_PREFIX } from "@/lib/engine/validators";
import { extractEndpoints, jsUrls } from "@/lib/recon-extract";

// Crawl tools whose output is a URL surface to mine + re-scan (iterative recon).
const CRAWL_TOOLS = new Set(["katana", "gau", "gospider", "waybackurls", "hakrawler"]);
import { onPipelineJobFinished } from "@/lib/pipeline-engine";
import { selfHealFailedJob } from "@/lib/self-heal";
import { recomputeEngagementIntel } from "@/lib/engine/finding-intel";

export const dynamic = "force-dynamic";
// Give the import chain room to commit (parse → gate → dedup → enrich → create →
// chain) instead of the 10s Hobby default, so a slow DB read can't time the
// request out mid-import.
export const maxDuration = 60;

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
  await recordTelemetry(runner, req);

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
  // A per-tool timeout (exit 124) that still produced output is a PARTIAL success,
  // not a failure: long scanners (nuclei, sqlmap, nmap -p-) routinely exhaust their
  // time budget, but the findings they DID collect are valuable. Count it as done
  // so those findings import — and so self-heal doesn't burn another full timeout
  // re-running the same scan.
  const hasPartialResults = exitCode === 124 && output.trim().length > 0;
  const status =
    (body.status === "failed" || exitCode !== 0) && !hasPartialResults ? "failed" : "done";

  const pipelineJob = !!job.stage;
  const isValidation = (job.queuedBy ?? "").startsWith(VALIDATE_PREFIX);
  // A successful auto-import job does its finding import BEFORE it is marked done.
  const doImport = status !== "failed" && !isValidation && job.autoImport && !!job.engagementId;

  // Claim the job. Only the first POST wins the transition. A failed/validation/
  // non-import job goes straight to its terminal status. A success-with-import
  // goes to an intermediate "importing" state so the findings COMMIT before the
  // job is marked done: if this request dies mid-import, a retry (status still
  // "importing", which is in the claim set) safely re-runs it — dedup makes
  // re-import idempotent. This closes the old "job done but findings lost" hole.
  const claimTarget = doImport ? "importing" : status;
  const claimed = await prisma.job.updateMany({
    where: { id: job.id, status: { in: ["queued", "running", "importing"] } },
    data: { output, exitCode, status: claimTarget, finishedAt: doImport ? null : new Date() },
  });
  if (claimed.count !== 1) {
    return NextResponse.json({ ok: true, alreadyFinished: true });
  }

  // Exploit-validation ("prove it") jobs: parse the per-class proof and, ONLY if
  // proven, mark the finding confirmed + record the evidence. Unproven findings
  // stay unconfirmed (never surfaced as reportable). Not a normal import path.
  if (isValidation) {
    const findingId = job.queuedBy!.slice(VALIDATE_PREFIX.length);
    const verdict = parseValidationProof(job.tool, output);
    if (verdict.proven && findingId) {
      await prisma.finding.update({
        where: { id: findingId },
        data: { confirmed: true, proof: `${verdict.method}: ${verdict.evidence}`.slice(0, 300) },
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, validated: verdict.proven, method: verdict.method });
  }

  // Bug-bounty automation (no human in the loop). Findings import runs through the
  // ONE shared chain (lib/finding-ingest.ts) — gate → suppress → dedup → enrich →
  // create → notify → auto-validate — so every source stays consistent (no more
  // inline re-implementation drift). Pipeline-staged jobs still import, but their
  // downstream chaining is driven by the pipeline's own approval gates.
  if (doImport && job.engagementId) {
    const engagementId = job.engagementId;
    const runnerId = job.runnerId ?? runner.id;
    const host = job.target.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();

    // Build candidates — the two source-specific special cases stay at the source.
    let candidates;
    if (job.tool === IDOR_TOOL) {
      // Two-account IDOR/BOLA replay: parse the per-identity report with the
      // engagement's owner-data marker (differential access → findings).
      const eng = await prisma.engagement.findUnique({
        where: { id: engagementId },
        select: { idorMarker: true },
      });
      candidates = parseIdorResult(output, eng?.idorMarker || "").map((f) => ({
        title: f.title,
        severity: f.severity,
        status: "open",
        description: `${f.description}\nEvidence: ${f.evidence}`,
        recommendation:
          "Enforce object-level authorization server-side: on every request, verify the authenticated user owns / is permitted the referenced object — not merely that they are logged in. Use unguessable ids where feasible.",
        confirmed: f.severity === "critical",
      }));
    } else {
      candidates = parseJobFindings(job.tool, job.target, output);
      // Secret-scan crawl output too (gau/wayback/gospider URLs often carry leaked
      // tokens in query strings; dedup covers the katana overlap).
      if (CRAWL_TOOLS.has(job.tool)) {
        candidates = [...candidates, ...parseSecrets(job.target, output)];
      }
    }

    // The one accuracy chain, shared with every other ingest source.
    const { fresh } = await ingestFindings(engagementId, candidates, { tool: job.tool, host });

    // Source-specific follow-up chaining (suppressed for pipeline-staged jobs).
    if (!pipelineJob) {
      if (job.tool === "amass" || job.tool === "subfinder") {
        // Chain: discovered subdomains → httpx + nuclei scans on the same runner.
        const hosts = parseSubdomains(output);
        if (hosts.length > 0) await queueHostScans(engagementId, runnerId, hosts, job.queuedBy, 15);
      } else if (CRAWL_TOOLS.has(job.tool)) {
        // Iterative recon: a crawl reveals a new URL surface — mine + re-scan it.
        const urls = extractEndpoints(output, job.target);
        await queueEndpointScans(engagementId, runnerId, urls, job.queuedBy, 15);
        await queueJsSecretScans(engagementId, runnerId, jsUrls(urls), job.queuedBy, 20);
        await queueParamDiscovery(engagementId, runnerId, urls, job.queuedBy, 12);
      }
      // Auto-exploit: from fresh RECON findings, queue exploit-validation jobs on
      // the same runner. Their results come back through this same route.
      if (RECON_TOOLS.has(job.tool) && fresh.length > 0) {
        await queueExploitJobs(engagementId, runnerId, fresh, job.queuedBy);
      }
    }

    if (fresh.length > 0) {
      // Recompute risk across the engagement so attack chains elevate in triage.
      await recomputeEngagementIntel(engagementId).catch(() => {});
    }

    // Findings are committed — NOW mark the job done.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "done", finishedAt: new Date() },
    });
  }

  // Self-healing: a recoverable runner-side failure (missing tool, timeout, dead
  // runner, transient network) → diagnose, fix (queue an install when needed),
  // and re-queue the work in the background, bounded by Job.retries. Runs BEFORE
  // the pipeline check so a queued retry keeps the stage from advancing on a
  // transient failure.
  if (status === "failed") {
    await selfHealFailedJob({
      tool: job.tool,
      target: job.target,
      args: job.args,
      output,
      exitCode,
      retries: job.retries,
      engagementId: job.engagementId,
      runnerId: job.runnerId,
      queuedBy: job.queuedBy,
      stage: job.stage,
      autoImport: job.autoImport,
      priority: job.priority,
    });
  }

  // Guided-assessment pipeline: when a staged job reaches a terminal state, let
  // the engine check whether the stage is complete and advance / await approval.
  if (pipelineJob && job.engagementId) {
    await onPipelineJobFinished({ engagementId: job.engagementId, stage: job.stage });
  }

  return NextResponse.json({ ok: true });
}
