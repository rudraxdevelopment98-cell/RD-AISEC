import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { SEVERITY_ORDER } from "@/lib/report";
import { attackLabel, owaspLabel } from "@/lib/finding-map";
import { backfillFrameworkTags } from "@/lib/finding-backfill";

export const dynamic = "force-dynamic";

const SEVERITY_BAR: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
  info: "bg-gray-500",
};
const FINDING_STATUS_BAR: Record<string, string> = {
  open: "bg-amber-500",
  fixed: "bg-emerald-500",
  accepted: "bg-gray-500",
  false_positive: "bg-slate-600",
};

function Bar({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-sm capitalize text-gray-400">
        {label.replace(/_/g, " ")}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-border">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right text-sm font-medium text-gray-300">
        {count}
      </span>
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { tagged?: string };
}) {
  const engagements = await prisma.engagement.findMany({
    include: { findings: true },
    orderBy: { updatedAt: "desc" },
  });
  const findings = engagements.flatMap((e) =>
    e.findings.map((f) => ({ ...f, engagementName: e.name })),
  );

  const open = findings.filter((f) => f.status === "open").length;
  const fixed = findings.filter((f) => f.status === "fixed").length;
  const critHigh = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;

  const bySeverity = SEVERITY_ORDER.map((s) => ({
    key: s,
    count: findings.filter((f) => f.severity === s).length,
  }));
  const maxSeverity = Math.max(1, ...bySeverity.map((b) => b.count));

  const STATUSES = ["open", "fixed", "accepted", "false_positive"];
  const byStatus = STATUSES.map((s) => ({
    key: s,
    count: findings.filter((f) => f.status === s).length,
  }));
  const maxStatus = Math.max(1, ...byStatus.map((b) => b.count));

  // Framework breakdowns (deterministic tags — see lib/finding-map.ts).
  function tally(get: (f: (typeof findings)[number]) => string) {
    const m = new Map<string, number>();
    for (const f of findings) {
      const k = get(f);
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  }
  const byAttack = tally((f) => f.attack).map((b) => ({ ...b, label: attackLabel(b.key) ?? b.key }));
  const byOwasp = tally((f) => f.owasp).map((b) => ({ ...b, label: owaspLabel(b.key) ?? b.key }));
  const maxAttack = Math.max(1, ...byAttack.map((b) => b.count));
  const maxOwasp = Math.max(1, ...byOwasp.map((b) => b.count));
  const mapped = findings.filter((f) => f.attack || f.owasp).length;

  const TYPES = ["pentest", "forensics", "consulting"];
  const byType = TYPES.map((t) => ({
    key: t,
    count: engagements.filter((e) => e.type === t).length,
  }));

  const stats = [
    { label: "Engagements", value: engagements.length },
    { label: "Total findings", value: findings.length },
    { label: "Open findings", value: open, accent: "text-amber-300" },
    { label: "Critical / High", value: critHigh, accent: "text-red-300" },
  ];

  // Engagements ranked by open findings.
  const ranked = engagements
    .map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      open: e.findings.filter((f) => f.status === "open").length,
      total: e.findings.length,
    }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.open - a.open)
    .slice(0, 5);

  const recent = findings.slice(0, 6);

  if (engagements.length === 0) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <div className="card mt-6 text-center">
          <p className="text-gray-400">
            No data yet. Create an engagement and log findings to see analytics
            here.
          </p>
          <Link href="/dashboard/engagements" className="btn-primary mt-4 inline-flex">
            Create an engagement
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="mt-1 text-gray-400">
        A live overview across every engagement.
      </p>

      {/* Stat strip */}
      <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <p className={`text-3xl font-bold ${s.accent ?? "text-brand"}`}>
              {s.value}
            </p>
            <p className="mt-1 text-sm text-gray-400">{s.label}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        {/* Findings by severity */}
        <div className="card">
          <h2 className="font-semibold text-brand-glow">Findings by severity</h2>
          <div className="mt-4 space-y-2.5">
            {bySeverity.map((b) => (
              <Bar
                key={b.key}
                label={b.key}
                count={b.count}
                max={maxSeverity}
                color={SEVERITY_BAR[b.key]}
              />
            ))}
          </div>
        </div>

        {/* Findings by status */}
        <div className="card">
          <h2 className="font-semibold text-brand-glow">Findings by status</h2>
          <div className="mt-4 space-y-2.5">
            {byStatus.map((b) => (
              <Bar
                key={b.key}
                label={b.key}
                count={b.count}
                max={maxStatus}
                color={FINDING_STATUS_BAR[b.key]}
              />
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            {fixed} fixed · {open} still open
          </p>
        </div>
      </section>

      {/* Findings by framework (ATT&CK / OWASP) */}
      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold text-brand-glow">By MITRE ATT&amp;CK tactic</h2>
          {byAttack.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No findings mapped yet.</p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {byAttack.map((b) => (
                <Bar key={b.key} label={b.label} count={b.count} max={maxAttack} color="bg-red-500/70" />
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h2 className="font-semibold text-brand-glow">By OWASP Top 10</h2>
          {byOwasp.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">No findings mapped yet.</p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {byOwasp.map((b) => (
                <Bar key={b.key} label={b.label} count={b.count} max={maxOwasp} color="bg-amber-500/70" />
              ))}
            </div>
          )}
          <p className="mt-4 text-xs text-gray-500">
            {mapped} of {findings.length} findings mapped to a framework.
          </p>
          {searchParams.tagged && (
            <p className="mt-2 text-xs text-emerald-300">
              ✓ Tagged {searchParams.tagged} previously-unmapped finding
              {searchParams.tagged === "1" ? "" : "s"}.
            </p>
          )}
          {findings.length - mapped > 0 && (
            <form action={backfillFrameworkTags} className="mt-3">
              <button className="btn-ghost text-xs">
                Tag {findings.length - mapped} unmapped finding
                {findings.length - mapped === 1 ? "" : "s"}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* Engagements by type */}
        <div className="card">
          <h2 className="font-semibold text-brand-glow">Engagements by type</h2>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            {byType.map((t) => (
              <div key={t.key} className="rounded-lg border border-surface-border py-3">
                <p className="text-2xl font-bold text-white">{t.count}</p>
                <p className="mt-1 text-xs capitalize text-gray-400">{t.key}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Top engagements by open findings */}
        <div className="card">
          <h2 className="font-semibold text-brand-glow">Most open findings</h2>
          <div className="mt-3 space-y-2">
            {ranked.length === 0 && (
              <p className="text-sm text-gray-500">No findings logged yet.</p>
            )}
            {ranked.map((e) => (
              <Link
                key={e.id}
                href={`/dashboard/engagements/${e.id}`}
                className="flex items-center justify-between rounded-lg border border-surface-border px-3 py-2 text-sm transition hover:border-brand"
              >
                <span className="truncate text-gray-200">{e.name}</span>
                <span className="shrink-0 text-gray-500">
                  <span className="text-amber-300">{e.open} open</span> / {e.total}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Recent findings */}
      <section className="mt-5 card">
        <h2 className="font-semibold text-brand-glow">Recent findings</h2>
        <div className="mt-3 space-y-2">
          {recent.length === 0 && (
            <p className="text-sm text-gray-500">No findings yet.</p>
          )}
          {recent.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 border-b border-surface-border/60 pb-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-gray-200">{f.title}</p>
                <p className="truncate text-xs text-gray-500">{f.engagementName}</p>
              </div>
              <SeverityBadge value={f.severity} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
