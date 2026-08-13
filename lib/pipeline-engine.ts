// Assessment-pipeline engine — plain Node module (Prisma). Shared by the server
// actions (UI buttons) and the runner result route (job-completion advance).
//
// Stages run in order: recon → scan → exploit → triage → report. Job stages
// queue runner jobs tagged with `stage`; when every job in the active stage is
// terminal the pipeline either auto-advances (autoApprove) or waits for the
// user's approval. Computational stages (triage, report) run inline on advance.

import { prisma } from "@/lib/db";
import { parseScopeEntries } from "@/lib/bugbounty-core";
import { normalizeTarget, validateTarget } from "@/lib/runner-constants";
import { exploitActions } from "@/lib/exploit-core";
import { playbookFor } from "@/data/exploit-playbook";
import { assessFinding, groupForReport, worthAutomating } from "@/lib/bb-engine";
import { PIPELINE_STAGES, STAGE_ORDER, nextStageKey, stageDef } from "@/lib/pipeline-core";
import { JOB_STALE_MS, JOB_PRIORITY } from "@/lib/runner-constants";
import { reconSteps, scanDefaultSteps, planScanSteps, prioritizeHosts } from "@/lib/engine/strategy";

const TERMINAL = ["done", "failed", "canceled"];

/** Pick a runner: most recently seen first, else any. Returns id or "". */
export async function pickRunnerId(): Promise<string> {
  const r = await prisma.runner.findFirst({
    orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  return r?.id ?? "";
}

function bareHost(v: string): string {
  return v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
}

// Tools each JOB stage queues, with target mode (url adds http://, host is bare).
// Recon establishes what's alive and what it runs (so later stages have product
// versions to match exploits against); scan runs the high-signal vuln tools.
// `deep` trades runtime for coverage: all TCP ports + vuln NSE scripts, a bigger
// content-discovery wordlist, and a fuller nuclei pass.
// All tool/step definitions now live in one place — lib/engine/strategy.ts — so
// they can't drift between this pipeline and the bug-bounty one.
type Step = { tool: string; args: string; mode: "url" | "host" };
function stageSteps(stage: string, deep: boolean): Step[] {
  if (stage === "recon") return reconSteps();
  if (stage === "scan") return scanDefaultSteps(deep);
  return [];
}

/**
 * Queue the jobs for a JOB stage from the engagement's scope (deduped against
 * still-pending jobs). Returns the count queued. `exploit` derives its jobs from
 * current findings via exploitActions. Pipeline jobs carry `stage` so the result
 * route suppresses the auto-exploit chain and runs the pipeline advance instead.
 */
export async function queueStageJobs(
  engagementId: string,
  runnerId: string,
  stage: string,
  queuedBy: string,
  deep = false,
): Promise<number> {
  const eng = await prisma.engagement.findUnique({
    where: { id: engagementId },
    select: { scope: true },
  });
  if (!eng) return 0;

  const pending = await prisma.job.findMany({
    where: { engagementId, status: { in: ["queued", "running"] } },
    select: { tool: true, target: true, args: true },
  });
  const pendingKey = new Set(pending.map((j) => `${j.tool}|${j.target}`));
  // Args-aware key for the exploit stage, so a focused re-scan (same tool+target,
  // different args) isn't dropped just because a recon scan is still pending.
  const pendingKeyArgs = new Set(pending.map((j) => `${j.tool}|${j.target}|${j.args}`));

  type NewJob = {
    engagementId: string;
    runnerId: string;
    tool: string;
    target: string;
    args: string;
    autoImport: boolean;
    stage: string;
    queuedBy: string;
    priority: number;
  };
  const data: NewJob[] = [];
  const by = queuedBy || "pipeline";
  // Exploit-stage validation jumps ahead of routine recon/scan in the queue.
  const prio = stage === "exploit" ? JOB_PRIORITY.exploit : JOB_PRIORITY.normal;

  if (stage === "exploit") {
    const findings = await prisma.finding.findMany({
      where: { engagementId },
      select: { title: true, description: true, severity: true, owasp: true },
    });
    // Only spend the exploit budget on findings that could actually be a
    // vulnerability — not recon artifacts (open ports, missing headers, banners).
    // Matches the bug-bounty path's gate so the staged pipeline doesn't waste its
    // 10-job cap searchsploiting informational noise.
    const wanted = findings.filter((f) => worthAutomating(f)).flatMap((f) => exploitActions(f));
    const seen = new Set<string>();
    for (const a of wanted) {
      const target = normalizeTarget(a.tool, a.target);
      if (!validateTarget(a.tool, target)) continue;
      const k = `${a.tool}|${target}|${a.args}`;
      if (seen.has(k) || pendingKeyArgs.has(k)) continue;
      seen.add(k);
      data.push({ engagementId, runnerId, tool: a.tool, target, args: a.args, autoImport: true, stage, queuedBy: by, priority: prio });
      if (data.length >= 10) break;
    }
  } else {
    const steps = stageSteps(stage, deep);
    const entries = parseScopeEntries(eng.scope);
    const wildcards = entries.filter((e) => e.wildcard).map((e) => e.host).slice(0, 5);
    // Prioritize promising hosts (admin/api/staging/…) BEFORE the cap, so the
    // budget scans the juicy targets first instead of scope order.
    const hosts = prioritizeHosts(entries.map((e) => e.host)).slice(0, 15);

    // Recon also enumerates subdomains for wildcard scopes.
    if (stage === "recon") {
      for (const d of wildcards) {
        if (validateTarget("amass", d) && !pendingKey.has(`amass|${d}`)) {
          data.push({ engagementId, runnerId, tool: "amass", target: d, args: "enum -passive", autoImport: true, stage, queuedBy: by, priority: prio });
        }
      }
    }

    // Result-driven scan planning: for the SCAN stage, pick each host's tools from
    // what RECON found (WordPress→wpscan, TLS→sslscan, SMB→enum4linux, no web→skip
    // web tools). Falls back to the full default battery when a host has no signal,
    // so this never scans less than before by accident.
    let stepsForHost: (bare: string) => Step[] = () => steps;
    if (stage === "scan") {
      const recon = await prisma.finding.findMany({
        where: { engagementId },
        select: { title: true, description: true },
      });
      const texts = recon.map((f) => `${f.title}\n${f.description ?? ""}`);
      stepsForHost = (bare) =>
        planScanSteps(texts.filter((t) => t.toLowerCase().includes(bare.toLowerCase())), deep);
    }

    for (const host of hosts) {
      const bare = bareHost(host);
      if (!bare) continue;
      for (const step of stepsForHost(bare)) {
        const t = step.mode === "url" ? `http://${bare}` : bare;
        const target = normalizeTarget(step.tool, t);
        if (!validateTarget(step.tool, target) || pendingKey.has(`${step.tool}|${target}`)) continue;
        data.push({ engagementId, runnerId, tool: step.tool, target, args: step.args, autoImport: true, stage, queuedBy: by, priority: prio });
      }
    }
  }

  if (data.length > 0) await prisma.job.createMany({ data });
  return data.length;
}

/** Map a policy state to a short, filterable category tag for the findings list. */
function stateCategory(state: string): string {
  if (state === "confirmed_exploitable") return "confirmed";
  if (state === "validated") return "validated";
  if (state === "informational") return "informational";
  return "suspected";
}

/**
 * Triage: grade every finding under the bug-bounty policy engine and persist a
 * filterable state category, plus fill a remediation recommendation where one is
 * missing. Non-destructive — it only writes EMPTY fields (never overwrites a
 * user's category or an existing recommendation) and never changes severity.
 * Returns a summary including the validated risk score.
 */
export async function runTriage(engagementId: string): Promise<string> {
  const findings = await prisma.finding.findMany({
    where: { engagementId },
    select: {
      id: true,
      title: true,
      description: true,
      owasp: true,
      severity: true,
      confirmed: true,
      recommendation: true,
      category: true,
    },
  });

  let filledRec = 0;
  let categorized = 0;
  for (const f of findings) {
    const data: { recommendation?: string; category?: string } = {};

    if (!f.recommendation || !f.recommendation.trim()) {
      const rec = playbookFor(f).hardening.join(" ");
      if (rec) {
        data.recommendation = rec;
        filledRec += 1;
      }
    }

    if (!f.category || !f.category.trim()) {
      const q = assessFinding({
        title: f.title,
        description: f.description,
        severity: f.severity,
        confirmedFlag: f.confirmed,
      });
      data.category = stateCategory(q.state);
      categorized += 1;
    }

    if (Object.keys(data).length > 0) {
      await prisma.finding.update({ where: { id: f.id }, data });
    }
  }

  // Validated risk score (confirmed + validated only) for the summary line.
  const { riskScore, counts } = groupForReport(
    findings.map((f) => ({
      title: f.title,
      description: f.description,
      severity: f.severity,
      confirmedFlag: f.confirmed,
    })),
  );

  return (
    `${findings.length} finding(s) triaged · ${categorized} categorized · ${filledRec} remediation(s) added · ` +
    `validated risk ${riskScore}/100 (${counts.confirmed} confirmed, ${counts.validated} validated, ` +
    `${counts.suspected} suspected, ${counts.informational} informational)`
  );
}

/** Report-stage summary: the graded, validated-only risk (matches the report). */
async function reportSummary(engagementId: string): Promise<string> {
  const findings = await prisma.finding.findMany({
    where: { engagementId },
    select: { title: true, description: true, severity: true, confirmed: true },
  });
  const { riskScore, counts } = groupForReport(
    findings.map((f) => ({
      title: f.title,
      description: f.description,
      severity: f.severity,
      confirmedFlag: f.confirmed,
    })),
  );
  return (
    `Report ready · ${findings.length} finding(s) · validated risk ${riskScore}/100 ` +
    `(${counts.confirmed} confirmed, ${counts.validated} validated, ${counts.suspected} suspected)`
  );
}

/** Count a job stage's progress for the engagement. `since` scopes the count to
 * the current run (jobs created at/after the stage started), so an orphaned job
 * left non-terminal by a previous run can't block this run from completing. */
async function stageJobProgress(engagementId: string, stage: string, since?: Date | null) {
  const jobs = await prisma.job.findMany({
    where: { engagementId, stage, ...(since ? { createdAt: { gte: since } } : {}) },
    select: { status: true },
  });
  const total = jobs.length;
  const done = jobs.filter((j) => TERMINAL.includes(j.status)).length;
  return { total, done, complete: total > 0 && done === total };
}

/** The startedAt of a pipeline's current/given stage row (for run-scoping). */
async function stageStartedAt(pipelineId: string, key: string): Promise<Date | null> {
  const st = await prisma.pipelineStage.findFirst({
    where: { pipelineId, key },
    select: { startedAt: true },
  });
  return st?.startedAt ?? null;
}

/** Mark a stage's row by key. */
async function setStage(pipelineId: string, key: string, data: Record<string, unknown>) {
  await prisma.pipelineStage.updateMany({ where: { pipelineId, key }, data });
}

/**
 * Run the stage identified by `key`: queue its jobs (job stages) or do its work
 * inline (triage/report). Returns whether the stage completed immediately (no
 * jobs to wait on) so the caller can keep advancing when autoApprove is on.
 */
async function runStage(
  pipeline: { id: string; engagementId: string; runnerId: string; ownerEmail: string; deep?: boolean },
  key: string,
): Promise<{ immediate: boolean; summary: string }> {
  await setStage(pipeline.id, key, { status: "running", startedAt: new Date(), summary: "" });
  await prisma.pipeline.update({ where: { id: pipeline.id }, data: { currentKey: key, status: "running" } });

  const def = stageDef(key);
  if (def?.jobs) {
    const n = await queueStageJobs(pipeline.engagementId, pipeline.runnerId, key, pipeline.ownerEmail, !!pipeline.deep);
    if (n === 0) {
      // Nothing to do for this stage — complete immediately.
      await setStage(pipeline.id, key, { summary: "Nothing to run for this stage" });
      return { immediate: true, summary: "Nothing to run for this stage" };
    }
    return { immediate: false, summary: `${n} job(s) queued` };
  }

  if (key === "triage") {
    const summary = await runTriage(pipeline.engagementId);
    await setStage(pipeline.id, key, { summary });
    return { immediate: true, summary };
  }

  // report — summarize with the graded, validated-only risk (matches the report).
  const summary = await reportSummary(pipeline.engagementId);
  await setStage(pipeline.id, key, { summary });
  return { immediate: true, summary };
}

/**
 * Advance the pipeline from the current stage to the next. Marks the current
 * stage done, then runs the next. When autoApprove is on it keeps advancing
 * through stages that complete immediately (and waits on job stages to finish
 * via the result route). Bounded by the stage count.
 */
export async function advancePipeline(pipelineId: string): Promise<void> {
  for (let guard = 0; guard < PIPELINE_STAGES.length + 1; guard++) {
    const p = await prisma.pipeline.findUnique({ where: { id: pipelineId } });
    if (!p || p.status === "done" || p.status === "canceled") return;

    // Mark the current stage done.
    await setStage(p.id, p.currentKey, { status: "done", finishedAt: new Date() });

    const next = nextStageKey(p.currentKey);
    if (!next) {
      await prisma.pipeline.update({ where: { id: p.id }, data: { status: "done" } });
      return;
    }

    const res = await runStage(p, next);
    if (res.immediate) {
      if (p.autoApprove) continue; // keep going
      // Inline stage finished; wait for approval before the next.
      await prisma.pipeline.update({ where: { id: p.id }, data: { status: "awaiting_approval" } });
      return;
    }
    // Job stage queued work — completion is detected in the result route.
    return;
  }
}

/** Start (or restart) a pipeline for an engagement and run the first stage. */
export async function startPipeline(
  engagementId: string,
  runnerId: string,
  autoApprove: boolean,
  email: string,
  deep = false,
): Promise<void> {
  await prisma.pipeline.deleteMany({ where: { engagementId } });
  const pipeline = await prisma.pipeline.create({
    data: {
      engagementId,
      runnerId,
      autoApprove,
      deep,
      ownerEmail: email,
      status: "running",
      currentKey: STAGE_ORDER[0],
      stages: {
        create: PIPELINE_STAGES.map((s, i) => ({
          key: s.key,
          title: s.title,
          order: i,
          status: i === 0 ? "running" : "pending",
        })),
      },
    },
  });

  const res = await runStage(pipeline, STAGE_ORDER[0]);
  if (res.immediate) {
    if (autoApprove) await advancePipeline(pipeline.id);
    else await prisma.pipeline.update({ where: { id: pipeline.id }, data: { status: "awaiting_approval" } });
  }
}

/**
 * Re-run a single stage (optionally deep) without restarting the whole pipeline.
 * Sets that stage back to running and makes it the current stage, so completion
 * detection / approval resumes from here and cascades onward.
 */
export async function rerunStage(engagementId: string, stageKey: string, deep: boolean): Promise<void> {
  const p = await prisma.pipeline.findUnique({ where: { engagementId } });
  if (!p) return;
  const def = stageDef(stageKey);
  if (!def) return;

  await setStage(p.id, stageKey, {
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    summary: deep ? "re-running (deep)…" : "re-running…",
  });
  await prisma.pipeline.update({ where: { id: p.id }, data: { currentKey: stageKey, status: "running" } });

  let immediate = true;
  if (def.jobs) {
    const n = await queueStageJobs(p.engagementId, p.runnerId, stageKey, p.ownerEmail, deep);
    immediate = n === 0;
    await setStage(p.id, stageKey, {
      summary: n === 0 ? "Nothing new to run" : `${deep ? "deep re-run" : "re-run"} · ${n} job(s) queued`,
    });
  } else if (stageKey === "triage") {
    await setStage(p.id, stageKey, { summary: await runTriage(p.engagementId) });
  } else {
    await setStage(p.id, stageKey, { summary: await reportSummary(p.engagementId) });
  }

  if (immediate) {
    if (p.autoApprove) await advancePipeline(p.id);
    else await prisma.pipeline.update({ where: { id: p.id }, data: { status: "awaiting_approval" } });
  }
}

/** Approve the current (awaiting) stage and move on. */
export async function approveCurrentStage(engagementId: string): Promise<void> {
  const p = await prisma.pipeline.findUnique({ where: { engagementId } });
  if (!p || p.status !== "awaiting_approval") return;
  await advancePipeline(p.id);
}

/**
 * Called from the result route when a pipeline-staged job finishes. If that
 * stage's jobs are now all terminal, summarize it and either auto-advance or
 * flip the pipeline to awaiting_approval.
 */
export async function onPipelineJobFinished(job: {
  engagementId: string | null;
  stage: string;
}): Promise<void> {
  if (!job.engagementId || !job.stage) return;
  const p = await prisma.pipeline.findUnique({ where: { engagementId: job.engagementId } });
  if (!p || p.status !== "running" || p.currentKey !== job.stage) return;

  const prog = await stageJobProgress(job.engagementId, job.stage, await stageStartedAt(p.id, job.stage));
  if (!prog.complete) return;

  // Atomically claim this stage's completion so two jobs finishing at once can't
  // both advance the pipeline (which would double-queue / skip a stage).
  const claimed = await prisma.pipeline.updateMany({
    where: { id: p.id, status: "running", currentKey: job.stage },
    data: { status: "advancing" },
  });
  if (claimed.count !== 1) return; // another completion is handling it

  await setStage(p.id, job.stage, { summary: `${prog.done}/${prog.total} jobs complete` });
  if (p.autoApprove) await advancePipeline(p.id);
  else await prisma.pipeline.update({ where: { id: p.id }, data: { status: "awaiting_approval" } });
}

/**
 * Fail jobs that can never finish — running too long (dead runner/hung tool) or
 * queued but orphaned (their runner was deleted → runnerId nulled → unclaimable)
 * — then advance any pipeline whose current stage is now complete. Meant to run
 * from the cron so pipelines don't hang waiting on a human to open the Jobs page.
 */
export async function sweepStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - JOB_STALE_MS);
  const [staleRunning, orphanQueued] = await Promise.all([
    prisma.job.findMany({
      where: { status: "running", startedAt: { lt: cutoff } },
      select: { id: true, engagementId: true, stage: true },
    }),
    prisma.job.findMany({
      where: { status: "queued", OR: [{ runnerId: null }, { runnerId: "" }] },
      select: { id: true, engagementId: true, stage: true },
    }),
  ]);
  const all = [...staleRunning, ...orphanQueued];
  if (all.length === 0) return 0;
  await prisma.job.updateMany({
    where: { id: { in: all.map((j) => j.id) } },
    data: { status: "failed", finishedAt: new Date() },
  });
  // Advance pipelines whose current stage just became complete.
  const engs = [...new Set(all.filter((j) => j.stage && j.engagementId).map((j) => j.engagementId as string))];
  for (const e of engs) await recheckPipeline(e);
  return all.length;
}

