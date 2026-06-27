"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  platformLabel,
  parseScopeTargets,
  parseScopeEntries,
} from "@/lib/bugbounty-core";
import {
  updateBugProgram,
  deleteBugProgram,
  createEngagementFromProgram,
  setBugAuto,
  runProgramNow,
  bulkDeletePrograms,
  bulkSetProgramCategory,
  bulkSetProgramStatus,
} from "@/lib/bugbounty";

export type ProgramFinding = { severity: string; status: string; title: string };
export type ProgramRow = {
  id: string;
  platform: string;
  name: string;
  url: string;
  reward: string;
  scope: string;
  outScope: string;
  category: string;
  status: string;
  auto: boolean;
  autoRunnerId: string;
  lastAutoAt: string | null;
  engagement: {
    id: string;
    name: string;
    findings: ProgramFinding[];
    jobs: { status: string }[];
  } | null;
};
export type RunnerRow = { id: string; name: string };

// Bug-finding opportunity score: bigger attack surface + proven productivity =
// higher chance of finding a bug. Used to rank programs.
function opportunityScore(p: ProgramRow): number {
  const entries = parseScopeEntries(p.scope);
  const wild = entries.filter((e) => e.wildcard).length;
  const open = (p.engagement?.findings ?? []).filter((f) => f.status === "open");
  const crit = open.filter((f) => f.severity === "critical").length;
  const high = open.filter((f) => f.severity === "high").length;
  const exploits = open.filter((f) => f.title.startsWith("Public exploits available")).length;
  return entries.length + wild * 5 + crit * 10 + high * 5 + open.length + exploits * 6;
}

function opportunityLabel(score: number): { text: string; cls: string } {
  if (score >= 25) return { text: "🔥 Hot", cls: "border-red-500/40 text-red-300" };
  if (score >= 10) return { text: "Promising", cls: "border-amber-500/40 text-amber-300" };
  return { text: "Quiet", cls: "border-gray-500/40 text-gray-400" };
}

const STATUSES = ["active", "paused", "archived"];

