"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  TASK_TABS,
  buildTimeline,
  filterTasks,
  relTime,
  severityRank,
  severityTone,
  statusDot,
  statusTone,
  tabCounts,
  taskMetrics,
  workspaceMetrics,
  type TaskTab,
  type WorkspaceData,
  type WsFinding,
  type WsTask,
} from "@/lib/workspace-core";

type Mode = "tasks" | "findings" | "assets";
type Selection = { kind: "task"; id: string } | { kind: "finding"; id: string } | { kind: "project"; id: string } | null;

const DRAWER_TABS = ["Logs", "Output", "Findings", "Command", "Meta"] as const;
type DrawerTab = (typeof DRAWER_TABS)[number];
const DRAWER_SNAPS = [40, 220, 320, 460];

/**
 * The Operator Workspace shell — icon rail · project sidebar · main task
 * timeline · right context panel · bottom evidence drawer, per the design spec.
 * Fully client-driven selection/filter/collapse; data comes pre-mapped from the
 * server page. Keyboard: ] context panel · \ drawer · / focus search.
 */
export function WorkspaceShell({ data }: { data: WorkspaceData }) {
  const [mode, setMode] = useState<Mode>("tasks");
  const [tab, setTab] = useState<TaskTab>("All");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Selection>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [drawerH, setDrawerH] = useState(220);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("Logs");
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => tabCounts(data.tasks), [data.tasks]);
  const visibleTasks = useMemo(() => filterTasks(data.tasks, tab, query), [data.tasks, tab, query]);
  const findingsSorted = useMemo(
    () => [...data.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    [data.findings],
  );

  // Default selection: first visible task.
  useEffect(() => {
    if (sel == null && visibleTasks.length) setSel({ kind: "task", id: visibleTasks[0].id });
  }, [visibleTasks, sel]);

  const selTask = sel?.kind === "task" ? data.tasks.find((t) => t.id === sel.id) ?? null : null;
  const selFinding = sel?.kind === "finding" ? data.findings.find((f) => f.id === sel.id) ?? null : null;
  const selProject = sel?.kind === "project" ? data.projects.find((p) => p.id === sel.id) ?? null : null;

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "]" && !typing) {
        setRightOpen((v) => !v);
      } else if (e.key === "\\" && !typing) {
        setDrawerH((h) => (h <= 44 ? 220 : 40));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Drawer drag-resize.
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  useEffect(() => {
    function move(e: PointerEvent) {
      if (!dragRef.current) return;
      const dy = dragRef.current.startY - e.clientY;
      setDrawerH(Math.max(40, Math.min(560, dragRef.current.startH + dy)));
    }
    function up() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const metrics = useMemo(() => workspaceMetrics(data), [data]);
  const drawerOpen = drawerH > 44;

  return (
    <div className="flex h-[calc(100dvh-6.25rem)] min-h-[520px] gap-2 py-2">
      {/* ── Left icon rail ─────────────────────────────────────────── */}
      <nav className="glass-panel flex w-14 shrink-0 flex-col items-center gap-1 rounded-2xl border border-surface-border py-3">
        <Link href="/dashboard" title="Back to dashboard" className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-brand/15 text-brand">
          <Icon name="grid" className="h-5 w-5" />
        </Link>
        <RailBtn icon="bolt" label="Tasks" active={mode === "tasks"} onClick={() => setMode("tasks")} />
        <RailBtn icon="alert" label="Findings" active={mode === "findings"} onClick={() => setMode("findings")} />
        <RailBtn icon="briefcase" label="Assets" active={mode === "assets"} onClick={() => setMode("assets")} />
        <div className="mt-auto flex flex-col items-center gap-1">
          <Link href="/dashboard/jobs" title="Jobs (classic)" className="grid h-9 w-9 place-items-center rounded-xl text-gray-400 hover:bg-white/5 hover:text-gray-100">
            <Icon name="server" className="h-5 w-5" />
          </Link>
          <Link href="/dashboard/analytics" title="Analytics" className="grid h-9 w-9 place-items-center rounded-xl text-gray-400 hover:bg-white/5 hover:text-gray-100">
            <Icon name="chart" className="h-5 w-5" />
          </Link>
        </div>
      </nav>

      {/* ── Right of the rail: everything else ─────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-h-0 flex-1 gap-2">
          {/* Project sidebar */}
          <aside className="glass-panel hidden w-72 shrink-0 flex-col rounded-2xl border border-surface-border md:flex">
            <div className="border-b border-surface-border p-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-100">Operator Workspace</h2>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">{mode}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {metrics.map((m) => (
                  <div key={m.label} className="rounded-lg border border-surface-border bg-black/20 px-2 py-1.5">
                    <div className="text-base font-bold text-brand">{m.value}</div>
                    <div className="text-[10px] leading-tight text-gray-500">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {mode === "tasks" && (
              <>
                <div className="flex flex-wrap gap-1 border-b border-surface-border p-2">
                  {TASK_TABS.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                        tab === t ? "bg-brand/20 text-brand" : "text-gray-400 hover:text-gray-100"
                      }`}
                    >
                      {t} <span className="opacity-60">{counts[t]}</span>
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {visibleTasks.length === 0 && <Empty label="No tasks match this filter." />}
                  {visibleTasks.map((t) => (
                    <TaskRow key={t.id} t={t} active={sel?.kind === "task" && sel.id === t.id} onClick={() => setSel({ kind: "task", id: t.id })} />
                  ))}
                </div>
              </>
            )}

            {mode === "findings" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {findingsSorted.length === 0 && <Empty label="No findings yet." />}
                {findingsSorted.map((f) => (
                  <FindingRow key={f.id} f={f} active={sel?.kind === "finding" && sel.id === f.id} onClick={() => setSel({ kind: "finding", id: f.id })} />
                ))}
              </div>
            )}

            {mode === "assets" && (
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {data.projects.length === 0 && <Empty label="No engagements yet." />}
                {data.projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSel({ kind: "project", id: p.id })}
                    className={`mb-1 block w-full rounded-xl border p-2.5 text-left transition ${
                      sel?.kind === "project" && sel.id === p.id
                        ? "border-brand/40 bg-brand/10"
                        : "border-transparent hover:bg-white/5"
                    }`}
                  >
                    <div className="truncate text-sm font-medium text-gray-100">{p.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
                      <span className="capitalize">{p.type}</span>·<span className="capitalize">{p.status}</span>
                    </div>
                    <div className="mt-1 flex gap-1.5 text-[10px]">
                      <span className="tag">🧩 {p.taskCount} tasks</span>
                      <span className="tag">⚠ {p.findingCount} findings</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          {/* Main column: header · body · composer */}
          <section className="glass-panel flex min-w-0 flex-1 flex-col rounded-2xl border border-surface-border">
            <header className="flex items-center justify-between gap-2 border-b border-surface-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="text-gray-500">Workspace</span>
                <span className="text-gray-600">/</span>
                <span className="truncate font-semibold text-gray-100">
                  {selTask ? `${selTask.tool} · ${selTask.target}` : selFinding ? selFinding.title : selProject ? selProject.name : mode}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => setRightOpen((v) => !v)}
                  title="Toggle context panel  ]"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-surface-border text-gray-400 hover:text-gray-100"
                >
                  <Icon name={rightOpen ? "x" : "copy"} className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {selTask ? (
                <TaskTimeline t={selTask} />
              ) : (
                <Empty label="Select a task, finding, or asset from the left." />
              )}
            </div>

            {/* Composer dock — a real live filter over the task list. */}
            <div className="border-t border-surface-border p-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-surface-border bg-black/20 px-3 py-1.5">
                <Icon name="search" className="h-4 w-4 shrink-0 text-gray-500" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (mode !== "tasks") setMode("tasks");
                  }}
                  placeholder="Filter tasks — tool, target, project…   ( / to focus )"
                  className="min-w-0 flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-600"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-gray-500 hover:text-gray-200">
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                )}
                <Link href="/dashboard/jobs" className="btn-primary shrink-0 px-3 py-1 text-xs">
                  ＋ New task
                </Link>
              </div>
            </div>
          </section>

          {/* Right context panel */}
          {rightOpen && (
            <ContextPanel task={selTask} finding={selFinding} projectId={selProject?.id ?? selTask?.engagementId ?? null} onClose={() => setRightOpen(false)} />
          )}
        </div>

        {/* Bottom evidence drawer */}
        <div className="glass-panel flex shrink-0 flex-col rounded-2xl border border-surface-border" style={{ height: drawerH }}>
          <div
            onPointerDown={(e) => {
              dragRef.current = { startY: e.clientY, startH: drawerH };
            }}
            className="flex cursor-ns-resize items-center justify-between border-b border-surface-border px-3 py-1.5 select-none"
          >
            <div className="flex items-center gap-1">
              {DRAWER_TABS.map((t) => (
                <button
                  key={t}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setDrawerTab(t);
                    if (!drawerOpen) setDrawerH(220);
                  }}
                  className={`rounded-md px-2 py-0.5 text-[11px] transition ${
                    drawerTab === t && drawerOpen ? "bg-brand/20 text-brand" : "text-gray-400 hover:text-gray-100"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 text-gray-500">
              <span className="mr-1 hidden text-[10px] sm:inline">drag to resize · \\ toggle</span>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setDrawerH(drawerOpen ? 40 : 320)}
                className="grid h-6 w-6 place-items-center rounded hover:bg-white/5"
                title="Collapse / expand"
              >
                <Icon name={drawerOpen ? "x" : "chart"} className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {drawerOpen && (
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <DrawerContent tab={drawerTab} task={selTask} findings={data.findings} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Left rail button ────────────────────────────────────────────────────────
function RailBtn({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`grid h-10 w-10 place-items-center rounded-xl transition ${
        active ? "bg-brand/15 text-brand shadow-[inset_0_0_0_1px_rgb(var(--brand)/0.35)]" : "text-gray-400 hover:bg-white/5 hover:text-gray-100"
      }`}
    >
      <Icon name={icon} className="h-5 w-5" />
    </button>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="grid h-full min-h-24 place-items-center px-4 text-center text-xs text-gray-500">{label}</div>;
}

// ── Task list row ───────────────────────────────────────────────────────────
function TaskRow({ t, active, onClick }: { t: WsTask; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 block w-full rounded-xl border p-2.5 text-left transition ${
        active ? "border-brand/40 bg-brand/10" : "border-transparent hover:bg-white/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(t.status)} ${t.status === "running" ? "pulse-dot" : ""}`} />
        <span className="truncate font-mono text-[13px] font-medium text-gray-100">{t.tool}</span>
        <span className="ml-auto shrink-0 text-[10px] text-gray-500">{relTime(t.finishedAt ?? t.startedAt ?? t.createdAt)}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-gray-400">{t.target}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={`rounded-full border px-1.5 py-0 text-[10px] ${statusTone(t.status)}`}>{t.status}</span>
        {t.stage && <span className="tag text-[10px]">{t.stage}</span>}
        {t.needsReview && <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">review</span>}
      </div>
    </button>
  );
}

// ── Finding list row ────────────────────────────────────────────────────────
function FindingRow({ f, active, onClick }: { f: WsFinding; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 block w-full rounded-xl border p-2.5 text-left transition ${
        active ? "border-brand/40 bg-brand/10" : "border-transparent hover:bg-white/5"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-1.5 py-0 text-[10px] uppercase ${severityTone(f.severity)}`}>{f.severity}</span>
        {f.confirmed && <span className="dot-blink" title="confirmed exploitable" />}
        <span className="ml-auto shrink-0 text-[10px] text-gray-500">{relTime(f.createdAt)}</span>
      </div>
      <div className="mt-1 truncate text-[13px] font-medium text-gray-100">{f.title}</div>
      <div className="mt-0.5 truncate text-[11px] text-gray-500">{f.engagementName}</div>
    </button>
  );
}

// ── Main: task timeline ─────────────────────────────────────────────────────
function TaskTimeline({ t }: { t: WsTask }) {
  const steps = buildTimeline(t);
  const metrics = taskMetrics(t);
  return (
    <div className="mx-auto max-w-3xl">
      {/* Overview card */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-lg font-semibold text-gray-100">
              {t.tool} <span className="text-gray-500">·</span> <span className="text-gray-300">{t.target}</span>
            </h1>
            <p className="mt-0.5 text-xs text-gray-500">
              {t.engagementName}
              {t.args && <span className="font-mono"> · {t.args}</span>}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-0.5 text-xs ${statusTone(t.status)}`}>{t.status}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-lg border border-surface-border bg-black/20 px-2.5 py-2">
              <div className="truncate text-sm font-semibold text-gray-100">{m.value}</div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-3">
        <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Execution timeline</h3>
        <ol className="relative border-l border-surface-border pl-4">
          {steps.map((s) => (
            <li key={s.key} className="relative mb-3 last:mb-0">
              <span
                className={`absolute -left-[1.32rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                  s.state === "done"
                    ? "bg-emerald-400"
                    : s.state === "active"
                    ? "bg-sky-400 pulse-dot"
                    : s.state === "failed"
                    ? "bg-red-400"
                    : "bg-gray-600"
                }`}
              />
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-gray-100">{s.label}</span>
                {s.at && <span className="shrink-0 text-[10px] text-gray-500">{relTime(s.at)}</span>}
              </div>
              {s.detail && <div className="truncate text-[11px] text-gray-500">{s.detail}</div>}
            </li>
          ))}
        </ol>
      </div>

      {/* Output preview */}
      {t.output && (
        <div className="mt-3">
          <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Output</h3>
          <pre className="max-h-64 overflow-auto rounded-xl border border-surface-border bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-gray-300">
            {t.output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Right context panel ─────────────────────────────────────────────────────
function ContextPanel({
  task,
  finding,
  projectId,
  onClose,
}: {
  task: WsTask | null;
  finding: WsFinding | null;
  projectId: string | null;
  onClose: () => void;
}) {
  const CTX_TABS = ["Summary", "Evidence", "Meta", "Actions"] as const;
  const [tab, setTab] = useState<(typeof CTX_TABS)[number]>("Summary");
  return (
    <aside className="glass-panel hidden w-[340px] shrink-0 flex-col rounded-2xl border border-surface-border lg:flex">
      <div className="flex items-center justify-between border-b border-surface-border px-3 py-2">
        <div className="flex gap-1">
          {CTX_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-0.5 text-[11px] transition ${tab === t ? "bg-brand/20 text-brand" : "text-gray-400 hover:text-gray-100"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="grid h-6 w-6 place-items-center rounded hover:bg-white/5" title="Close  ]">
          <Icon name="x" className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {!task && !finding && <Empty label="Nothing selected." />}

        {task && tab === "Summary" && (
          <dl className="space-y-2">
            <Row k="Tool" v={task.tool} mono />
            <Row k="Target" v={task.target} mono />
            <Row k="Status" v={task.status} />
            <Row k="Project" v={task.engagementName} />
            <Row k="Machine" v={task.runnerName || "—"} />
            <Row k="Stage" v={task.stage || "ad-hoc"} />
          </dl>
        )}
        {task && tab === "Meta" && (
          <dl className="space-y-2">
            <Row k="Queued by" v={task.queuedBy || "—"} />
            <Row k="Priority" v={String(task.priority)} />
            <Row k="Retries" v={String(task.retries)} />
            <Row k="Exit code" v={task.exitCode == null ? "—" : String(task.exitCode)} />
            <Row k="Created" v={relTime(task.createdAt)} />
            <Row k="Finished" v={task.finishedAt ? relTime(task.finishedAt) : "—"} />
          </dl>
        )}
        {task && tab === "Evidence" && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400">
              {task.findingsCount > 0
                ? `${task.findingsCount} finding(s) on ${task.engagementName}.`
                : "No findings linked to this task's project yet."}
            </p>
            {task.output ? (
              <pre className="max-h-72 overflow-auto rounded-lg border border-surface-border bg-black/40 p-2 font-mono text-[10px] text-gray-300">{task.output}</pre>
            ) : (
              <p className="text-xs text-gray-500">No output captured.</p>
            )}
          </div>
        )}
        {task && tab === "Actions" && (
          <div className="flex flex-col gap-2">
            {task.engagementId && <Link href={`/dashboard/engagements/${task.engagementId}`} className="btn-ghost justify-start text-sm">Open engagement</Link>}
            <Link href="/dashboard/jobs" className="btn-ghost justify-start text-sm">Re-run in Jobs</Link>
            <Link href="/dashboard/findings" className="btn-ghost justify-start text-sm">Review findings</Link>
          </div>
        )}

        {finding && !task && (
          <dl className="space-y-2">
            <Row k="Title" v={finding.title} />
            <Row k="Severity" v={finding.severity} />
            <Row k="Status" v={finding.status} />
            <Row k="Confirmed" v={finding.confirmed ? "yes" : "no"} />
            <Row k="Project" v={finding.engagementName} />
            <div className="pt-1">
              <Link href={`/dashboard/findings/${finding.id}`} className="btn-ghost w-full justify-center text-sm">Open finding</Link>
            </div>
          </dl>
        )}
      </div>
      {projectId && (
        <div className="border-t border-surface-border p-2">
          <Link href={`/dashboard/engagements/${projectId}`} className="block truncate text-center text-[11px] text-gray-500 hover:text-brand">
            View full engagement →
          </Link>
        </div>
      )}
    </aside>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11px] uppercase tracking-wide text-gray-500">{k}</dt>
      <dd className={`min-w-0 truncate text-right text-sm text-gray-200 ${mono ? "font-mono text-[13px]" : ""}`}>{v}</dd>
    </div>
  );
}

// ── Bottom drawer content ───────────────────────────────────────────────────
function DrawerContent({ tab, task, findings }: { tab: DrawerTab; task: WsTask | null; findings: WsFinding[] }) {
  if (tab === "Findings") {
    const rel = task ? findings.filter((f) => f.engagementId === task.engagementId) : findings;
    if (!rel.length) return <Empty label="No findings to show." />;
    return (
      <table className="w-full text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-gray-500">
          <tr>
            <th className="pb-1 pr-2">Sev</th>
            <th className="pb-1 pr-2">Title</th>
            <th className="pb-1 pr-2">Project</th>
            <th className="pb-1">When</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[11px]">
          {rel.slice(0, 100).map((f) => (
            <tr key={f.id} className="border-t border-surface-border/60">
              <td className="py-1 pr-2"><span className={`rounded px-1 ${severityTone(f.severity)}`}>{f.severity}</span></td>
              <td className="max-w-0 truncate py-1 pr-2 text-gray-200">{f.title}</td>
              <td className="truncate py-1 pr-2 text-gray-500">{f.engagementName}</td>
              <td className="whitespace-nowrap py-1 text-gray-500">{relTime(f.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (!task) return <Empty label="Select a task to inspect its evidence." />;
  if (tab === "Command") {
    const cmd = `${task.tool} ${task.args}`.trim() + `\n# target: ${task.target}`;
    return <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-gray-300">{cmd}</pre>;
  }
  if (tab === "Meta") {
    return (
      <pre className="font-mono text-[11px] text-gray-400">{JSON.stringify(
        {
          id: task.id,
          tool: task.tool,
          target: task.target,
          status: task.status,
          stage: task.stage || "ad-hoc",
          runner: task.runnerName || null,
          exitCode: task.exitCode,
          priority: task.priority,
          retries: task.retries,
        },
        null,
        2,
      )}</pre>
    );
  }
  // Logs / Output — the raw tool output.
  if (!task.output) return <Empty label="No output captured for this task." />;
  return <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-gray-300">{task.output}</pre>;
}
