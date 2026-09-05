/**
 * Autopilot — the engine running authorized engagements by itself.
 *
 * For every engagement the owner has marked BOTH `authorized` AND `autopilot`,
 * the cron orchestrator keeps a self-approving pipeline (recon → scan → exploit →
 * triage → report) running, and restarts a fresh cycle every `autopilotEveryH`
 * hours for continuous coverage. It NEVER touches anything that isn't an
 * authorized, in-scope engagement — discovery only ever suggests candidates; a
 * human still flips the switch per engagement. Submission stays human-approved.
 *
 * Design: idempotent + safe to call every cron tick. It picks an ONLINE runner
 * (skips entirely when none is connected), respects human pause, and self-heals a
 * pipeline whose completion notification was missed (recheck).
 */

import { prisma } from "@/lib/db";
import {
  startPipeline,
  advancePipeline,
  recheckPipeline,
  setPipelineAutoApprove,
} from "@/lib/pipeline-engine";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { logAudit } from "@/lib/audit";

export type AutopilotResult = {
  considered: number;
  started: number;
  advanced: number;
  rechecked: number;
  skipped: number;
  reason?: string;
};

/** An online runner id, or "" when no machine is currently connected. */
async function onlineRunnerId(): Promise<string> {
  const cutoff = new Date(Date.now() - RUNNER_ONLINE_WINDOW_MS);
  const r = await prisma.runner.findFirst({
    where: { lastSeenAt: { gt: cutoff } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true },
  });
  return r?.id ?? "";
}

/** Hostnames/URLs present? (a scope with at least one non-empty line). */
function hasScope(scope: string): boolean {
  return scope.split(/[\s,]+/).some((s) => s.trim().length > 0);
}

/**
 * Advance every authorized autopilot engagement one safe step. Called from the
 * cron. Best-effort per engagement — one failure never blocks the others.
 */
export async function runAutopilot(): Promise<AutopilotResult> {
  const res: AutopilotResult = { considered: 0, started: 0, advanced: 0, rechecked: 0, skipped: 0 };

  const engagements = await prisma.engagement.findMany({
    where: { autopilot: true, authorized: true },
    select: {
      id: true,
      scope: true,
      ownerEmail: true,
      autopilotAt: true,
      autopilotEveryH: true,
      pipeline: { select: { id: true, status: true, autoApprove: true } },
    },
  });
  res.considered = engagements.length;
  if (engagements.length === 0) return res;

  // No machine online → do nothing this tick (pipelines need a runner to work).
  const runnerId = await onlineRunnerId();
  if (!runnerId) {
    res.skipped = engagements.length;
    res.reason = "no online runner";
    return res;
  }

  const now = Date.now();
  for (const e of engagements) {
    try {
      if (!hasScope(e.scope)) {
        res.skipped++;
        continue;
      }
      const p = e.pipeline;

      // 1. A running pipeline: self-heal any missed completion, then leave it.
      if (p && (p.status === "running" || p.status === "advancing")) {
        await recheckPipeline(e.id);
        res.rechecked++;
        continue;
      }

      // 2. Awaiting approval: autopilot IS the approver — advance it.
      if (p && p.status === "awaiting_approval") {
        if (!p.autoApprove) await setPipelineAutoApprove(e.id, true);
        await advancePipeline(p.id);
        res.advanced++;
        continue;
      }

      // 3. Human explicitly paused this pipeline → respect it, don't restart.
      if (p && p.status === "paused") {
        res.skipped++;
        continue;
      }

      // 4. No pipeline, or a finished/canceled one: start a fresh cycle, but only
      //    once per cadence window so we don't hammer the target.
      const everyMs = Math.max(1, e.autopilotEveryH) * 3_600_000;
      const due = !e.autopilotAt || now - new Date(e.autopilotAt).getTime() >= everyMs;
      if (!due) {
        res.skipped++;
        continue;
      }
      await prisma.engagement.update({ where: { id: e.id }, data: { autopilotAt: new Date() } });
      await startPipeline(e.id, runnerId, /* autoApprove */ true, e.ownerEmail || "autopilot", /* deep */ false);
      await logAudit({
        type: "engagement.autopilot.cycle",
        actor: e.ownerEmail || "autopilot",
        summary: "Autopilot started a fresh assessment cycle",
        target: e.id,
      }).catch(() => {});
      res.started++;
    } catch {
      res.skipped++;
    }
  }
  return res;
}
