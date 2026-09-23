// Auto-validation loop — the engine PROVES its own findings.
//
// Manual "Prove it" (lib/validate.ts) queues a per-class proof job for one
// finding on a button click. That is fine for a human triaging one bug, but the
// goal is autonomous: the moment the pipeline ingests a validatable finding on an
// AUTHORIZED engagement, queue the proof job itself — so proven+novel+reportable
// comes out the end without a person clicking through every candidate.
//
// The result route parses the proof and, only if PROVEN, sets finding.confirmed +
// finding.proof. Unproven findings stay unreportable. Same gate, no human needed.
//
// SAFETY: only authorized engagements are ever touched (validators are LIVE probes
// against the real target). Read-only / non-destructive validators only. Bounded
// per call so a big ingest can't flood the runner. Idempotent — never double-queues
// a finding that already has a validation job. See docs/ENGINE-EARNING-RESEARCH.md.

import { prisma } from "@/lib/db";
import { findingTarget } from "@/data/exploit-playbook";
import { validatableClass, validationJobFor, VALIDATE_PREFIX } from "@/lib/engine/validators";
import { classifySecretValue } from "@/lib/engine/secret-value";
import { pickRunnerId } from "@/lib/pipeline-engine";
import { JOB_PRIORITY } from "@/lib/runner-constants";
import { hostInScope, scopeHosts } from "@/lib/engine/ai-browse";
import { logAudit } from "@/lib/audit";

// Most proof jobs to queue in a single ingest, so one noisy scan can't bury the
// runner under validators. The rest get picked up on the next ingest / re-run.
const AUTO_VALIDATE_BUDGET = 6;

export type AutoValidateResult = { queued: number; reason?: string };

/**
 * Queue automated proof jobs for freshly-ingested, still-unproven, validatable
 * findings on an authorized engagement. Safe to call after every ingest — it is
 * bounded and idempotent, and returns quietly (no throw) when there is nothing to
 * do or no runner is online.
 */
export async function autoValidateFindings(engagementId: string): Promise<AutoValidateResult> {
  if (!engagementId) return { queued: 0, reason: "no engagement" };

  const eng = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { id: true, authorized: true, scope: true },
  });
  // Validators are LIVE probes against the target — only ever run them on an
  // engagement with recorded written authorization.
  if (!eng || !eng.authorized) return { queued: 0, reason: "engagement not authorized" };

  // Candidate findings: not already confirmed/proven. Newest first (freshest
  // signal), capped generously so we can filter down to the budget after the
  // per-class / idempotency checks.
  const candidates = await prisma.finding.findMany({
    where: { engagementId, confirmed: false },
    select: { id: true, title: true, category: true, description: true },
    orderBy: { createdAt: "desc" },
    take: AUTO_VALIDATE_BUDGET * 6,
  });
  if (candidates.length === 0) return { queued: 0 };

  // Don't re-queue a finding that already has a validation job (any status).
  const already = await prisma.job.findMany({
    where: { engagementId, queuedBy: { startsWith: VALIDATE_PREFIX } },
    select: { queuedBy: true },
  });
  const validated = new Set(already.map((j) => j.queuedBy.slice(VALIDATE_PREFIX.length)));

  const scope = scopeHosts(eng.scope);

  // Build the work list first (pure), then only touch the runner if there's work.
  const work: { id: string; cls: string; target: string; tool: string; args: string; method: string }[] = [];
  for (const f of candidates) {
    if (work.length >= AUTO_VALIDATE_BUDGET) break;
    if (validated.has(f.id)) continue;
    const cls = validatableClass(f);
    if (!cls) continue;
    // Don't spend a runner cycle live-probing a public-by-design key (Google
    // AIza / Firebase / Stripe publishable / Sentry DSN…): it's not live-provable
    // and not payable. Privileged/unknown secrets still get validated.
    if (cls === "secret" && classifySecretValue(`${f.title ?? ""} ${f.description ?? ""}`).value === "public") continue;
    const { host, url } = findingTarget(f);
    // secretvalidate re-fetches the SOURCE URL to re-extract the key, so it needs
    // a real URL (a bare host makes it no-op). Other validators accept host too.
    const target = cls === "secret" ? url : url || host;
    if (!target) continue;
    // SAFETY: findingTarget just greps the first URL out of the finding text,
    // which can be an attacker/callback host quoted in an SSRF/redirect payload
    // (e.g. https://evil.com). Never fire a live validator at a host the
    // engagement scope didn't name.
    if (!hostInScope(host, scope)) continue;
    const job = validationJobFor(cls, target);
    if (!job) continue;
    work.push({ id: f.id, cls, target, tool: job.tool, args: job.args, method: job.method });
  }
  if (work.length === 0) return { queued: 0 };

  const runnerId = await pickRunnerId();
  if (!runnerId) return { queued: 0, reason: "no runner online" };

  for (const w of work) {
    await prisma.job.create({
      data: {
        engagementId,
        runnerId,
        tool: w.tool,
        target: w.target,
        args: w.args,
        autoImport: false, // proof job — parsed by the validation branch, not imported as a new finding
        queuedBy: `${VALIDATE_PREFIX}${w.id}`,
        priority: JOB_PRIORITY.exploit, // proof runs ahead of routine recon/scan
      },
    });
  }

  await logAudit({
    type: "finding.autovalidate",
    actor: "engine",
    summary: `Auto-queued ${work.length} proof job(s): ${work.map((w) => `${w.cls}/${w.tool}`).join(", ")}`,
    target: engagementId,
  });

  return { queued: work.length };
}
