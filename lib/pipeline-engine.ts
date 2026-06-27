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
import { PIPELINE_STAGES, STAGE_ORDER, nextStageKey, stageDef } from "@/lib/pipeline-core";

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
type Step = { tool: string; args: string; mode: "url" | "host" };
function stageSteps(stage: string, deep: boolean): Step[] {
  if (stage === "recon") {
    return [
      { tool: "httpx", args: "-title -status-code -tech-detect", mode: "url" },
      { tool: "whatweb", args: "-a 3", mode: "host" },
    ];
  }
  if (stage === "scan") {
    return [
      { tool: "nuclei", args: deep ? "-jsonl" : "-jsonl", mode: "url" },
      {
        tool: "nmap",
        args: deep ? "-Pn -sV -T4 -p- --script vuln" : "-Pn -sV -T4 --top-ports 200",
        mode: "host",
      },
      {
        tool: "gobuster",
        args: deep
          ? "dir -q -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt"
          : "dir -q -w /usr/share/wordlists/dirb/common.txt",
        mode: "url",
      },
      { tool: "nikto", args: "", mode: "url" },
      { tool: "sslscan", args: "", mode: "host" },
    ];
  }
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
    select: { tool: true, target: true },
  });
  const pendingKey = new Set(pending.map((j) => `${j.tool}|${j.target}`));

  type NewJob = {
    engagementId: string;
    runnerId: string;
    tool: string;
    target: string;
    args: string;
    autoImport: boolean;
    stage: string;
    queuedBy: string;
  };
  const data: NewJob[] = [];
  const by = queuedBy || "pipeline";

  if (stage === "exploit") {
    const findings = await prisma.finding.findMany({
      where: { engagementId },
      select: { title: true, description: true, severity: true, owasp: true },
    });
    const wanted = findings.flatMap((f) => exploitActions(f));
    const seen = new Set<string>();
    for (const a of wanted) {
      const target = normalizeTarget(a.tool, a.target);
      if (!validateTarget(a.tool, target)) continue;
      const k = `${a.tool}|${target}|${a.args}`;
      if (seen.has(k) || pendingKey.has(`${a.tool}|${target}`)) continue;
      seen.add(k);
      data.push({ engagementId, runnerId, tool: a.tool, target, args: a.args, autoImport: true, stage, queuedBy: by });
      if (data.length >= 10) break;
    }
  } else {
    const steps = stageSteps(stage, deep);
    const entries = parseScopeEntries(eng.scope);
    const wildcards = entries.filter((e) => e.wildcard).map((e) => e.host).slice(0, 5);
    const hosts = entries.map((e) => e.host).slice(0, 15);

    // Recon also enumerates subdomains for wildcard scopes.
    if (stage === "recon") {
      for (const d of wildcards) {
        if (validateTarget("amass", d) && !pendingKey.has(`amass|${d}`)) {
          data.push({ engagementId, runnerId, tool: "amass", target: d, args: "enum -passive", autoImport: true, stage, queuedBy: by });
        }
      }
    }
    for (const host of hosts) {
      const bare = bareHost(host);
      if (!bare) continue;
      for (const step of steps) {
        const t = step.mode === "url" ? `http://${bare}` : bare;
        const target = normalizeTarget(step.tool, t);
        if (!validateTarget(step.tool, target) || pendingKey.has(`${step.tool}|${target}`)) continue;
        data.push({ engagementId, runnerId, tool: step.tool, target, args: step.args, autoImport: true, stage, queuedBy: by });
      }
    }
  }

  if (data.length > 0) await prisma.job.createMany({ data });
  return data.length;
}

/** Triage: fill a remediation recommendation (from the playbook) on any finding
 * that lacks one, so the report has actionable fixes. Returns a summary. */
export async function runTriage(engagementId: string): Promise<string> {
  const findings = await prisma.finding.findMany({
    where: { engagementId },
    select: { id: true, title: true, description: true, owasp: true, recommendation: true },
  });
  let filled = 0;
  for (const f of findings) {
    if (f.recommendation && f.recommendation.trim()) continue;
    const pb = playbookFor(f);
    const rec = pb.hardening.join(" ");
    if (rec) {
      await prisma.finding.update({ where: { id: f.id }, data: { recommendation: rec } });
      filled += 1;
    }
  }
  return `${findings.length} finding(s) triaged · ${filled} remediation(s) added`;
}

/** Count a job stage's progress for the engagement. */
async function stageJobProgress(engagementId: string, stage: string) {
  const jobs = await prisma.job.findMany({
    where: { engagementId, stage },
    select: { status: true },
  });
  const total = jobs.length;
  const done = jobs.filter((j) => TERMINAL.includes(j.status)).length;
  return { total, done, complete: total > 0 && done === total };
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

  // report
  const cnt = await prisma.finding.count({ where: { engagementId: pipeline.engagementId } });
  const summary = `Report ready · ${cnt} finding(s) compiled`;
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

  const prog = await stageJobProgress(job.engagementId, job.stage);
  if (!prog.complete) return;

  await setStage(p.id, job.stage, { summary: `${prog.done}/${prog.total} jobs complete` });
  if (p.autoApprove) await advancePipeline(p.id);
  else await prisma.pipeline.update({ where: { id: p.id }, data: { status: "awaiting_approval" } });
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
  const prog = await stageJobProgress(engagementId, p.currentKey);
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
