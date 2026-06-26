"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { importJobFindings, retryJob, deleteJob } from "@/lib/runners";

export type JobRow = {
  id: string;
  tool: string;
  args: string;
  target: string;
  status: string;
  machine: string | null;
  engagement: string | null;
  engagementId: string | null;
  finished: string | null; // ISO
  created: string; // ISO
  output: string;
  exitCode: number | null;
};

const STATUS_STYLE: Record<string, string> = {
  done: "ring-emerald accent-emerald",
  failed: "border-red-500/40 text-red-300",
  canceled: "border-gray-500/40 text-gray-400",
};

const STATUSES = ["all", "done", "failed", "canceled"];

export function JobsTable({ jobs }: { jobs: JobRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filtered = jobs.filter((j) => {
      const okS = status === "all" || j.status === status;
      const okQ =
        !ql ||
        `${j.tool} ${j.args}`.toLowerCase().includes(ql) ||
        j.target.toLowerCase().includes(ql) ||
        (j.machine ?? "").toLowerCase().includes(ql) ||
        (j.engagement ?? "").toLowerCase().includes(ql);
      return okS && okQ;
    });
    const t = (s: string | null) => (s ? Date.parse(s) : 0);
    return [...filtered].sort((a, b) => {
      if (sort === "status") return a.status.localeCompare(b.status);
      const ta = t(a.finished) || t(a.created);
      const tb = t(b.finished) || t(b.created);
      return sort === "oldest" ? ta - tb : tb - ta;
    });
  }, [jobs, q, status, sort]);

  return (
    <div className="mt-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-card/40 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tool, target, machine, engagement…"
            className="w-full rounded-md border border-surface-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-brand"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-surface-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:border-brand"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-md border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        >
          <option value="recent">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="status">By status</option>
        </select>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {rows.length} of {jobs.length} jobs
      </p>

      <div className="mt-2 overflow-hidden rounded-lg border border-surface-border">
        <div className="hidden grid-cols-12 gap-2 border-b border-surface-border bg-surface-card/40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid">
          <div className="col-span-4">Tool · target</div>
          <div className="col-span-2">Machine</div>
          <div className="col-span-2">Engagement</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2 text-right">Finished</div>
        </div>

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-500">No jobs match.</p>
        ) : (
          rows.map((j) => (
            <details key={j.id} className="border-b border-surface-border last:border-0">
              <summary className="grid cursor-pointer grid-cols-1 gap-1 px-3 py-2.5 text-sm hover:bg-surface-card/30 sm:grid-cols-12 sm:items-center sm:gap-2">
                <div className="col-span-4 min-w-0">
                  <p className="truncate font-mono text-gray-200">
                    {j.tool} {j.args}
                  </p>
                  <p className="truncate text-xs text-gray-500">{j.target}</p>
                </div>
                <div className="col-span-2 truncate text-xs text-gray-400">{j.machine ?? "—"}</div>
                <div className="col-span-2 truncate text-xs text-gray-400">
                  {j.engagement ?? "Quick scan"}
                </div>
                <div className="col-span-2">
                  <span className={`tag capitalize ${STATUS_STYLE[j.status] ?? ""}`}>{j.status}</span>
                </div>
                <div className="col-span-2 text-xs text-gray-500 sm:text-right">
                  {j.finished ? new Date(j.finished).toLocaleString() : "—"}
                </div>
              </summary>

              <div className="space-y-3 bg-black/20 px-3 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  {j.status === "done" && j.engagementId && (
                    <form action={importJobFindings}>
                      <input type="hidden" name="id" value={j.id} />
                      <button className="btn-ghost px-2 py-1 text-xs">
                        <Icon name="arrow" className="h-3 w-3" /> Import to findings
                      </button>
                    </form>
                  )}
                  <form action={retryJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <button className="btn-ghost px-2 py-1 text-xs">
                      <Icon name="bolt" className="h-3 w-3" />{" "}
                      {j.status === "done" ? "Run again" : "Retry"}
                    </button>
                  </form>
                  <form action={deleteJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <button className="text-xs text-gray-600 hover:text-red-400">Delete</button>
                  </form>
                  {j.exitCode != null && <span className="text-xs text-gray-500">exit {j.exitCode}</span>}
                </div>
                {j.output ? (
                  <pre className="max-h-96 overflow-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
                    {j.output}
                  </pre>
                ) : (
                  <p className="text-xs text-gray-500">No output captured.</p>
                )}
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