/** Pause / resume / cancel controls. */
export async function setPipelineStatus(engagementId: string, status: "paused" | "running" | "canceled"): Promise<void> {
  await prisma.pipeline.updateMany({ where: { engagementId }, data: { status } });
}

/** Re-check the active job stage (e.g. after resuming) in case it completed
 * while no completion event could advance it. */
export async function recheckPipeline(engagementId: string): Promise<void> {
  const p = await prisma.pipeline.findUnique({ where: { engagementId } });
  if (!p || p.status !== "running") return;
  const def = stageDef(p.currentKey);
  if (!def?.jobs) return;
  const prog = await stageJobProgress(engagementId, p.currentKey, await stageStartedAt(p.id, p.currentKey));
  if (!prog.complete) return;
  await setStage(p.id, p.currentKey, { summary: `${prog.done}/${prog.total} jobs complete` });
  if (p.autoApprove) await advancePipeline(p.id);
  else await prisma.pipeline.update({ where: { id: p.id }, data: { status: "awaiting_approval" } });
}

export async function setPipelineAutoApprove(engagementId: string, autoApprove: boolean): Promise<void> {
  await prisma.pipeline.updateMany({ where: { engagementId }, data: { autoApprove } });
  // If turning auto on while awaiting approval, advance now.
  if (autoApprove) {
    const p = await prisma.pipeline.findUnique({ where: { engagementId } });
    if (p?.status === "awaiting_approval") await advancePipeline(p.id);
  }
}

/** Stage progress for the UI: per-stage job done/total (job stages only). */
export async function stageProgressMap(engagementId: string): Promise<Record<string, { done: number; total: number }>> {
  const jobs = await prisma.job.findMany({
    where: { engagementId, stage: { not: "" } },
    select: { stage: true, status: true },
  });
  const out: Record<string, { done: number; total: number }> = {};
  for (const j of jobs) {
    const e = (out[j.stage] ??= { done: 0, total: 0 });
    e.total += 1;
    if (TERMINAL.includes(j.status)) e.done += 1;
  }
  return out;
}
