import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { EmptyState } from "@/components/empty-state";
import { FindingsBulk } from "@/components/findings-bulk";
import { NavSelect } from "@/components/nav-select";
import { MITRE_TACTICS, OWASP_TOP10 } from "@/data/frameworks";
import { SEVERITY_ORDER } from "@/lib/report";
import { importFindingsCsv } from "@/lib/finding-actions";
import { deleteSuppression } from "@/lib/suppression";
import { classifyConfidence } from "@/lib/exploit-confidence";
import { bySignalDesc } from "@/lib/finding-signal";

export const dynamic = "force-dynamic";

type SP = {
  attack?: string;
  owasp?: string;
  severity?: string;
  status?: string;
  category?: string;
  q?: string;
  engagement?: string;
  since?: string;
  sort?: string;
  ok?: string;
  error?: string;
};

// Severity rank for sorting (critical first).
const SEV_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
const SORT_OPTIONS = [
  { value: "signal", label: "Priority (smart triage)" },
  { value: "severity", label: "Severity (high→low)" },
  { value: "recent", label: "Most recent" },
  { value: "oldest", label: "Oldest first" },
  { value: "status", label: "Status" },
];

// Finding statuses (schema enum-as-string) — for the status filter chips.
const FINDING_STATUSES = ["open", "fixed", "accepted", "false_positive"] as const;

// "Created within" presets → how far back to include (ms).
const SINCE_MS: Record<string, number> = {
  "1d": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};
