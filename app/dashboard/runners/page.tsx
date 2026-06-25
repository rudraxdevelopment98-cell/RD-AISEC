import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { CreateRunnerForm } from "@/components/runner-create";
import { QueueJobForm } from "@/components/runner-queue";
import { AutoRefresh } from "@/components/auto-refresh";
import { deleteRunner, cancelJob, deleteJob, importJobFindings } from "@/lib/runners";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

const JOB_STATUS_STYLE: Record<string, string> = {
  queued: "ring-amber accent-amber",
  running: "ring-sky accent-sky",
  done: "ring-emerald accent-emerald",
  failed: "border-red-500/40 text-red-300",
  canceled: "border-gray-500/40 text-gray-400",
};

export default async function RunnersPage({
  searchParams,
}: {
  searchParams: { error?: string; engagement?: string };
}) {
  const [runners, engagements, jobs] = await Promise.all([
    prisma.runner.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.engagement.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, authorized: true },
    }),
    prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        engagement: { select: { name: true } },
        runner: { select: { name: true } },
      },
    }),
  ]);

  const now = Date.now();
  const authorizedEngagements = engagements
    .filter((e) => e.authorized)
    .map((e) => ({ id: e.id, name: e.name }));

  return (
    <div className="mx-auto max-w-5xl">
      <AutoRefresh seconds={6} />

      <h1 className="text-2xl font-bold">Runners</h1>
      <p className="mt-1 text-gray-400">
        Run real security tools on a machine you control — the portal queues jobs;
        your runner (e.g. Kali in UTM) polls over HTTPS, executes them locally, and
        posts results back. Nothing offensive runs in the cloud. See{" "}
        <code className="font-mono text-xs text-brand">runner/README.md</code> to
        set up the agent.
      </p>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <CreateRunnerForm />

      {/* Registered runners */}
      {runners.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {runners.map((r) => {
            const online =
              r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
            return (
              <div key={r.id} className="card flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Icon name="server" className="h-4 w-4 text-brand" />
                    <span className="font-semibold text-white">{r.name}</span>
                    <span
                      className={`tag ${online ? "ring-emerald accent-emerald" : "border-gray-500/40 text-gray-400"}`}
                    >
                      ● {online ? "online" : "offline"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {r.lastSeenAt
                      ? `Last seen ${new Date(r.lastSeenAt).toLocaleString()}`
                      : "Never connected yet"}
                  </p>
                </div>
                <form action={deleteRunner}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-xs text-gray-600 hover:text-red-400">Revoke</button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <QueueJobForm
        engagements={authorizedEngagements}
        runners={runners.map((r) => ({ id: r.id, name: r.name }))}
        defaultEngagementId={searchParams.engagement}
      />

      {/* Job queue / history */}
      <h2 className="mt-10 text-lg font-bold">Jobs</h2>
      {jobs.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">
          No jobs yet. Queue one above — it&apos;ll appear here and update live as
          your runner picks it up.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-white">
                      {j.tool} {j.args}
                    </span>
                    <span className={`tag capitalize ${JOB_STATUS_STYLE[j.status] ?? ""}`}>
                      {j.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    <span className="text-gray-300">{j.target}</span>
                    {" · "}
                    {j.engagement?.name ?? "—"}
                    {" · "}
                    {j.runner?.name ?? "unassigned"}
                    {" · "}
                    {new Date(j.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {(j.status === "queued" || j.status === "running") && (
                    <form action={cancelJob}>
                      <input type="hidden" name="id" value={j.id} />
                      <button className="text-xs text-gray-500 hover:text-amber-400">
                        Cancel
                      </button>
                    </form>
                  )}
                  {j.status === "done" && (
                    <form action={importJobFindings}>
                      <input type="hidden" name="id" value={j.id} />
                      <button className="btn-ghost px-2 py-1 text-xs">
                        <Icon name="arrow" className="h-3 w-3" /> Import to findings
                      </button>
                    </form>
                  )}
                  <form action={deleteJob}>
                    <input type="hidden" name="id" value={j.id} />
                    <button className="text-xs text-gray-600 hover:text-red-400">
                      Delete
                    </button>
                  </form>
                </div>
              </div>

              {j.output && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-gray-500 hover:text-brand">
                    View output{j.exitCode != null ? ` (exit ${j.exitCode})` : ""}
                  </summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
                    {j.output}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
