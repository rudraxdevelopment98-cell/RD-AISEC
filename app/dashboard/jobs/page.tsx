import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { QueueJobForm } from "@/components/runner-queue";
import { AutoRefresh } from "@/components/auto-refresh";
import { cancelJob } from "@/lib/runners";
import { JobsTable } from "@/components/jobs-table";
import { RUNNER_ONLINE_WINDOW_MS, JOB_STALE_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

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
  searchParams: { error?: string; engagement?: string };
}) {
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

  const [runners, engagements, jobs] = await Promise.all([
    prisma.runner.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.engagement.findMany({
      where: { authorized: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      take: 80,
      include: {
        engagement: { select: { name: true } },
        runner: { select: { name: true, lastSeenAt: true } },
      },
    }),
  ]);

  const now = Date.now();
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
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

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <QueueJobForm
        engagements={engagements}
        runners={runners.map((r) => ({ id: r.id, name: r.name }))}
        defaultEngagementId={searchParams.engagement}
      />

      {/* ── Active (live) ───────────────────────────────── */}
      <h2 className="mt-10 flex items-center gap-2 text-lg font-bold">
        Active
        {active.length > 0 && (
          <span className="tag ring-sky accent-sky">{active.length} running/queued</span>
        )}
      </h2>
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
                  <span className={`tag capitalize ${STATUS_STYLE[j.status]}`}>
                    {j.status === "running" && (
                      <span className="pulse-dot mr-1 inline-block h-2 w-2 rounded-full bg-sky-400" />
                    )}
                    {j.status}
                  </span>
                  <form action={cancelJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <button className="text-xs text-gray-500 hover:text-amber-400">
                      {j.status === "running" ? "Stop" : "Cancel"}
                    </button>
                  </form>
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
              </div>
            );
          })}
        </div>
      )}

      {/* ── History (searchable / sortable table) ───────── */}
      <h2 className="mt-10 text-lg font-bold">History</h2>
      {failedCount > 0 && (
        <p className="mt-2 text-xs text-red-300">
          <Icon name="alert" className="mr-1 inline h-3 w-3" />
          {failedCount} failed — expand a row for the reason.
        </p>
      )}
      {history.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">No completed jobs yet.</p>
      ) : (
        <JobsTable
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
    </div>
  );
}
