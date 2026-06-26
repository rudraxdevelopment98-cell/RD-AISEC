import Link from "next/link";
import { auth } from "@/auth";
import { Icon } from "@/components/icons";
import { Counter } from "@/components/counter";
import { SeverityBadge } from "@/components/badges";
import { prisma } from "@/lib/db";
import { SEVERITY_ORDER } from "@/lib/report";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

const SEV_HEX: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#38bdf8",
  info: "#94a3b8",
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

/* ── Severity donut (SVG) ───────────────────────────────── */
function SeverityDonut({ data, total }: { data: { key: string; count: number }[]; total: number }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" className="h-40 w-40 shrink-0 fade-up">
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="16" />
        {total > 0 &&
          data
            .filter((d) => d.count > 0)
            .map((d) => {
              const len = (d.count / total) * C;
              const seg = (
                <circle
                  key={d.key}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={SEV_HEX[d.key]}
                  strokeWidth="16"
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-acc}
                />
              );
              acc += len;
              return seg;
            })}
      </g>
      <text x="70" y="66" textAnchor="middle" className="fill-white" fontSize="28" fontWeight="bold">
        {total}
      </text>
      <text x="70" y="88" textAnchor="middle" className="fill-gray-400" fontSize="11">
        open
      </text>
    </svg>
  );
}

