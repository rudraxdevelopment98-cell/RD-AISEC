// Pure model for the Operator Workspace (the three-panel view). Maps the app's
// real entities (Engagement → project, Job → task, Finding → finding) into the
// shapes the workspace shell renders, and holds the filtering / timeline /
// tone logic. No prisma or React here, so it is client-safe and unit-testable.

export type TaskStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type WsTask = {
  id: string;
  tool: string;
  target: string;
  args: string;
  status: TaskStatus;
  stage: string; // pipeline stage that queued it ("" = ad-hoc)
  engagementId: string | null;
  engagementName: string;
  runnerName: string;
  queuedBy: string;
  priority: number;
  retries: number;
  exitCode: number | null;
  output: string; // capped raw output
  findingsCount: number;
  needsReview: boolean;
  createdAt: number; // epoch ms
  startedAt: number | null;
  finishedAt: number | null;
};

export type WsFinding = {
  id: string;
  title: string;
  severity: Severity;
  status: string;
  confirmed: boolean;
  engagementId: string;
  engagementName: string;
  createdAt: number;
};

export type WsProject = {
  id: string;
  name: string;
  client: string;
  type: string;
  status: string;
  scope: string;
  taskCount: number;
  findingCount: number;
};

export type WorkspaceData = {
  projects: WsProject[];
  tasks: WsTask[];
  findings: WsFinding[];
};

// The task-filter tabs from the design spec.
export const TASK_TABS = ["All", "Running", "Needs review", "Completed", "Failed"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

/** Does a task belong under a given filter tab? */
export function taskMatchesTab(t: WsTask, tab: TaskTab): boolean {
  switch (tab) {
    case "All":
      return true;
    case "Running":
      return t.status === "running" || t.status === "queued";
    case "Needs review":
      return t.status === "done" && t.needsReview;
    case "Completed":
      return t.status === "done";
    case "Failed":
      return t.status === "failed" || t.status === "canceled";
  }
}

export function filterTasks(tasks: WsTask[], tab: TaskTab, query = ""): WsTask[] {
  const q = query.trim().toLowerCase();
  return tasks.filter((t) => {
    if (!taskMatchesTab(t, tab)) return false;
    if (!q) return true;
    return (
      t.tool.toLowerCase().includes(q) ||
      t.target.toLowerCase().includes(q) ||
      t.engagementName.toLowerCase().includes(q) ||
      t.stage.toLowerCase().includes(q)
    );
  });
}

/** Count per tab for the tab badges. */
export function tabCounts(tasks: WsTask[]): Record<TaskTab, number> {
  const out = { All: 0, Running: 0, "Needs review": 0, Completed: 0, Failed: 0 } as Record<TaskTab, number>;
  for (const tab of TASK_TABS) out[tab] = tasks.filter((t) => taskMatchesTab(t, tab)).length;
  return out;
}

// ── Tone maps (Tailwind class fragments) ────────────────────────────────────
export function statusTone(s: TaskStatus): string {
  switch (s) {
    case "running":
      return "text-sky-300 border-sky-500/40 bg-sky-500/10";
    case "queued":
      return "text-amber-300 border-amber-500/40 bg-amber-500/10";
    case "done":
      return "text-emerald-300 border-emerald-500/40 bg-emerald-500/10";
    case "failed":
      return "text-red-300 border-red-500/40 bg-red-500/10";
    case "canceled":
      return "text-gray-400 border-surface-border bg-white/5";
  }
}

export function statusDot(s: TaskStatus): string {
  switch (s) {
    case "running":
      return "bg-sky-400";
    case "queued":
      return "bg-amber-400";
    case "done":
      return "bg-emerald-400";
    case "failed":
      return "bg-red-400";
    case "canceled":
      return "bg-gray-500";
  }
}

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];
export function severityRank(s: Severity): number {
  const i = SEV_ORDER.indexOf(s);
  return i < 0 ? SEV_ORDER.length : i;
}

export function severityTone(s: Severity): string {
  switch (s) {
    case "critical":
      return "text-red-300 border-red-500/50 bg-red-500/15";
    case "high":
      return "text-orange-300 border-orange-500/40 bg-orange-500/10";
    case "medium":
      return "text-amber-300 border-amber-500/40 bg-amber-500/10";
    case "low":
      return "text-cyan-300 border-cyan-500/40 bg-cyan-500/10";
    case "info":
      return "text-sky-300 border-sky-500/40 bg-sky-500/10";
  }
}

// ── Task timeline (execution-step blocks) ───────────────────────────────────
export type TimelineStep = {
  key: string;
  label: string;
  detail: string;
  at: number | null;
  state: "done" | "active" | "failed" | "pending";
};

/** Build an execution timeline for one task from its lifecycle timestamps. */
export function buildTimeline(t: WsTask): TimelineStep[] {
  const running = t.status === "running";
  const failed = t.status === "failed" || t.status === "canceled";
  const done = t.status === "done";

  const steps: TimelineStep[] = [
    {
      key: "queued",
      label: "Queued",
      detail: t.queuedBy ? `by ${t.queuedBy}` : "added to the work queue",
      at: t.createdAt,
      state: "done",
    },
    {
      key: "dispatch",
      label: "Dispatched",
      detail: t.runnerName ? `to ${t.runnerName}` : "awaiting a machine",
      at: t.startedAt,
      state: t.startedAt ? "done" : t.status === "queued" ? "active" : "pending",
    },
    {
      key: "execute",
      label: `Run ${t.tool}`,
      detail: t.target,
      at: t.startedAt,
      state: running ? "active" : t.startedAt ? (failed ? "failed" : "done") : "pending",
    },
    {
      key: "finish",
      label: failed ? "Failed" : done ? "Completed" : "Awaiting result",
      detail:
        t.exitCode != null
          ? `exit ${t.exitCode}`
          : running
          ? "tool is running…"
          : t.status === "queued"
          ? "not started"
          : "",
      at: t.finishedAt,
      state: done ? "done" : failed ? "failed" : "pending",
    },
  ];

  if (t.findingsCount > 0) {
    steps.push({
      key: "findings",
      label: `${t.findingsCount} finding${t.findingsCount === 1 ? "" : "s"}`,
      detail: t.needsReview ? "needs review" : "imported",
      at: t.finishedAt,
      state: t.needsReview ? "active" : "done",
    });
  }
  return steps;
}

/** Overview metrics for the header of a selected task. */
export function taskMetrics(t: WsTask): { label: string; value: string }[] {
  return [
    { label: "Status", value: t.status },
    { label: "Findings", value: String(t.findingsCount) },
    { label: "Stage", value: t.stage || "ad-hoc" },
    { label: "Elapsed", value: fmtElapsed(t.startedAt, t.finishedAt) },
  ];
}

export function fmtElapsed(start: number | null, end: number | null): string {
  if (start == null) return "—";
  const to = end ?? Date.now();
  const s = Math.max(0, Math.round((to - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function relTime(ms: number | null, now = Date.now()): string {
  if (ms == null) return "";
  const d = now - ms;
  if (d < 0) return "just now";
  const s = Math.round(d / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Roll workspace data into the header metric tiles. */
export function workspaceMetrics(d: WorkspaceData): { label: string; value: number }[] {
  return [
    { label: "Active tasks", value: d.tasks.filter((t) => t.status === "running" || t.status === "queued").length },
    { label: "Findings", value: d.findings.length },
    { label: "Needs review", value: d.tasks.filter((t) => t.status === "done" && t.needsReview).length },
    { label: "Projects", value: d.projects.length },
  ];
}
