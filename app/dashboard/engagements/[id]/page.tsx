import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  SeverityBadge,
  FindingStatusBadge,
  EngagementStatusBadge,
} from "@/components/badges";
import { FrameworkBadges } from "@/components/framework-badges";
import { Breadcrumbs } from "@/components/breadcrumbs";
import {
  getEngagement,
  updateEngagementStatus,
  updateEngagementAuthorization,
  updateFindingStatus,
  deleteFinding,
  deleteEngagement,
} from "@/lib/engagements";
import {
  ENGAGEMENT_STATUSES,
  FINDING_STATUSES,
} from "@/lib/engagement-constants";
import { getPillar } from "@/data/portal";
import { EngagementWorkbench } from "@/components/engagement-workbench";
import { ReconnaissanceScanner } from "@/components/reconnaissance-scanner";
import { PipelinePanel } from "@/components/pipeline-panel";
import { createResource, deleteResource } from "@/lib/resources";
import { RESOURCE_TYPES } from "@/lib/resource-constants";
import { prisma } from "@/lib/db";
import { stageProgressMap } from "@/lib/pipeline-engine";
import { runScanNow, runDeepScanNow, runExploitNow, runTriageNow } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// Subtle tile glow keyed to a finding's risk level.
const SEV_GLOW: Record<string, string> = {
  critical: "sev-glow-critical",
  high: "sev-glow-high",
  medium: "sev-glow-medium",
  low: "sev-glow-low",
  info: "sev-glow-info",
};

