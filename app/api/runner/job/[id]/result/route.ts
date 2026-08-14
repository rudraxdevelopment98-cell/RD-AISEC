import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateRunner, recordTelemetry } from "@/lib/runner-auth";
import { MAX_OUTPUT_CHARS } from "@/lib/runner-constants";
import { parseJobFindings } from "@/lib/job-parser";
import { IDOR_TOOL, parseIdorResult } from "@/lib/idor-scan";
import { tagFindings } from "@/lib/finding-map";
import { gateFindings } from "@/lib/finding-gate";
import { loadRules, recordSuppressions } from "@/lib/suppression";
import { filterSuppressed } from "@/lib/suppression-core";
import { dedupFindings } from "@/lib/dedup-core";
import { parseSubdomains } from "@/lib/bugbounty-core";
import { queueHostScans, queueExploitJobs, queueEndpointScans, RECON_TOOLS } from "@/lib/bug-pipeline";
import { extractEndpoints } from "@/lib/recon-extract";

// Crawl tools whose output is a URL surface to mine + re-scan (iterative recon).
const CRAWL_TOOLS = new Set(["katana", "gau", "gospider", "waybackurls", "hakrawler"]);
import { onPipelineJobFinished } from "@/lib/pipeline-engine";
import { selfHealFailedJob } from "@/lib/self-heal";
import { notifyFindings } from "@/lib/notify";
import { enrichFindingsIntel, recomputeEngagementIntel } from "@/lib/engine/finding-intel";

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
      // Iterative recon: a crawl (katana/gau/…) reveals a new URL surface. Mine
      // its parameterized endpoints and re-scan them (dalfox + nuclei DAST) — the
      // feedback loop that turns one-shot recon into real coverage. Findings from
      // the crawl are still parsed below; this only ADDS the follow-up scans.
      if (CRAWL_TOOLS.has(job.tool) && !pipelineJob) {
        const urls = extractEndpoints(output, job.target);
        await queueEndpointScans(job.engagementId, job.runnerId ?? runner.id, urls, job.queuedBy, 15);
      }
      // Parse results into findings, then run every candidate through the
      // accuracy gate (freshness + proof engines) so patched/banner-only false
      // positives are dropped or de-confirmed BEFORE they become findings.
      // Two-account IDOR/BOLA replay: parse the runner's per-identity report with
      // the engagement's owner-data marker (differential access → findings). Every
      // other tool goes through the generic parser.
      let candidates;
      if (job.tool === IDOR_TOOL) {
        const eng = await prisma.engagement.findUnique({
          where: { id: job.engagementId! },
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
      }
      let parsed = gateFindings(tagFindings(candidates, job.tool)).kept;
      // Learned false positives: drop candidates matching a rule you created by
      // marking a similar finding as a false positive before.
      const host = job.target.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
      const sup = filterSuppressed(parsed, await loadRules(), { tool: job.tool, host });
      parsed = sup.kept;
      if (sup.suppressed.length > 0) await recordSuppressions(sup.suppressed, {});
      if (parsed.length > 0) {
        const existing = await prisma.finding.findMany({
          where: { engagementId: job.engagementId },
          select: { id: true, title: true, description: true, sources: true },
        });
        // Signature de-dup + cross-tool corroboration (merge, don't duplicate).
        const { fresh, merges } = dedupFindings(parsed, existing, job.tool, host);
        for (const m of merges) {
          await prisma.finding.update({ where: { id: m.id }, data: { sources: m.sources } }).catch(() => {});
        }
        if (fresh.length > 0) {
          // Stamp real threat intel (KEV/EPSS) + a risk score so triage ranks by
          // real-world danger, not just static severity.
          const enriched = await enrichFindingsIntel(fresh);
          await prisma.finding.createMany({
            data: enriched.map((f) => ({ ...f, engagementId: job.engagementId! })),
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
        // Recompute risk across the whole engagement so attack chains (e.g. this
        // new finding + an existing one on the same asset) elevate risk in triage.
        await recomputeEngagementIntel(job.engagementId).catch(() => {});
      }
    }
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