export function ProgramsManager({
  programs,
  runners,
}: {
  programs: ProgramRow[];
  runners: RunnerRow[];
}) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [bulkStatus, setBulkStatus] = useState("paused");

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const p of programs) if (p.category) s.add(p.category);
    return [...s].sort();
  }, [programs]);

  // Filter (search + category) then rank by opportunity.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return programs
      .filter((p) => {
        if (activeCat && p.category !== activeCat) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.scope.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          platformLabel(p.platform).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => opportunityScore(b) - opportunityScore(a));
  }, [programs, query, activeCat]);

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const allVisibleSelected =
    visible.length > 0 && visible.every((p) => selected.has(p.id));

  // Append the current selection (+ any extra fields) to a server-action form.
  function withSelection(extra?: Record<string, string>) {
    return (
      <>
        {[...selected].map((id) => (
          <input key={id} type="hidden" name="ids" value={id} />
        ))}
        {extra &&
          Object.entries(extra).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
      </>
    );
  }

  return (
    <div>
      {/* Action bar: search + select + bulk ops */}
      <div className="mt-3 space-y-2 rounded-lg border border-surface-border bg-surface-card/40 p-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative flex-1 min-w-[180px]">
            <Icon name="search" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search programs by name, scope, category…"
              className="w-full rounded-md border border-surface-border bg-surface py-1.5 pl-7 pr-2 outline-none focus:border-brand"
            />
          </div>
          <label className="flex items-center gap-1.5 text-gray-400">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(visible.map((p) => p.id)) : new Set())
              }
            />
            Select all
          </label>
          <span className="text-gray-600">{selected.size} selected</span>
        </div>

        {/* Category filter chips */}
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-gray-500">Category</span>
            <button
              onClick={() => setActiveCat("")}
              className={`tag ${activeCat === "" ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
            >
              all
            </button>
            {categories.map((c) => (
              <button
                key={c}
                onClick={() => setActiveCat(activeCat === c ? "" : c)}
                className={`tag ${activeCat === c ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Bulk operations (when a selection exists) */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-2 text-xs">
            <form action={bulkSetProgramCategory} className="flex items-center gap-1">
              {withSelection({ category: bulkCat })}
              <input
                value={bulkCat}
                onChange={(e) => setBulkCat(e.target.value)}
                placeholder="category"
                className="w-28 rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand"
              />
              <button className="btn-ghost px-2 py-1">Tag</button>
            </form>
            <form action={bulkSetProgramStatus} className="flex items-center gap-1">
              {withSelection({ status: bulkStatus })}
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="rounded-md border border-surface-border bg-surface px-2 py-1 capitalize outline-none focus:border-brand"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button className="btn-ghost px-2 py-1">Set status</button>
            </form>
            <form
              action={bulkDeletePrograms}
              onSubmit={(e) => {
                if (!confirm(`Remove ${selected.size} program(s)?`)) e.preventDefault();
              }}
            >
              {withSelection()}
              <button className="rounded-md border border-red-500/40 px-2 py-1 text-red-300 hover:bg-red-500/10">
                Delete
              </button>
            </form>
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-300">
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Results */}
      {visible.length === 0 ? (
        <p className="mt-3 card text-sm text-gray-500">
          {programs.length === 0 ? "No programs yet. Add one above." : "No programs match your search/filter."}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {visible.map((p) => {
            const targets = parseScopeTargets(p.scope);
            const findings = p.engagement?.findings ?? [];
            const jobs = p.engagement?.jobs ?? [];
            const jobsDone = jobs.filter((j) => ["done", "failed", "canceled"].includes(j.status)).length;
            const jobsActive = jobs.filter((j) => ["queued", "running"].includes(j.status)).length;
            const pct = jobs.length ? Math.round((jobsDone / jobs.length) * 100) : 0;
            const open = findings.filter((f) => f.status === "open");
            const crit = open.filter((f) => f.severity === "critical").length;
            const high = open.filter((f) => f.severity === "high").length;
            const exploitable = open.filter((f) =>
              ["low", "medium", "high", "critical"].includes(f.severity),
            ).length;
            const exploitsFound = open.filter((f) =>
              f.title.startsWith("Public exploits available"),
            ).length;
            const validatedVulns = open.filter(
              (f) => /zone transfer|SQL injection|handshake|vuln|CVE-/i.test(f.title) || f.severity === "critical",
            ).length;
            const lbl = opportunityLabel(opportunityScore(p));
            return (
              <div key={p.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                      className="mt-1 shrink-0"
                      aria-label="Select program"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tag text-brand">{platformLabel(p.platform)}</span>
                        <span className="font-semibold text-white">{p.name}</span>
                        <span className={`tag ${lbl.cls}`} title="Bug-finding opportunity">{lbl.text}</span>
                        {p.category && <span className="tag">{p.category}</span>}
                        {p.engagement && <span className="tag ring-emerald accent-emerald">engaged</span>}
                        {p.auto && <span className="tag">🤖 auto</span>}
                        <span className="tag capitalize">{p.status}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {targets.length} in-scope target{targets.length === 1 ? "" : "s"}
                        {p.reward ? ` · ${p.reward}` : ""}
                        {p.url && (
                          <>
                            {" · "}
                            <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
                              program link
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Progress + findings summary (for engaged programs) */}
                {p.engagement && (jobs.length > 0 || findings.length > 0) && (
                  <div className="mt-3 rounded-lg border border-surface-border bg-black/20 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                      <span>
                        Scans: {jobsDone}/{jobs.length} done
                        {jobsActive > 0 && <span className="text-sky-300"> · {jobsActive} running</span>}
                      </span>
                      <span>
                        {open.length} open findings
                        {crit > 0 && <span className="text-red-300"> · {crit} crit</span>}
                        {high > 0 && <span className="text-orange-300"> · {high} high</span>}
                      </span>
                    </div>
                    {jobs.length > 0 && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-border">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    {(exploitsFound > 0 || validatedVulns > 0) && (
                      <p className="mt-2 text-xs">
                        <span className="text-red-300">🎯 {exploitsFound} public exploit{exploitsFound === 1 ? "" : "s"} found</span>
                        {validatedVulns > 0 && (
                          <span className="text-orange-300"> · {validatedVulns} validated vuln{validatedVulns === 1 ? "" : "s"}</span>
                        )}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      {exploitable > 0 && (
                        <Link href="/dashboard/exploit" className="text-red-300 hover:underline">
                          ⚔ {exploitable} to exploit / validate →
                        </Link>
                      )}
                      <Link
                        href={`/dashboard/engagements/${p.engagement.id}/report`}
                        className="text-brand hover:underline"
                      >
                        📄 Report →
                      </Link>
                      <Link
                        href={`/dashboard/engagements/${p.engagement.id}`}
                        className="text-gray-400 hover:underline"
                      >
                        Open engagement →
                      </Link>
                    </div>
                  </div>
                )}

                {targets.length > 0 && (
                  <p className="mt-2 break-all font-mono text-[11px] text-gray-400">
                    {targets.slice(0, 12).join(", ")}
                    {targets.length > 12 ? ` +${targets.length - 12} more` : ""}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {p.engagement ? (
                    <Link href={`/dashboard/engagements/${p.engagement.id}`} className="text-brand hover:underline">
                      → {p.engagement.name} (engagement)
                    </Link>
                  ) : (
                    <form action={createEngagementFromProgram}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="text-emerald-400 hover:text-emerald-300">Create engagement</button>
                    </form>
                  )}

                  {runners.length > 0 && targets.length > 0 && (
                    <form action={runProgramNow} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <select
                        name="runnerId"
                        defaultValue={p.autoRunnerId || runners[0]?.id}
                        className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-[11px] outline-none focus:border-brand"
                      >
                        {runners.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <button className="text-sky-400 hover:text-sky-300">Run pipeline now</button>
                    </form>
                  )}

                  <form
                    action={deleteBugProgram}
                    onSubmit={(e) => {
                      if (!confirm(`Remove ${p.name}?`)) e.preventDefault();
                    }}
                  >
                    <input type="hidden" name="id" value={p.id} />
                    <button className="text-gray-500 hover:text-red-400">Delete</button>
                  </form>
                </div>

                {/* Automation */}
                {runners.length > 0 && targets.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-black/20 px-3 py-2 text-xs">
                    {p.auto ? (
                      <>
                        <span className="tag ring-emerald accent-emerald">🤖 Auto on · daily</span>
                        <span className="text-gray-500">
                          on {runners.find((r) => r.id === p.autoRunnerId)?.name ?? "—"}
                          {p.lastAutoAt ? ` · last ${new Date(p.lastAutoAt).toLocaleDateString()}` : ""}
                        </span>
                        <form action={setBugAuto} className="ml-auto">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="auto" value="false" />
                          <input type="hidden" name="autoRunnerId" value={p.autoRunnerId} />
                          <button className="text-amber-400 hover:text-amber-300">Pause automation</button>
                        </form>
                      </>
                    ) : (
                      <form action={setBugAuto} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="auto" value="true" />
                        <span className="text-gray-400">Run this program automatically every day on</span>
                        <select
                          name="autoRunnerId"
                          defaultValue={runners[0]?.id}
                          className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-[11px] outline-none focus:border-brand"
                        >
                          {runners.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <button className="text-emerald-400 hover:text-emerald-300">Enable automation</button>
                      </form>
                    )}
                  </div>
                )}

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-brand hover:underline">Edit program</summary>
                  <form action={updateBugProgram} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={p.id} />
                    <textarea
                      name="scope"
                      rows={4}
                      defaultValue={p.scope}
                      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
                    />
                    <textarea
                      name="outScope"
                      rows={2}
                      defaultValue={p.outScope}
                      placeholder="Out of scope"
                      className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        name="url"
                        defaultValue={p.url}
                        placeholder="Program link"
                        className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                      />
                      <input
                        name="category"
                        defaultValue={p.category}
                        placeholder="Category"
                        className="w-32 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
                      />
                      <select
                        name="status"
                        defaultValue={p.status}
                        className="rounded-lg border border-surface-border bg-surface px-2 py-2 text-sm outline-none focus:border-brand"
                      >
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="archived">archived</option>
                      </select>
                    </div>
                    <button className="btn-ghost text-xs">Save</button>
                  </form>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
