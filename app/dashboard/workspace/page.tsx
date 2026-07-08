import { prisma } from "@/lib/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import type { Severity, TaskStatus, WorkspaceData, WsFinding, WsProject, WsTask } from "@/lib/workspace-core";

export const dynamic = "force-dynamic";

const SEVS: Severity[] = ["critical", "high", "medium", "low", "info"];
const sev = (s: string): Severity => (SEVS.includes(s as Severity) ? (s as Severity) : "info");
const STATUSES: TaskStatus[] = ["queued", "running", "done", "failed", "canceled"];
const stat = (s: string): TaskStatus => (STATUSES.includes(s as TaskStatus) ? (s as TaskStatus) : "queued");
const ms = (d: Date | null | undefined): number | null => (d ? new Date(d).getTime() : null);

/**
 * Operator Workspace — the three-panel operator view (icon rail · project list ·
 * task timeline · context panel · evidence drawer) from the design spec, wired to
 * real data: Engagements → projects, Jobs → tasks, Findings → findings. It lives
 * alongside the classic dashboard (nothing changes there); switch in from the nav
 * or the top of the dashboard.
 */
export default async function WorkspacePage() {
  const [engagements, jobs, findings, unreviewedGroups] = await Promise.all([
    prisma.engagement.findMany({
      orderBy: { updatedAt: "desc" },
      take: 40,
      include: { _count: { select: { jobs: true, findings: true } } },
    }),
    prisma.job.findMany({
      where: { archived: false },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { engagement: { select: { id: true, name: true } }, runner: { select: { name: true } } },
    }),
    prisma.finding.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { engagement: { select: { id: true, name: true } } },
    }),
    // Engagements that still have unreviewed open findings → "needs review".
    prisma.finding.groupBy({
      by: ["engagementId"],
      where: { reviewed: false, status: "open" },
      _count: { _all: true },
    }),
  ]);

  const findingCountByEng = new Map(engagements.map((e) => [e.id, e._count.findings]));
  const unreviewedEngs = new Set(unreviewedGroups.filter((g) => g._count._all > 0).map((g) => g.engagementId));

  const projects: WsProject[] = engagements.map((e) => ({
    id: e.id,
    name: e.name,
    client: e.client,
    type: e.type,
    status: e.status,
    scope: e.scope,
    taskCount: e._count.jobs,
    findingCount: e._count.findings,
  }));

  const tasks: WsTask[] = jobs.map((j) => {
    const status = stat(j.status);
    const engId = j.engagement?.id ?? null;
    return {
      id: j.id,
      tool: j.tool,
      target: j.target,
      args: j.args,
      status,
      stage: j.stage,
      engagementId: engId,
      engagementName: j.engagement?.name ?? "Ad-hoc",
      runnerName: j.runner?.name ?? "",
      queuedBy: j.queuedBy,
      priority: j.priority,
      retries: j.retries,
      exitCode: j.exitCode,
      output: (j.output || "").slice(0, 6000),
      findingsCount: engId ? findingCountByEng.get(engId) ?? 0 : 0,
      needsReview: status === "done" && engId != null && unreviewedEngs.has(engId),
      createdAt: ms(j.createdAt)!,
      startedAt: ms(j.startedAt),
      finishedAt: ms(j.finishedAt),
    };
  });

  const wsFindings: WsFinding[] = findings.map((f) => ({
    id: f.id,
    title: f.title,
    severity: sev(f.severity),
    status: f.status,
    confirmed: f.confirmed,
    engagementId: f.engagementId,
    engagementName: f.engagement?.name ?? "",
    createdAt: ms(f.createdAt)!,
  }));

  const data: WorkspaceData = { projects, tasks, findings: wsFindings };

  return (
    <>
      {/* Refresh live task/finding state periodically (server re-render). */}
      <AutoRefresh seconds={20} />
      <WorkspaceShell data={data} />
    </>
  );
}
