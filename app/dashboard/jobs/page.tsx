import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { QueueJobForm } from "@/components/runner-queue";
import { CustomJobForm } from "@/components/custom-job";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelJob, cancelQueuedJobs, prioritizeJob, deprioritizeJob } from "@/lib/runners";
import { JobsTable } from "@/components/jobs-table";
import { Tabs, TabPanel } from "@/components/tabs";
import { HelpBanner } from "@/components/hint";
import { RUNNER_ONLINE_WINDOW_MS, JOB_STALE_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

// Curated job templates — one-click recipes that pre-fill the custom-command
// form (replace TARGET with your in-scope host/URL). Quick starting points for
// common workflows without remembering flags.
const JOB_TEMPLATES: { name: string; desc: string; cmd: string }[] = [
  { name: "Full nmap + vuln scripts", desc: "Service/version detection plus safe NSE vuln scripts.", cmd: "nmap -sV --script vuln --host-timeout 20m TARGET" },
  { name: "Subdomain → live hosts", desc: "Enumerate subdomains, then probe which are live HTTP(S).", cmd: "bash -lc 'subfinder -d TARGET -silent | httpx -silent -title -status-code'" },
  { name: "IoT device sweep", desc: "Scan the IoT-relevant ports so the portal classifies each device.", cmd: "nmap -Pn -sV -p 21,22,23,53,80,161,443,554,1883,1900,8080,8443,9100 TARGET" },
  { name: "Directory brute (common)", desc: "Recursive content discovery with the dirb common list.", cmd: "feroxbuster -u TARGET -w /usr/share/wordlists/dirb/common.txt --silent" },
  { name: "TLS / SSL audit", desc: "Full protocol + cipher + certificate audit.", cmd: "testssl.sh TARGET" },
  { name: "Nuclei CVEs + exposures", desc: "Templated checks at medium+ severity.", cmd: "nuclei -u TARGET -tags cve,exposure,misconfig -severity medium,high,critical -jsonl" },
];

const STATUS_STYLE: Record<string, string> = {
  queued: "ring-amber accent-amber",
  running: "ring-sky accent-sky",
  done: "ring-emerald accent-emerald",
  failed: "border-red-500/40 text-red-300",
  canceled: "border-gray-500/40 text-gray-400",
};

function elapsed(from: Date | null, to: number): string {
  if (!from) return "—";
  const s = Math.max(0, Math.round((to - new Date(from).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: { error?: string; engagement?: string; view?: string; cmd?: string };
}) {
  const archivedView = searchParams.view === "archived";
  // Auto-fail jobs stuck "running" too long (runner crashed / lost connection).
  await prisma.job.updateMany({
    where: { status: "running", startedAt: { lt: new Date(Date.now() - JOB_STALE_MS) } },
    data: {
      status: "failed",
      exitCode: 124,
      output:
        "No result received in time — the runner stopped responding, lost connection, or the tool hung. The job was stopped automatically.",
      finishedAt: new Date(),
    },
  });

  // Self-clean: auto-archive finished jobs older than 30 days (kept in Archived).
  await prisma.job.updateMany({
    where: {
      archived: false,
      status: { in: ["done", "failed", "canceled"] },
      finishedAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
    },
    data: { archived: true },
  });

  const [runners, engagements, jobs] = await Promise.all([
    prisma.runner.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.engagement.findMany({
      where: { authorized: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, scope: true },
    }),
    prisma.job.findMany({
      where: { archived: archivedView },
      orderBy: { createdAt: "desc" },
      take: archivedView ? 300 : 80,
      include: {
        engagement: { select: { name: true } },
        runner: { select: { name: true, lastSeenAt: true } },
      },
    }),
  ]);

  const now = Date.now();
  const active = jobs
    .filter((j) => j.status === "queued" || j.status === "running")
    // Running first, then queued in the order the runner will claim them
    // (priority desc, then oldest first) so "Run next" visibly reorders the queue.
    .sort((a, b) => {
      const rank = (s: string) => (s === "running" ? 0 : 1);
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      if (a.priority !== b.priority) return b.priority - a.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  // Priority only reorders within a single runner's queue, so "Run next" is only
  // meaningful when a runner has >1 queued job — and only on the jobs that aren't
  // already first in that runner's claim order.
  const queuedByRunner = new Map<string, typeof active>();
  for (const j of active) {
    if (j.status !== "queued") continue;
    const key = j.runnerId ?? "unassigned";
    (queuedByRunner.get(key) ?? queuedByRunner.set(key, []).get(key)!).push(j);
  }
  // active is already sorted by claim order, so the first queued job per runner
  // is the one that runs next — no point bumping it.
  const topQueuedId = new Map<string, string>();
  for (const [key, list] of queuedByRunner) {
    if (list[0]) topQueuedId.set(key, list[0].id);
  }
  const canRunNext = (j: (typeof active)[number]) => {
    const key = j.runnerId ?? "unassigned";
    return (queuedByRunner.get(key)?.length ?? 0) > 1 && topQueuedId.get(key) !== j.id;
  };
  const history = jobs.filter((j) => !["queued", "running"].includes(j.status));
  const failedCount = history.filter((j) => j.status === "failed").length;

  return (
    <div className="mx-auto max-w-5xl">
      {/* Only auto-refresh while something is live — so filtering History isn't reset. */}
      {active.length > 0 && <AutoRefresh seconds={5} />}

      <h1 className="text-2xl font-bold">Jobs</h1>
      <p className="mt-1 text-gray-400">
        Queue tools to run on a connected machine, watch them live, and review
        completed runs with their results.
      </p>

      <HelpBanner>
        <p>• Pick an engagement, machine, tool and preset, then a target (or pick one from the engagement&apos;s scope).</p>
        <p>• Use <b>Run a custom command</b> for anything not in the tool list.</p>
        <p>• Active jobs show live; completed ones go to History — expand a row to import findings, retry, or see output.</p>
      </HelpBanner>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <div className="mt-6">
        <Tabs
          defaultTab={searchParams.cmd ? "create" : archivedView ? "history" : "active"}
          tabs={[
            { id: "create", label: <>＋ Create</> },
            { id: "templates", label: <>Templates</> },
            { id: "active", label: <>Active{active.length > 0 ? ` (${active.length})` : ""}</> },
            {
              id: "history",
              label: <>{archivedView ? "Archived" : "History"}{failedCount > 0 ? ` · ${failedCount} failed` : ""}</>,
            },
          ]}
        >
          {/* ── Create (tool preset + custom command) ── */}
          <TabPanel id="create">
            <QueueJobForm
              engagements={engagements}
              runners={runners.map((r) => ({ id: r.id, name: r.name }))}
              defaultEngagementId={searchParams.engagement}
            />
            <CustomJobForm
              engagements={engagements}
              runners={runners.map((r) => ({ id: r.id, name: r.name }))}
              defaultCommand={searchParams.cmd}
              defaultEngagementId={searchParams.engagement}
            />
          </TabPanel>

          {/* ── Templates (one-click recipes) ── */}
          <TabPanel id="templates">
            <p className="text-sm text-gray-400">
              One-click recipes — they open the <b className="text-gray-300">Create</b> tab with the
              command pre-filled. Replace <code className="rounded bg-black/40 px-1 text-[12px]">TARGET</code>{" "}
              with your in-scope host/URL, pick a machine, and run.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {JOB_TEMPLATES.map((t) => (
                <div key={t.name} className="card flex flex-col">
                  <p className="text-sm font-semibold text-white">{t.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{t.desc}</p>
                  <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-gray-300">
                    {t.cmd}
                  </pre>
                  <Link
                    href={`/dashboard/jobs?cmd=${encodeURIComponent(t.cmd)}`}
                    className="btn-ghost mt-2 self-start text-xs"
                  >
                    <Icon name="bolt" className="mr-1 inline h-3 w-3" /> Use template
                  </Link>
                </div>
              ))}
            </div>
          </TabPanel>

          <TabPanel id="active">
      {/* ── Active (live) ───────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          Active
          {active.length > 0 && (
            <span className="tag ring-sky accent-sky">{active.length} running/queued</span>
          )}
        </h2>
        {active.some((j) => j.status === "queued") && (
          <form action={cancelQueuedJobs}>
            <button className="text-xs text-gray-500 hover:text-amber-400">
              Cancel all queued
            </button>
          </form>
        )}
      </div>
      {active.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">Nothing running. Queue a job above.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {active.map((j) => {
            const online =
              j.runner?.lastSeenAt &&
              now - new Date(j.runner.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
            const offlineWarn = !!j.runnerId && !online;
            return (
              <div key={j.id} className="card">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className={`tag capitalize ${STATUS_STYLE[j.status]}`}>
                      {j.status === "running" && (
                        <span className="pulse-dot mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />
                      )}
                      {j.status}
                    </span>
                    {j.priority > 0 && (
                      <span className="tag ring-amber accent-amber" title="Prioritized — runs before normal jobs">
                        ⚡ priority
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {j.status === "queued" && canRunNext(j) && (
                      <form action={prioritizeJob}>
                        <input type="hidden" name="id" value={j.id} />
                        <button className="text-xs text-amber-400 hover:text-amber-300" title="Run this job before the others on its machine">
                          ↑ Run next
                        </button>
                      </form>
                    )}
                    {j.status === "queued" && j.priority > 0 && (
                      <form action={deprioritizeJob}>
                        <input type="hidden" name="id" value={j.id} />
                        <button className="text-xs text-gray-500 hover:text-gray-300" title="Reset to normal priority">
                          Reset
                        </button>
                      </form>
                    )}
                    <form action={cancelJob}>
                      <input type="hidden" name="id" value={j.id} />
                      <button className="text-xs text-gray-500 hover:text-amber-400">
                        {j.status === "running" ? "Stop" : "Cancel"}
                      </button>
                    </form>
                  </div>
                </div>
                <p className="mt-2 font-mono text-sm font-semibold text-white">
                  {j.tool} {j.args}
                </p>
                <p className="mt-1 truncate text-xs text-gray-300">{j.target}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500">
                  <dt>Machine</dt>
                  <dd className="text-right text-gray-300">
                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-gray-500"}`} />
                    {j.runner?.name ?? "unassigned"}
                  </dd>
                  <dt>Engagement</dt>
                  <dd className="truncate text-right text-gray-300">{j.engagement?.name ?? "Quick scan"}</dd>
                  <dt>{j.status === "running" ? "Running for" : "Queued"}</dt>
                  <dd className="text-right text-gray-300">
                    {j.status === "running" ? elapsed(j.startedAt, now) : new Date(j.createdAt).toLocaleTimeString()}
                  </dd>
                </dl>
                {offlineWarn && (
                  <p className="mt-2 text-xs text-amber-400">
                    ⚠ assigned machine is offline — won&apos;t run until it reconnects.
                  </p>
                )}
                {j.status === "running" && j.output && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-brand hover:underline">
                      Live output
                    </summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-surface-border bg-black/50 p-2 font-mono text-[11px] leading-relaxed text-gray-300">
                      {j.output}
                    </pre>
                    <p className="mt-1 text-[10px] text-gray-600">
                      Streams from the machine; refreshes every few seconds.
                    </p>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

          </TabPanel>
          <TabPanel id="history">
      {/* ── History (searchable / sortable table) ───────── */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{archivedView ? "Archived jobs" : "History"}</h2>
        <Link
          href={archivedView ? "/dashboard/jobs" : "/dashboard/jobs?view=archived"}
          className="text-xs text-brand hover:underline"
        >
          {archivedView ? "← Back to history" : "View archived →"}
        </Link>
      </div>
      {failedCount > 0 && (
        <p className="mt-2 text-xs text-red-300">
          <Icon name="alert" className="mr-1 inline h-3 w-3" />
          {failedCount} failed — expand a row for the reason.
        </p>
      )}
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          {archivedView ? "No archived jobs." : "No completed jobs yet."}
        </p>
      ) : (
        <JobsTable
          archived={archivedView}
          jobs={history.map((j) => ({
            id: j.id,
            tool: j.tool,
            args: j.args,
            target: j.target,
            status: j.status,
            machine: j.runner?.name ?? null,
            engagement: j.engagement?.name ?? null,
            engagementId: j.engagementId,
            finished: j.finishedAt ? j.finishedAt.toISOString() : null,
            created: j.createdAt.toISOString(),
            output: j.output,
            exitCode: j.exitCode,
          }))}
        />
      )}
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}
