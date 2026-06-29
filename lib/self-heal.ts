import { prisma } from "@/lib/db";
import { isInstallable } from "@/lib/runner-constants";
import { logAudit } from "@/lib/audit";
import { diagnoseFailure, MAX_AUTO_RETRIES, type Diagnosis } from "@/lib/self-heal-core";

export { diagnoseFailure, MAX_AUTO_RETRIES } from "@/lib/self-heal-core";
export type { Diagnosis } from "@/lib/self-heal-core";

export type FailedJob = {
  tool: string;
  target: string;
  args: string;
  output: string;
  exitCode: number | null;
  retries: number;
  engagementId: string | null;
  runnerId: string | null;
  queuedBy: string;
  stage: string;
  autoImport: boolean;
  priority: number;
};

/**
 * Diagnose a freshly-failed job and, if it's a recoverable runner-side issue
 * within the retry budget, fix it (queue a tool install when needed) and
 * re-queue the work in the background. Best-effort; never throws.
 */
export async function selfHealFailedJob(job: FailedJob): Promise<Diagnosis | null> {
  try {
    if (!job.runnerId || job.retries >= MAX_AUTO_RETRIES) return null;
    const diag = diagnoseFailure({ tool: job.tool, output: job.output, exitCode: job.exitCode });
    if (!diag.recoverable || diag.action === "none") return diag;

    // Fix: queue an install for a missing tool (newer runners also auto-install).
    if (diag.action === "install_retry" && diag.tool && isInstallable(diag.tool)) {
      await prisma.install.create({
        data: { runnerId: job.runnerId, tool: diag.tool, requestedBy: "self-heal" },
      });
    }

    // Re-queue the same work, one retry up, so a pipeline stage waits for it
    // rather than advancing on the failure.
    await prisma.job.create({
      data: {
        engagementId: job.engagementId,
        runnerId: job.runnerId,
        tool: job.tool,
        target: job.target,
        args: job.args,
        stage: job.stage,
        autoImport: job.autoImport,
        queuedBy: job.queuedBy,
        priority: job.priority,
        retries: job.retries + 1,
      },
    });

    await logAudit({
      type: "job.autoretry",
      actor: "self-heal",
      summary: `Auto-retry ${job.tool} on ${job.target} — ${diag.cause}`,
      target: job.target,
      severity: "low",
      meta: { attempt: job.retries + 1, action: diag.action },
    });
    return diag;
  } catch {
    return null; // self-heal is best-effort
  }
}