/* ── Activity sparkline (SVG area) ──────────────────────── */
function ActivitySpark({ buckets }: { buckets: { scans: number; jobs: number }[] }) {
  const W = 320;
  const H = 72;
  const PAD = 4;
  const n = buckets.length;
  const vals = buckets.map((b) => b.scans + b.jobs);
  const max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => {
    const x = (i / (n - 1)) * (W - 2 * PAD) + PAD;
    const y = H - PAD - (v / max) * (H - 2 * PAD);
    return [x, y] as const;
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `M${PAD},${H - PAD} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")} L${W - PAD},${H - PAD} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={line} fill="none" stroke="#34d399" strokeWidth="2" className="spark-line" pathLength={1} />
    </svg>
  );
}

/* ── Workflow pipeline (animated data flow) ─────────────── */
function Pipeline({ scans, findings, reports }: { scans: number; findings: number; reports: number }) {
  const nodes = [
    { cx: 80, count: scans, label: "Scans", sub: "recon → ports" },
    { cx: 240, count: findings, label: "Findings", sub: "triaged issues" },
    { cx: 400, count: reports, label: "Reports", sub: "engagements" },
  ];
  return (
    <svg viewBox="0 0 480 150" className="h-auto w-full">
      <defs>
        <linearGradient id="pipeStroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#34d399" stopOpacity="0.25" />
          <stop offset="0.5" stopColor="#34d399" stopOpacity="0.85" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="pipeNode" cx="50%" cy="32%" r="75%">
          <stop offset="0" stopColor="#0b1426" />
          <stop offset="1" stopColor="#020617" />
        </radialGradient>
        <filter id="pipeGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker id="pipeArrow" markerWidth="9" markerHeight="9" refX="5.5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#38bdf8" />
        </marker>
        <path id="pAB" d="M118,62 L200,62" />
        <path id="pBC" d="M278,62 L360,62" />
      </defs>

      {/* connectors */}
      <use href="#pAB" stroke="url(#pipeStroke)" strokeWidth="2.5" fill="none" markerEnd="url(#pipeArrow)" />
      <use href="#pBC" stroke="url(#pipeStroke)" strokeWidth="2.5" fill="none" markerEnd="url(#pipeArrow)" />

      {/* flowing data packets */}
      {["#pAB", "#pBC"].flatMap((p, pi) =>
        [0, 1].map((k) => (
          <circle key={`${pi}-${k}`} r="3.4" fill="#5eead4" filter="url(#pipeGlow)">
            <animateMotion dur="2.2s" begin={`${pi * 0.4 + k * 1.1}s`} repeatCount="indefinite">
              <mpath href={p} />
            </animateMotion>
          </circle>
        )),
      )}

      {/* nodes */}
      {nodes.map((n) => (
        <g key={n.label}>
          <circle cx={n.cx} cy="62" r="34" fill="none" stroke="#34d399" strokeWidth="1.5" strokeOpacity="0.4">
            <animate attributeName="r" values="34;37;34" dur="3.4s" repeatCount="indefinite" />
            <animate attributeName="stroke-opacity" values="0.4;0.7;0.4" dur="3.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={n.cx} cy="62" r="27" fill="url(#pipeNode)" stroke="#1f2a3c" />
          <text x={n.cx} y="69" textAnchor="middle" fontSize="20" fontWeight="bold" className="fill-white">
            {n.count}
          </text>
          <text x={n.cx} y="116" textAnchor="middle" fontSize="13" fontWeight="600" className="fill-gray-200">
            {n.label}
          </text>
          <text x={n.cx} y="132" textAnchor="middle" fontSize="10" className="fill-gray-500">
            {n.sub}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function DashboardOverview() {
  const session = await auth();
  const firstName = session?.user?.name?.split(" ")[0] ?? "operator";
  const now = Date.now();
  const since14 = new Date(now - 13 * 86_400_000);
  since14.setHours(0, 0, 0, 0);

  const [
    engagementCount,
    findings,
    runners,
    recentFindings,
    recentJobs,
    jobCount,
    scanCount,
    jobsRecent,
    scansRecent,
  ] = await Promise.all([
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
    prisma.job.count(),
    prisma.scanRun.count(),
    prisma.job.findMany({ where: { createdAt: { gte: since14 } }, select: { createdAt: true } }),
    prisma.scanRun.findMany({ where: { createdAt: { gte: since14 } }, select: { createdAt: true } }),
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

  // 14-day activity buckets
  const buckets = Array.from({ length: 14 }, () => ({ scans: 0, jobs: 0 }));
  const idx = (d: Date) =>
    Math.round((new Date(d).setHours(0, 0, 0, 0) - since14.getTime()) / 86_400_000);
  for (const j of jobsRecent) {
    const i = idx(j.createdAt);
    if (i >= 0 && i < 14) buckets[i].jobs++;
  }
  for (const s of scansRecent) {
    const i = idx(s.createdAt);
    if (i >= 0 && i < 14) buckets[i].scans++;
  }
  const activity14 = jobsRecent.length + scansRecent.length;

  const metrics = [
    { label: "Engagements", value: engagementCount, suffix: "", icon: "briefcase", href: "/dashboard/engagements", accent: "text-brand" },
    { label: "Open findings", value: openFindings, suffix: "", icon: "alert", href: "/dashboard/analytics", accent: "text-amber-300" },
    { label: "Critical / High", value: critHigh, suffix: "", icon: "skull", href: "/dashboard/analytics", accent: "text-red-300" },
    { label: "Runners online", value: runnersOnline, suffix: `/${runners.length}`, icon: "server", href: "/dashboard/runners", accent: "text-emerald-300" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Galaxy hero */}
      <section className="galaxy relative overflow-hidden rounded-2xl border border-surface-border p-6 sm:p-8">
        <div className="galaxy-stars" aria-hidden />
        <div className="scanline" aria-hidden />
        <svg
          className="wave-svg pointer-events-none absolute inset-x-0 bottom-0 h-16"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M0,55 C200,95 400,15 600,55 C800,95 1000,20 1200,55 L1200,120 L0,120 Z"
            fill="rgba(52,211,153,0.06)"
          />
        </svg>
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div>
            <span className="tag ring-emerald accent-emerald">
              <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-emerald-400" /> Authorized session
            </span>
            <h1 className="mt-3 text-2xl font-bold sm:text-3xl">
              Welcome back, <span className="text-gradient">{firstName}</span>
            </h1>
            <p className="mt-1 max-w-md text-gray-400">
              Your security operations, live — across testing, scanning, and reporting.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/dashboard/engagements" className="btn-primary">
                <Icon name="briefcase" className="h-4 w-4" /> New engagement
              </Link>
              <Link href="/dashboard/network" className="btn-ghost">
                <Icon name="globe" className="h-4 w-4" /> Scan a network
              </Link>
            </div>
          </div>

          {/* Radar scope emblem */}
          <div className="float-slow relative hidden h-32 w-32 shrink-0 sm:block">
            <svg viewBox="0 0 120 120" className="h-full w-full drop-shadow-[0_0_20px_rgba(52,211,153,0.25)]">
              <defs>
                <linearGradient id="radarBeam" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#34d399" stopOpacity="0.55" />
                  <stop offset="1" stopColor="#34d399" stopOpacity="0" />
                </linearGradient>
              </defs>
              <circle cx="60" cy="60" r="56" fill="rgba(2,6,23,0.55)" stroke="#1f2a3c" />
              <circle cx="60" cy="60" r="42" fill="none" stroke="#34d399" strokeOpacity="0.18" />
              <circle cx="60" cy="60" r="28" fill="none" stroke="#34d399" strokeOpacity="0.18" />
              <circle cx="60" cy="60" r="14" fill="none" stroke="#34d399" strokeOpacity="0.18" />
              <line x1="60" y1="6" x2="60" y2="114" stroke="#34d399" strokeOpacity="0.12" />
              <line x1="6" y1="60" x2="114" y2="60" stroke="#34d399" strokeOpacity="0.12" />
              <path d="M60,60 L60,6 A54,54 0 0,1 108,38 Z" fill="url(#radarBeam)">
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0 60 60"
                  to="360 60 60"
                  dur="4s"
                  repeatCount="indefinite"
                />
              </path>
              <circle className="blip" cx="80" cy="44" r="2.6" fill="#5eead4" style={{ animationDelay: "0s" }} />
              <circle className="blip" cx="44" cy="76" r="2.2" fill="#38bdf8" style={{ animationDelay: "1.2s" }} />
              <circle className="blip" cx="82" cy="82" r="2" fill="#5eead4" style={{ animationDelay: "2.1s" }} />
              <circle cx="60" cy="60" r="3" fill="#34d399" />
            </svg>
          </div>
        </div>
      </section>

      {engagementCount === 0 && (
        <section className="card fade-up border-brand/30">
          <h2 className="font-semibold text-brand">Get started</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-300">
            <li>Create an <Link href="/dashboard/engagements" className="text-brand hover:underline">engagement</Link> and mark it authorized.</li>
            <li>Set up a <Link href="/dashboard/runners" className="text-brand hover:underline">runner</Link>, or run a passive <Link href="/dashboard/scan" className="text-brand hover:underline">Auto Scan</Link>.</li>
            <li>Import results to findings → generate the report.</li>
          </ol>
        </section>
      )}

      {/* Metric cards */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {metrics.map((m, i) => (
          <Link
            key={m.label}
            href={m.href}
            className="card-hover fade-up"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <div className="flex items-center justify-between">
              <p className={`text-3xl font-bold ${m.accent}`}>
                <Counter value={m.value} />
                {m.suffix && <span className="text-xl text-gray-500">{m.suffix}</span>}
              </p>
              <Icon name={m.icon} className="h-5 w-5 text-gray-600" />
            </div>
            <p className="mt-1 text-sm text-gray-400">{m.label}</p>
          </Link>
        ))}
      </section>

      {/* Pipeline */}
      <section className="card fade-up">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-brand-glow">Workflow</h2>
          <span className="text-xs text-gray-500">scan → findings → report</span>
        </div>
        <div className="mt-2">
          <Pipeline scans={jobCount + scanCount} findings={findings.length} reports={engagementCount} />
        </div>
      </section>

      {/* Charts: severity donut + activity */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card fade-up">
          <h2 className="font-semibold text-brand-glow">Open findings by severity</h2>
          <div className="mt-2 flex items-center gap-5">
            <SeverityDonut data={bySeverity} total={openFindings} />
            <ul className="space-y-1.5 text-sm">
              {bySeverity.map((b) => (
                <li key={b.key} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV_HEX[b.key] }} />
                  <span className="w-16 capitalize text-gray-400">{b.key}</span>
                  <span className="text-gray-200">{b.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card fade-up">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-glow">Activity — 14 days</h2>
            <span className="text-xs text-gray-500">{activity14} scans + jobs</span>
          </div>
          <div className="mt-4">
            <ActivitySpark buckets={buckets} />
          </div>
          <Link href="/dashboard/history" className="mt-2 inline-block text-xs text-gray-500 hover:text-brand">
            Monitoring →
          </Link>
        </div>
      </section>

      {/* Recent findings + jobs */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card fade-up">
          <h2 className="font-semibold text-brand-glow">Recent findings</h2>
          {recentFindings.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No findings yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentFindings.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 last:border-0">
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

        <div className="card fade-up">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-brand-glow">Recent jobs</h2>
            <Link href="/dashboard/history" className="text-xs text-gray-500 hover:text-brand">Monitoring →</Link>
          </div>
          {recentJobs.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No jobs yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentJobs.map((j) => (
                <div key={j.id} className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 text-sm last:border-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${JOB_DOT[j.status] ?? "bg-gray-500"}`} />
                    <span className="truncate font-mono text-gray-200">
                      {j.tool} <span className="text-gray-400">{j.target}</span>
                    </span>
                  </div>
                  <span className="shrink-0 text-xs capitalize text-gray-500">{j.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Jump to */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">Jump to</h2>
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