const SINCE_OPTIONS = [
  { value: "1d", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

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
  if (sp.engagement) where.engagementId = sp.engagement;
  if (sp.since && SINCE_MS[sp.since]) {
    where.createdAt = { gte: new Date(Date.now() - SINCE_MS[sp.since]) };
  }
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

  // Learned false-positive rules (self-improving accuracy loop).
  const suppressions = await prisma.suppression.findMany({ orderBy: { hits: "desc" } });
  const totalSuppressed = suppressions.reduce((n, s) => n + s.hits, 0);

  const attacksInUse = new Set(present.map((p) => p.attack).filter(Boolean));
  const owaspInUse = new Set(present.map((p) => p.owasp).filter(Boolean));
  const categoriesInUse = cats.map((c) => c.category).filter(Boolean);

  const anyFilter = !!(
    sp.attack ||
    sp.owasp ||
    sp.severity ||
    sp.status ||
    sp.category ||
    sp.q ||
    sp.engagement ||
    sp.since
  );
  // Chip filters live in a collapsible drawer; open it when one is active so the
  // user sees what's applied, otherwise keep it closed to maximize the list area.
  const chipFilterActive = !!(sp.attack || sp.owasp || sp.severity || sp.status || sp.category);
  const activeChipCount =
    (sp.attack ? 1 : 0) + (sp.owasp ? 1 : 0) + (sp.severity ? 1 : 0) + (sp.status ? 1 : 0) + (sp.category ? 1 : 0);

  // CSV export honors the current filters (real filter keys only).
  const exportQs = new URLSearchParams();
  for (const k of ["attack", "owasp", "severity", "status", "category", "q", "since"] as const) {
    if (sp[k]) exportQs.set(k, sp[k]!);
  }
  if (sp.engagement) exportQs.set("engagement", sp.engagement);
  const exportHref = `/api/findings/export${exportQs.toString() ? `?${exportQs}` : ""}`;

  // Sort the loaded set. Default is smart-triage "signal" so real, actionable
  // bugs surface above the noise; other sorts stay available.
  const sorted =
    sp.sort === "recent"
      ? findings
      : sp.sort === "oldest"
        ? [...findings].reverse()
        : sp.sort === "severity"
          ? [...findings].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9))
          : sp.sort === "status"
            ? [...findings].sort((a, b) => a.status.localeCompare(b.status))
            : [...findings].sort(bySignalDesc);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Findings"
        subtitle="Every finding across all engagements. Filter by framework, severity, or status to triage."
        actions={
          <>
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
                <p className="text-[11px] text-gray-400">Columns: Title (required), Severity, Status, Category, Description, Recommendation.</p>
                <button className="btn-primary w-full text-xs">Import CSV</button>
              </form>
            </details>
          )}
          </>
        }
      />

      {sp.ok && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">✓ {sp.ok}</div>
      )}
      {sp.error && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-2 text-sm text-sev-crit">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />{sp.error}
        </div>
      )}

      <HelpBanner>
        <p>• Click a framework / severity / category chip to filter; click again to clear.</p>
        <p>• Select findings to bulk delete, set status, or tag a category.</p>
        <p>• Mark a finding <b>false positive</b> and the engine <b>learns</b> to suppress that class on future scans (see Learned rules below).</p>
        <p>• Export/Import findings as CSV. Confirmed-exploitable findings glow red.</p>
      </HelpBanner>

      {/* Learned false positives — the self-improving accuracy loop. */}
      {suppressions.length > 0 && (
        <details className="card mt-4">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-200">
            <Icon name="shield" className="h-4 w-4 text-brand" />
            Learned accuracy rules
            <span className="tag ring-emerald accent-emerald">{suppressions.length} rule{suppressions.length === 1 ? "" : "s"}</span>
            {totalSuppressed > 0 && (
              <span className="tag">{totalSuppressed} auto-suppressed</span>
            )}
          </summary>
          <p className="mt-2 text-xs text-gray-500">
            The engine learns from your triage. Mark a finding a false positive and
            it remembers the pattern and drops matches on future scans
            (<span className="text-gray-400">suppressed</span>). Confirm a finding
            as real and that class is protected — never auto-suppressed
            (<span className="text-emerald-300/80">protected</span>, allow beats
            suppress). Remove any rule to reverse it.
          </p>
          <ul className="mt-3 space-y-1.5">
            {suppressions.map((s) => {
              const isAllow = s.kind === "allow";
              return (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-surface-border bg-black/20 px-3 py-1.5 text-xs">
                <span className="min-w-0">
                  {isAllow ? (
                    <span className="mr-2 tag ring-emerald accent-emerald">protected</span>
                  ) : (
                    <span className="mr-2 tag">suppressed</span>
                  )}
                  <span className="font-mono text-gray-300">{s.titleKey || "(unclassified)"}</span>
                  {s.vulnClass && <span className="ml-2 text-gray-500">· {s.vulnClass}</span>}
                  {isAllow ? (
                    <span className="ml-2 text-emerald-300/80">· confirmed real — never auto-suppressed</span>
                  ) : (
                    s.hits > 0 && <span className="ml-2 text-emerald-300/80">· suppressed {s.hits}×</span>
                  )}
                </span>
                <form action={deleteSuppression}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="shrink-0 text-gray-500 hover:text-sev-crit">Remove</button>
                </form>
              </li>
              );
            })}
          </ul>
        </details>
      )}

      {/* Action bar: search + scope filters (engagement · created-within) */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <form className="flex min-w-[14rem] flex-1 gap-2" action="/dashboard/findings">
          {/* preserve other filters on search */}
          {sp.attack && <input type="hidden" name="attack" value={sp.attack} />}
          {sp.owasp && <input type="hidden" name="owasp" value={sp.owasp} />}
          {sp.severity && <input type="hidden" name="severity" value={sp.severity} />}
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          {sp.engagement && <input type="hidden" name="engagement" value={sp.engagement} />}
          {sp.since && <input type="hidden" name="since" value={sp.since} />}
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          <input
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Search finding titles…"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button className="btn-ghost text-sm">Search</button>
        </form>
        {engagements.length > 0 && (
          <NavSelect
            param="engagement"
            value={sp.engagement}
            label="Engagement"
            allLabel="All engagements"
            options={engagements.map((e) => ({ value: e.id, label: e.name }))}
          />
        )}
        <NavSelect
          param="since"
          value={sp.since}
          label="Created"
          allLabel="Any time"
          options={SINCE_OPTIONS}
        />
        <NavSelect
          param="sort"
          value={sp.sort}
          label="Sort"
          allLabel="Newest first"
          options={SORT_OPTIONS}
        />
      </div>

      {/* Filter groups — tucked into a drawer so the findings list gets the room */}
      <details className="group mt-4 rounded-xl border border-surface-border bg-surface-card/30" open={chipFilterActive}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-semibold text-gray-300">
          <Icon name="search" className="h-4 w-4 text-brand" />
          Filters
          {activeChipCount > 0 && (
            <span className="tag ring-emerald accent-emerald">{activeChipCount} active</span>
          )}
          <span className="ml-auto text-xs font-normal text-gray-500 group-open:hidden">Show ▾</span>
          <span className="ml-auto hidden text-xs font-normal text-gray-500 group-open:inline">Hide ▴</span>
        </summary>
        <div className="space-y-3 px-3 pb-3">
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
            <span className="text-xs text-gray-500">none mapped yet</span>
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
            <span className="text-xs text-gray-500">none mapped yet</span>
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-gray-500">Status</span>
          {FINDING_STATUSES.map((s) => (
            <Chip
              key={s}
              active={sp.status === s}
              href={withParam(sp, "status", sp.status === s ? undefined : s)}
            >
              {s.replace("_", " ")}
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
      </details>

      {/* Active-filter summary + clear */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-400">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {anyFilter && " match your filters"}
          {findings.length === 300 && " (showing the first 300)"}
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
          findings={sorted.map((f) => ({
            id: f.id,
            title: f.title,
            severity: f.severity,
            status: f.status,
            attack: f.attack,
            owasp: f.owasp,
            confirmed: f.confirmed,
            confidence: classifyConfidence({
              title: f.title,
              description: f.description,
              confirmedFlag: f.confirmed,
            }).level,
            category: f.category,
            sources: f.sources,
            retest: f.retest,
            retestNote: f.retestNote,
            engagementId: f.engagementId,
            engagementName: f.engagement?.name ?? null,
          }))}
        />
      )}
    </div>
  );
}
