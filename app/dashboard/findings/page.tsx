import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { EmptyState } from "@/components/empty-state";
import { FindingsBulk } from "@/components/findings-bulk";
import { MITRE_TACTICS, OWASP_TOP10 } from "@/data/frameworks";
import { SEVERITY_ORDER } from "@/lib/report";
import { importFindingsCsv } from "@/lib/finding-actions";

export const dynamic = "force-dynamic";

type SP = {
  attack?: string;
  owasp?: string;
  severity?: string;
  status?: string;
  category?: string;
  q?: string;
  ok?: string;
  error?: string;
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
  if (sp.category) where.category = sp.category;
  if (sp.q) where.title = { contains: sp.q, mode: "insensitive" };

  const [findings, present, cats, engagements] = await Promise.all([
    prisma.finding.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { engagement: { select: { id: true, name: true } } },
    }),
    prisma.finding.groupBy({ by: ["attack", "owasp"], _count: true }),
    prisma.finding.groupBy({ by: ["category"], _count: true }),
    prisma.engagement.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
  ]);

  const attacksInUse = new Set(present.map((p) => p.attack).filter(Boolean));
  const owaspInUse = new Set(present.map((p) => p.owasp).filter(Boolean));
  const categoriesInUse = cats.map((c) => c.category).filter(Boolean);

  const anyFilter = !!(sp.attack || sp.owasp || sp.severity || sp.status || sp.category || sp.q);

  // CSV export honors the current filters (real filter keys only).
  const exportQs = new URLSearchParams();
  for (const k of ["attack", "owasp", "severity", "status", "q"] as const) {
    if (sp[k]) exportQs.set(k, sp[k]!);
  }
  const exportHref = `/api/findings/export${exportQs.toString() ? `?${exportQs}` : ""}`;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Findings</h1>
          <p className="mt-1 text-gray-400">
            Every finding across all engagements. Filter by framework, severity,
            or status to triage.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {findings.length > 0 && (
            <a href={exportHref} className="btn-ghost text-sm" download>
              <Icon name="copy" className="mr-1 inline h-4 w-4" />
              Export CSV
            </a>
          )}
          {engagements.length > 0 && (
            <details className="relative">
              <summary className="btn-ghost cursor-pointer list-none text-sm">
                <Icon name="arrow" className="mr-1 inline h-4 w-4" /> Import
              </summary>
              <form
                action={importFindingsCsv}
                encType="multipart/form-data"
                className="glass-panel absolute right-0 z-30 mt-2 w-72 space-y-2 rounded-lg border border-surface-border p-3"
              >
                <p className="text-xs text-gray-400">Import findings from CSV into:</p>
                <select name="engagementId" required className="w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand">
                  {engagements.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                <input type="file" name="file" accept=".csv,text/csv" required className="w-full text-xs text-gray-400 file:mr-2 file:rounded file:border-0 file:bg-brand file:px-2 file:py-1 file:text-black" />
                <p className="text-[10px] text-gray-600">Columns: Title (required), Severity, Status, Category, Description, Recommendation.</p>
                <button className="btn-primary w-full text-xs">Import CSV</button>
              </form>
            </details>
          )}
        </div>
      </div>

      {sp.ok && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">✓ {sp.ok}</div>
      )}
      {sp.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />{sp.error}
        </div>
      )}

      <HelpBanner>
        <p>• Click a framework / severity / category chip to filter; click again to clear.</p>
        <p>• Select findings to bulk delete, set status, or tag a category.</p>
        <p>• Export/Import findings as CSV. Confirmed-exploitable findings glow red.</p>
      </HelpBanner>

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
        {categoriesInUse.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-gray-500">Category</span>
            {categoriesInUse.map((c) => (
              <Chip
                key={c}
                active={sp.category === c}
                href={withParam(sp, "category", sp.category === c ? undefined : c)}
              >
                {c}
              </Chip>
            ))}
          </div>
        )}
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
      {findings.length === 0 ? (
        <div className="mt-4">
          {anyFilter ? (
            <EmptyState icon="search" title="No findings match these filters">
              Try clearing a filter, or broaden your search.
            </EmptyState>
          ) : (
            <EmptyState
              icon="alert"
              title="No findings yet"
              actionHref="/dashboard/jobs"
              actionLabel="Run a scan"
            >
              Findings appear here as you run scans, import Burp issues, or log them
              on an engagement. They&apos;re auto-tagged to ATT&amp;CK / OWASP.
            </EmptyState>
          )}
        </div>
      ) : (
        <FindingsBulk
          findings={findings.map((f) => ({
            id: f.id,
            title: f.title,
            severity: f.severity,
            status: f.status,
            attack: f.attack,
            owasp: f.owasp,
            confirmed: f.confirmed,
            category: f.category,
            engagementId: f.engagementId,
            engagementName: f.engagement?.name ?? null,
          }))}
        />
      )}
    </div>
  );
}
