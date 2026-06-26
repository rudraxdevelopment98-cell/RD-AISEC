import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { prisma } from "@/lib/db";
import { SEVERITY_ORDER } from "@/lib/report";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

const SEVERITY_BAR: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
  info: "bg-gray-500",
};

const JOB_DOT: Record<string, string> = {
  done: "bg-emerald-500",
  running: "bg-sky-500",
  queued: "bg-amber-500",
  failed: "bg-red-500",
  canceled: "bg-gray-500",
};

const JUMP = [
  { href: "/dashboard/engagements", label: "Engagements", desc: "Cases, findings, reports", icon: "briefcase" },
  { href: "/dashboard/network", label: "Network Map", desc: "Scan & visualize a network", icon: "globe" },
  { href: "/dashboard/runners", label: "Runners", desc: "Run tools on your machines", icon: "server" },
  { href: "/dashboard/scan", label: "Auto Scan", desc: "Passive web posture check", icon: "radar" },
  { href: "/dashboard/assistant", label: "AI Assistant", desc: "Ask the knowledge base", icon: "bot" },
  { href: "/dashboard/knowledge", label: "Knowledge Library", desc: "How-to write-ups", icon: "book" },
];

export default async function DashboardOverview() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "operator";
  const now = Date.now();

  const [engagementCount, findings, runners, recentFindings, recentJobs] =
    await Promise.all([
      prisma.engagement.count(),
      prisma.finding.findMany({ select: { severity: true, status: true } }),
      prisma.runner.findMany({ select: { lastSeenAt: true } }),
      prisma.finding.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { engagement: { select: { name: true } } },
      }),
      prisma.job.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { engagement: { select: { name: true } }, runner: { select: { name: true } } },
      }),
    ]);

  const openFindings = findings.filter((f) => f.status === "open").length;
  const critHigh = findings.filter(
    (f) => f.status === "open" && (f.severity === "critical" || f.severity === "high"),
  ).length;
  const runnersOnline = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  ).length;

  const bySeverity = SEVERITY_ORDER.map((s) => ({
    key: s,
    count: findings.filter((f) => f.severity === s && f.status === "open").length,
  }));
  const maxSev = Math.max(1, ...bySeverity.map((b) => b.count));

  const metrics = [
    { label: "Engagements", value: engagementCount, icon: "briefcase", href: "/dashboard/engagements", accent: "text-brand" },
    { label: "Open findings", value: openFindings, icon: "alert", href: "/dashboard/analytics", accent: "text-amber-300" },
    { label: "Critical / High", value: critHigh, icon: "skull", href: "/dashboard/analytics", accent: "text-red-300" },
    { label: "Runners online", value: `${runnersOnline}/${runners.length}`, icon: "server", href: "/dashboard/runners", accent: "text-emerald-300" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl border border-surface-border bg-surface-card/40 p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="tag ring-emerald accent-emerald">● Authorized session</span>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              Welcome back, {firstName}
            </h1>
            <p className="mt-1 text-gray-400">Your security operations at a glance.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/engagements" className="btn-primary">
              <Icon name="briefcase" className="h-4 w-4" /> New engagement
            </Link>
            <Link href="/dashboard/network" className="btn-ghost">
              <Icon name="globe" className="h-4 w-4" /> Scan a network
            </Link>
          </div>
        </div>
      </section>

      {engagementCount === 0 && (
        <section className="card border-brand/30">
          <h2 className="font-semibold text-brand">Get started</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-300">
            <li>Create an <Link href="/dashboard/engagements" className="text-brand hover:underline">engagement</Link> and mark it authorized.</li>
            <li>Set up a <Link href="/dashboard/runners" className="text-brand hover:underline">runner</Link> on your Kali box, or run a passive <Link href="/dashboard/scan" className="text-brand hover:underline">Auto Scan</Link>.</li>
            <li>Import results to findings → generate the report.</li>
          </ol>
        </section>
      )}

      {/* Metrics */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m) => (
          <Link key={m.label} href={m.href} className="card-hover">
            <div className="flex items-center justify-between">
              <p className={`text-3xl font-bold ${m.accent}`}>{m.value}</p>
              <Icon name={m.icon} className="h-5 w-5 text-gray-600" />
            </div>
            <p className="mt-1 text-sm text-gray-400">{m.label}</p>
          </Link>
        ))}
      </section>

      {/* Severity + recent activity */}
      <section className="grid gap-6 lg:grid-cols-3">
        {/* Open findings by severity */}
        <div className="card">
          <h2 className="font-semibold text-brand-glow">Open findings by severity</h2>
          {openFindings === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No open findings. 🎉</p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {bySeverity.map((b) => (
                <div key={b.key} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-sm capitalize text-gray-400">{b.key}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-border">
                    <div
                      className={`h-full rounded-full ${SEVERITY_BAR[b.key]}`}
                      style={{ width: `${Math.round((b.count / maxSev) * 100)}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-sm text-gray-300">{b.count}</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/dashboard/analytics" className="mt-4 inline-block text-xs text-gray-500 hover:text-brand">
            View analytics →
          </Link>
        </div>

        {/* Recent findings */}
        <div className="card lg:col-span-2">
          <h2 className="font-semibold text-brand-glow">Recent findings</h2>
          {recentFindings.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No findings yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentFindings.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-200">{f.title}</p>
                    <p className="truncate text-xs text-gray-500">{f.engagement?.name ?? "—"}</p>
                  </div>
                  <SeverityBadge value={f.severity} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recent runner jobs */}
      {recentJobs.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-glow">Recent jobs</h2>
            <Link href="/dashboard/history" className="text-xs text-gray-500 hover:text-brand">
              Monitoring →
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {recentJobs.map((j) => (
              <div
                key={j.id}
                className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 text-sm last:border-0"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${JOB_DOT[j.status] ?? "bg-gray-500"}`} />
                  <span className="truncate font-mono text-gray-200">
                    {j.tool} <span className="text-gray-400">{j.target}</span>
                  </span>
                </div>
                <span className="shrink-0 text-xs capitalize text-gray-500">
                  {j.engagement?.name ?? "Quick scan"} · {j.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Jump to */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Jump to
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {JUMP.map((j) => (
            <Link key={j.href} href={j.href} className="card-hover flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-surface-border text-brand">
                <Icon name={j.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">{j.label}</p>
                <p className="truncate text-xs text-gray-500">{j.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
