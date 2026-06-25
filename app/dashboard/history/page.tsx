import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

// Unified activity / monitoring view: reconnaissance ScanRuns (cloud pipeline)
// and Runner Jobs (executed on a machine you control) side by side, with simple
// server-rendered charts — the first real "Monitoring" piece (ROADMAP Phase 2).

const STATUS_COLOR: Record<string, string> = {
  completed: "ring-emerald accent-emerald",
  done: "ring-emerald accent-emerald",
  running: "ring-sky accent-sky",
  pending: "ring-amber accent-amber",
  queued: "ring-amber accent-amber",
  failed: "border-red-500/40 text-red-300",
  canceled: "border-gray-500/40 text-gray-400",
};

function Bar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 truncate text-sm capitalize text-gray-400">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-border">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-sm font-medium text-gray-300">{count}</span>
    </div>
  );
}

export default async function HistoryPage() {
  const [scans, jobs] = await Promise.all([
    prisma.scanRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { engagement: { select: { id: true, name: true } } },
    }),
    prisma.job.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        engagement: { select: { id: true, name: true } },
        runner: { select: { name: true } },
      },
    }),
  ]);

  // ---- Daily activity over the last 14 days ----
  const DAYS = 14;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (DAYS - 1));
  const buckets = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: d, scans: 0, jobs: 0 };
  });
  const idx = (dt: Date | string) => {
    const d = new Date(dt);
    d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - start.getTime()) / 86_400_000);
  };
  for (const s of scans) {
    const i = idx(s.createdAt);
    if (i >= 0 && i < DAYS) buckets[i].scans++;
  }
  for (const j of jobs) {
    const i = idx(j.createdAt);
    if (i >= 0 && i < DAYS) buckets[i].jobs++;
  }
  const maxDay = Math.max(1, ...buckets.map((b) => b.scans + b.jobs));

  // ---- Breakdowns ----
  const SCAN_TYPES = ["dns", "port", "web", "posture", "osint"];
  const byScanType = SCAN_TYPES.map((t) => ({ key: t, count: scans.filter((s) => s.scanType === t).length }));
  const maxScanType = Math.max(1, ...byScanType.map((b) => b.count));

  const JOB_TOOLS = ["nmap", "httpx", "nuclei", "whois", "dig"];
  const byTool = JOB_TOOLS.map((t) => ({ key: t, count: jobs.filter((j) => j.tool === t).length }));
  const maxTool = Math.max(1, ...byTool.map((b) => b.count));

  const scansDone = scans.filter((s) => s.status === "completed").length;
  const scansFailed = scans.filter((s) => s.status === "failed").length;
  const jobsDone = jobs.filter((j) => j.status === "done").length;
  const jobsFailed = jobs.filter((j) => j.status === "failed").length;

  const stats = [
    { label: "Recon scans", value: scans.length },
    { label: "Runner jobs", value: jobs.length },
    { label: "Completed", value: scansDone + jobsDone, accent: "text-emerald-300" },
    { label: "Failed", value: scansFailed + jobsFailed, accent: "text-red-300" },
  ];

  // ---- Merged recent activity timeline ----
  type Activity = {
    id: string;
    kind: "scan" | "job";
    label: string;
    target: string;
    status: string;
    engagementId?: string;
    engagementName: string;
    createdAt: Date;
  };
  const activity: Activity[] = [
    ...scans.map((s) => ({
      id: s.id,
      kind: "scan" as const,
      label: `recon · ${s.scanType}`,
      target: s.target,
      status: s.status,
      engagementId: s.engagement?.id,
      engagementName: s.engagement?.name ?? "—",
      createdAt: s.createdAt,
    })),
    ...jobs.map((j) => ({
      id: j.id,
      kind: "job" as const,
      label: `${j.tool} ${j.args}`.trim(),
      target: j.target,
      status: j.status,
      engagementId: j.engagement?.id,
      engagementName: j.engagement?.name ?? "—",
      createdAt: j.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 16);

  const empty = scans.length === 0 && jobs.length === 0;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Monitoring</h1>
      <p className="mt-1 text-gray-400">
        Activity across every engagement — cloud reconnaissance scans and Runner
        jobs executed on machines you control, over time.
      </p>

      {empty ? (
        <div className="card mt-6 text-center">
          <p className="text-gray-400">
            No activity yet. Run a reconnaissance scan or queue a Runner job to
            start building history.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link href="/dashboard/scan" className="btn-primary">Auto Scan</Link>
            <Link href="/dashboard/runners" className="btn-ghost">Runners</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Stat strip */}
          <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="card">
                <p className={`text-3xl font-bold ${s.accent ?? "text-brand"}`}>{s.value}</p>
                <p className="mt-1 text-sm text-gray-400">{s.label}</p>
              </div>
            ))}
          </section>

          {/* Activity over time */}
          <section className="card mt-6">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-brand-glow">Activity — last 14 days</h2>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-sky-500" /> scans
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-500" /> jobs
                </span>
              </div>
            </div>
            <div className="mt-4 flex h-32 items-end gap-1.5">
              {buckets.map((b, i) => {
                const total = b.scans + b.jobs;
                const h = Math.round((total / maxDay) * 100);
                return (
                  <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1">
                    <div className="flex w-full flex-col justify-end" style={{ height: `${h}%` }}>
                      {b.scans > 0 && (
                        <div
                          className="w-full bg-sky-500/80"
                          style={{ height: `${(b.scans / total) * 100}%` }}
                          title={`${b.scans} scans`}
                        />
                      )}
                      {b.jobs > 0 && (
                        <div
                          className="w-full bg-emerald-500/80"
                          style={{ height: `${(b.jobs / total) * 100}%` }}
                          title={`${b.jobs} jobs`}
                        />
                      )}
                    </div>
                    <span className="text-[9px] text-gray-600">{b.date.getDate()}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Breakdowns */}
          <section className="mt-6 grid gap-5 lg:grid-cols-2">
            <div className="card">
              <h2 className="font-semibold text-brand-glow">Recon scans by type</h2>
              <div className="mt-4 space-y-2.5">
                {byScanType.map((b) => (
                  <Bar key={b.key} label={b.key} count={b.count} max={maxScanType} color="bg-sky-500" />
                ))}
              </div>
            </div>
            <div className="card">
              <h2 className="font-semibold text-brand-glow">Runner jobs by tool</h2>
              <div className="mt-4 space-y-2.5">
                {byTool.map((b) => (
                  <Bar key={b.key} label={b.key} count={b.count} max={maxTool} color="bg-emerald-500" />
                ))}
              </div>
            </div>
          </section>

          {/* Recent activity */}
          <section className="card mt-6">
            <h2 className="font-semibold text-brand-glow">Recent activity</h2>
            <div className="mt-3 space-y-2">
              {activity.map((a) => (
                <div
                  key={`${a.kind}-${a.id}`}
                  className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name={a.kind === "scan" ? "radar" : "server"} className="h-4 w-4 shrink-0 text-gray-500" />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm text-gray-200">{a.label}</p>
                      <p className="truncate text-xs text-gray-500">
                        <span className="text-gray-400">{a.target}</span> ·{" "}
                        {a.engagementId ? (
                          <Link href={`/dashboard/engagements/${a.engagementId}`} className="hover:text-brand">
                            {a.engagementName}
                          </Link>
                        ) : (
                          a.engagementName
                        )}{" "}
                        · {new Date(a.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span className={`tag shrink-0 capitalize ${STATUS_COLOR[a.status] ?? ""}`}>{a.status}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
