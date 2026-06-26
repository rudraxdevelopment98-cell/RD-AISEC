"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import {
  importJobFindings,
  retryJob,
  deleteJob,
  archiveJobs,
  unarchiveJobs,
  deleteJobs,
} from "@/lib/runners";

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

export function JobsTable({
  jobs,
  archived = false,
}: {
  jobs: JobRow[];
  archived?: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  function runBulk(action: (fd: FormData) => Promise<void>) {
    const fd = new FormData();
    selected.forEach((id) => fd.append("ids", id));
    startTransition(async () => {
      await action(fd);
      setSelected(new Set());
    });
  }

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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {rows.length} of {jobs.length} jobs
          {selected.size > 0 && ` · ${selected.size} selected`}
        </p>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            {archived ? (
              <button
                disabled={pending}
                onClick={() => runBulk(unarchiveJobs)}
                className="btn-ghost px-2 py-1"
              >
                Restore
              </button>
            ) : (
              <button
                disabled={pending}
                onClick={() => runBulk(archiveJobs)}
                className="btn-ghost px-2 py-1"
              >
                <Icon name="copy" className="h-3 w-3" /> Archive
              </button>
            )}
            <button
              disabled={pending}
              onClick={() => {
                if (confirm(`Delete ${selected.size} job(s)? This can't be undone.`)) {
                  runBulk(deleteJobs);
                }
              }}
              className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-300">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 overflow-hidden rounded-lg border border-surface-border">
        <div className="flex items-center gap-2 border-b border-surface-border bg-surface-card/40 px-3 py-2">
          <input
            type="checkbox"
            aria-label="Select all"
            className="shrink-0"
            checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
            onChange={(e) =>
              setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
            }
          />
          <div className="hidden flex-1 grid-cols-12 gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 sm:grid">
            <div className="col-span-4">Tool · target</div>
            <div className="col-span-2">Machine</div>
            <div className="col-span-2">Engagement</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-3 text-right">Finished</div>
          </div>
          <span className="text-xs text-gray-500 sm:hidden">Select all</span>
        </div>

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-500">No jobs match.</p>
        ) : (
          rows.map((j) => (
            <details key={j.id} className="border-b border-surface-border last:border-0">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-card/30">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={selected.has(j.id)}
                  onChange={() => toggle(j.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Select job"
                />
                <div className="grid flex-1 grid-cols-1 gap-1 sm:grid-cols-12 sm:items-center sm:gap-2">
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
                  <div className="col-span-1">
                    <span className={`tag capitalize ${STATUS_STYLE[j.status] ?? ""}`}>{j.status}</span>
                  </div>
                  <div className="col-span-3 text-xs text-gray-500 sm:text-right">
                    {j.finished ? new Date(j.finished).toLocaleString() : "—"}
                  </div>
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