export default async function EngagementDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { ok?: string; error?: string };
}) {
  const e = await getEngagement(params.id);
  if (!e) notFound();

  const openCount = e.findings.filter((f) => f.status === "open").length;
  const confirmedCount = e.findings.filter((f) => f.confirmed).length;
  const pillar = getPillar(e.type);

  // Guided-assessment pipeline state + how many runner machines exist.
  const [pipeline, progress, runnerCount] = await Promise.all([
    prisma.pipeline.findUnique({
      where: { engagementId: e.id },
      include: { stages: true },
    }),
    stageProgressMap(e.id),
    prisma.runner.count(),
  ]);

  // Engagement command center — one hub to drive every workflow for this case.
  // Tiles with `action` run immediately (one click); the rest navigate.
  type Tile = {
    icon: string;
    title: string;
    desc: string;
    accent: string;
    locked?: boolean;
    href?: string;
    action?: (formData: FormData) => Promise<void>;
    deepAction?: (formData: FormData) => Promise<void>;
  };
  const commandTiles: Tile[] = [
    {
      action: runScanNow,
      deepAction: runDeepScanNow,
      icon: "radar",
      title: "Scan & recon",
      desc: "httpx + nuclei + nmap now",
      accent: "text-sky-300",
      locked: !e.authorized,
    },
    {
      action: runExploitNow,
      icon: "skull",
      title: "Exploit & validate",
      desc: confirmedCount > 0 ? `${confirmedCount} confirmed · validate more` : "Validate exploitability now",
      accent: "text-red-300",
      locked: !e.authorized,
    },
    {
      action: runTriageNow,
      icon: "check",
      title: "Fix & triage",
      desc: `${openCount} open · add fix guidance`,
      accent: "text-emerald-300",
    },
    {
      href: "/dashboard/lab",
      icon: "wrench",
      title: "Research & lab",
      desc: "Build PoCs · Drive · exploits",
      accent: "text-amber-300",
    },
    {
      href: "/dashboard/bugbounty",
      icon: "target",
      title: "Bug finding",
      desc: "Programs & auto-hunt",
      accent: "text-fuchsia-300",
    },
    {
      href: "/dashboard/scan",
      icon: "shield",
      title: "Posture scan",
      desc: "Scheduled web checks",
      accent: "text-indigo-300",
    },
    {
      href: `/dashboard/network`,
      icon: "globe",
      title: "Check results",
      desc: "Live output & host map",
      accent: "text-cyan-300",
    },
    {
      href: `/dashboard/engagements/${e.id}/report`,
      icon: "book",
      title: "Report",
      desc: "Generate the write-up",
      accent: "text-brand-glow",
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Engagements", href: "/dashboard/engagements" },
          { label: e.name },
        ]}
      />

      {/* Header */}
      <header className="card mt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{e.name}</h1>
            <p className="mt-1 text-sm text-gray-400">
              <span className="capitalize">{e.type}</span>
              {e.client && <> · {e.client}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/engagements/${e.id}/report`}
              className="btn-ghost"
            >
              <Icon name="book" className="h-4 w-4" /> Report
            </Link>
            <EngagementStatusBadge value={e.status} />
          </div>
        </div>

        {/* Status update */}
        <form action={updateEngagementStatus} className="mt-4 flex items-center gap-2">
          <input type="hidden" name="id" value={e.id} />
          <select
            name="status"
            defaultValue={e.status}
            className="rounded-lg border border-surface-border bg-surface px-3 py-1.5 text-sm capitalize outline-none focus:border-brand"
          >
            {ENGAGEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-ghost">
            Update status
          </button>
        </form>
      </header>

      {searchParams.ok && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          ✓ {searchParams.ok}
        </div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      {/* Authorization */}
      <section
        className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
          e.authorized
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-200"
        }`}
      >
        <p className="flex items-center gap-2 font-medium">
          <Icon name={e.authorized ? "check" : "lock"} className="h-4 w-4" />
          {e.authorized
            ? `Authorized${e.authorizedBy ? ` by ${e.authorizedBy}` : ""}`
            : "Not authorized — do not test until written permission is recorded."}
        </p>
        {e.scope && (
          <p className="mt-2 whitespace-pre-wrap text-gray-300">
            <span className="text-gray-500">Scope: </span>
            {e.scope}
          </p>
        )}

        {/* Authorization toggle form */}
        <form action={updateEngagementAuthorization} className="mt-4 flex items-center gap-3">
          <input type="hidden" name="id" value={e.id} />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="authorized"
              value="true"
              defaultChecked={e.authorized}
              className="h-4 w-4 rounded border-gray-500"
            />
            <span>Mark as authorized</span>
          </label>
          {!e.authorized && (
            <input
              type="text"
              name="authorizedBy"
              placeholder="Authorized by (optional)"
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
            />
          )}
          <button type="submit" className="btn-ghost text-xs">
            Update
          </button>
        </form>
      </section>

      {/* Command center — drive every workflow for this engagement */}
      <section className="mt-6">
        <div className="flex items-center gap-2">
          <Icon name="grid" className="h-4 w-4 text-brand" />
          <h2 className="text-lg font-semibold">Command center</h2>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Everything you can do for this engagement — scan, exploit, fix,
          research, hunt, check, and report.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {commandTiles.map((t) => {
            const inner = (
              <>
                <span className={`flex items-center gap-2 ${t.accent}`}>
                  <Icon name={t.icon} className="h-4 w-4" />
                  <span className="text-sm font-semibold text-white group-hover:text-brand">
                    {t.title}
                  </span>
                  {t.locked && (
                    <Icon name="lock" className="ml-auto h-3 w-3 text-amber-400" />
                  )}
                </span>
                <span className="text-xs text-gray-500">{t.desc}</span>
              </>
            );
            const cls = "card-hover group flex flex-col gap-1 p-3 text-left";
            if (t.href) {
              return (
                <Link key={t.title} href={t.href} className={cls}>
                  {inner}
                </Link>
              );
            }
            return (
              <div key={t.title} className={`${cls} relative`}>
                <form action={t.action}>
                  <input type="hidden" name="engagementId" value={e.id} />
                  <button
                    type="submit"
                    disabled={t.locked}
                    className="flex w-full flex-col gap-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {inner}
                  </button>
                </form>
                {t.deepAction && (
                  <form action={t.deepAction}>
                    <input type="hidden" name="engagementId" value={e.id} />
                    <button
                      type="submit"
                      disabled={t.locked}
                      className="text-[10px] font-medium text-amber-300/90 hover:text-amber-200 disabled:opacity-50"
                      title="All ports + vuln scripts + bigger wordlist"
                    >
                      ⚡ Deep scan
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
        {!e.authorized && (
          <p className="mt-2 text-xs text-amber-400">
            <Icon name="lock" className="mr-1 inline h-3 w-3" />
            Scanning &amp; exploitation are locked until written authorization is recorded above.
          </p>
        )}
      </section>

      {/* Guided assessment pipeline */}
      <PipelinePanel
        engagementId={e.id}
        authorized={e.authorized}
        hasRunner={runnerCount > 0}
        pipeline={pipeline}
        progress={progress}
      />

      {/* Reconnaissance Scanner — for pentest engagements */}
      {e.type === "pentest" && e.authorized && (
        <section className="mt-6">
          <ReconnaissanceScanner engagementId={e.id} />
        </section>
      )}

      {/* Findings */}
      <div id="findings" className="mt-8 flex items-center justify-between gap-3 scroll-mt-20">
        <h2 className="text-lg font-semibold">
          Findings{" "}
          <span className="text-sm font-normal text-gray-500">
            ({e.findings.length} total · {openCount} open)
          </span>
        </h2>
        {e.findings.length > 0 && (
          <a
            href={`/api/findings/export?engagement=${e.id}`}
            className="btn-ghost shrink-0 text-sm"
            download
          >
            <Icon name="copy" className="mr-1 inline h-4 w-4" />
            Export CSV
          </a>
        )}
      </div>

      {/* Add finding — with quick-start chips from the matching workflow */}
      <EngagementWorkbench
        engagementId={e.id}
        pillarTitle={pillar?.title ?? null}
        stages={(pillar?.stages ?? []).map((s) => ({
          name: s.name,
          summary: s.summary,
        }))}
      />

      {pillar && (
        <p className="mt-2 text-xs text-gray-500">
          Following the{" "}
          <Link href={`/dashboard/${pillar.slug}`} className="text-brand hover:underline">
            {pillar.title} workflow
          </Link>
          ? Use the stage chips above to log findings as you go.
        </p>
      )}

      {/* Findings list */}
      <div className="mt-4 space-y-3">
        {e.findings.length === 0 && (
          <p className="card text-sm text-gray-500">No findings recorded yet.</p>
        )}
        {e.findings.map((f) => (
          <div
            key={f.id}
            className={`card ${f.confirmed ? "glow-danger" : SEV_GLOW[f.severity] ?? ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-white">{f.title}</h3>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {f.confirmed && (
                  <span className="tag border-red-500/50 text-red-300">✅ confirmed</span>
                )}
                <span className="flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">Risk</span>
                  <SeverityBadge value={f.severity} />
                </span>
                <FindingStatusBadge value={f.status} />
              </div>
            </div>
            <FrameworkBadges attack={f.attack} owasp={f.owasp} className="mt-2" linked />
            {f.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">
                {f.description}
              </p>
            )}
            {f.recommendation && (
              <p className="mt-2 whitespace-pre-wrap rounded-lg border border-surface-border bg-black/30 px-3 py-2 text-sm text-gray-300">
                <span className="text-gray-500">Fix: </span>
                {f.recommendation}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <form action={updateFindingStatus} className="flex items-center gap-2">
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="engagementId" value={e.id} />
                <select
                  name="status"
                  defaultValue={f.status}
                  className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs capitalize outline-none focus:border-brand"
                >
                  {FINDING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                  Save
                </button>
              </form>
              <form action={deleteFinding}>
                <input type="hidden" name="id" value={f.id} />
                <input type="hidden" name="engagementId" value={e.id} />
                <button
                  type="submit"
                  className="px-2 py-1 text-xs text-gray-500 hover:text-red-400"
                >
                  Delete
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>

      {/* Resources */}
      <h2 className="mt-10 text-lg font-semibold">
        Resources{" "}
        <span className="text-sm font-normal text-gray-500">
          ({e.resources.length})
        </span>
      </h2>
      <details className="card mt-3">
        <summary className="cursor-pointer font-semibold text-brand">
          + Attach resource
        </summary>
        <form action={createResource} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="engagementId" value={e.id} />
          <input
            name="title"
            required
            placeholder="Title *"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <select
            name="type"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            name="tags"
            placeholder="Tags (comma-separated)"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="url"
            placeholder="Online link — optional"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <input
            name="location"
            placeholder="Offline drive location — e.g. SSD:/exploits/cve-xyz/"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <button type="submit" className="btn-primary sm:col-span-2">
            Attach
          </button>
        </form>
      </details>
      <div className="mt-3 space-y-2">
        {e.resources.length === 0 && (
          <p className="card text-sm text-gray-500">
            No resources attached. Add tool docs, exploit notes, or references
            for this engagement.
          </p>
        )}
        {e.resources.map((r) => (
          <div key={r.id} className="card flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-white">
                {r.title}{" "}
                <span className="text-xs capitalize text-gray-500">· {r.type}</span>
              </p>
              {r.location && (
                <p className="mt-1 break-all font-mono text-xs text-gray-400">
                  {r.location}
                </p>
              )}
              {r.url && (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand hover:underline"
                >
                  Open link ↗
                </a>
              )}
            </div>
            <form action={deleteResource}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="engagementId" value={e.id} />
              <button type="submit" className="text-xs text-gray-600 hover:text-red-400">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>

      {/* Danger zone */}
      <form action={deleteEngagement} className="mt-10">
        <input type="hidden" name="id" value={e.id} />
        <button
          type="submit"
          className="text-xs text-gray-600 hover:text-red-400"
        >
          Delete this engagement
        </button>
      </form>
    </div>
  );
}
