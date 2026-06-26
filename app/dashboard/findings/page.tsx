import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { SeverityBadge, FindingStatusBadge } from "@/components/badges";
import { FrameworkBadges } from "@/components/framework-badges";
import { attackLabel, owaspLabel } from "@/lib/finding-map";
import { MITRE_TACTICS, OWASP_TOP10 } from "@/data/frameworks";
import { SEVERITY_ORDER } from "@/lib/report";

export const dynamic = "force-dynamic";

type SP = {
  attack?: string;
  owasp?: string;
  severity?: string;
  status?: string;
  q?: string;
};

// Build a /dashboard/findings URL with one filter toggled (or cleared).
function withParam(sp: SP, key: keyof SP, value: string | undefined): string {
  const next = new URLSearchParams();
  const merged: SP = { ...sp, [key]: value };
  for (const [k, v] of Object.entries(merged)) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/dashboard/findings?${qs}` : "/dashboard/findings";
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`tag text-xs transition ${
        active
          ? "border-brand bg-brand/15 text-brand-glow"
          : "text-gray-400 hover:border-brand/50 hover:text-gray-200"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = searchParams;
  const where: Record<string, unknown> = {};
  if (sp.attack) where.attack = sp.attack;
  if (sp.owasp) where.owasp = sp.owasp;
  if (sp.severity) where.severity = sp.severity;
  if (sp.status) where.status = sp.status;
  if (sp.q) where.title = { contains: sp.q, mode: "insensitive" };

  const findings = await prisma.finding.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { engagement: { select: { id: true, name: true } } },
  });

  // Which framework values actually occur, so we only show useful filter chips.
  const present = await prisma.finding.groupBy({
    by: ["attack", "owasp"],
    _count: true,
  });
  const attacksInUse = new Set(present.map((p) => p.attack).filter(Boolean));
  const owaspInUse = new Set(present.map((p) => p.owasp).filter(Boolean));

  const anyFilter = !!(sp.attack || sp.owasp || sp.severity || sp.status || sp.q);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Findings</h1>
      <p className="mt-1 text-gray-400">
        Every finding across all engagements. Filter by framework, severity, or
        status to triage.
      </p>

      {/* Search */}
      <form className="mt-5 flex gap-2" action="/dashboard/findings">
        {/* preserve other filters on search */}
        {sp.attack && <input type="hidden" name="attack" value={sp.attack} />}
        {sp.owasp && <input type="hidden" name="owasp" value={sp.owasp} />}
        {sp.severity && <input type="hidden" name="severity" value={sp.severity} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search finding titles…"
          className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button className="btn-ghost text-sm">Search</button>
      </form>

      {/* Filter groups */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-gray-500">ATT&amp;CK</span>
          {MITRE_TACTICS.filter((t) => attacksInUse.has(t.id)).map((t) => (
            <Chip
              key={t.id}
              active={sp.attack === t.id}
              href={withParam(sp, "attack", sp.attack === t.id ? undefined : t.id)}
            >
              {t.id} {t.name}
            </Chip>
          ))}
          {attacksInUse.size === 0 && (
            <span className="text-xs text-gray-600">none mapped yet</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-gray-500">OWASP</span>
          {OWASP_TOP10.filter((o) => owaspInUse.has(o.id)).map((o) => (
            <Chip
              key={o.id}
              active={sp.owasp === o.id}
              href={withParam(sp, "owasp", sp.owasp === o.id ? undefined : o.id)}
            >
              {o.id} {o.name}
            </Chip>
          ))}
          {owaspInUse.size === 0 && (
            <span className="text-xs text-gray-600">none mapped yet</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-gray-500">Severity</span>
          {SEVERITY_ORDER.map((s) => (
            <Chip
              key={s}
              active={sp.severity === s}
              href={withParam(sp, "severity", sp.severity === s ? undefined : s)}
            >
              {s}
            </Chip>
          ))}
        </div>
      </div>

      {/* Active-filter summary + clear */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {anyFilter && " match your filters"}
          {findings.length === 300 && " (showing first 300)"}
        </p>
        {anyFilter && (
          <Link href="/dashboard/findings" className="text-xs text-gray-500 hover:text-brand">
            Clear filters
          </Link>
        )}
      </div>

      {/* Results */}
      <div className="mt-4 space-y-3">
        {findings.length === 0 ? (
          <p className="card text-sm text-gray-500">
            No findings{anyFilter ? " match these filters" : " yet"}.
          </p>
        ) : (
          findings.map((f) => (
            <div key={f.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/dashboard/engagements/${f.engagementId}`}
                  className="font-semibold text-white hover:text-brand"
                >
                  {f.title}
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  <SeverityBadge value={f.severity} />
                  <FindingStatusBadge value={f.status} />
                </div>
              </div>
              <FrameworkBadges attack={f.attack} owasp={f.owasp} className="mt-2" linked />
              <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                <Icon name="briefcase" className="h-3 w-3" />
                <Link
                  href={`/dashboard/engagements/${f.engagementId}`}
                  className="hover:text-gray-300"
                >
                  {f.engagement?.name ?? "Unknown engagement"}
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
