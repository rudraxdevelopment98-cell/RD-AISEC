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
import { Tabs, TabPanel } from "@/components/tabs";
import { PageHeader } from "@/components/page-header";
import { FindingsBulk } from "@/components/findings-bulk";
import { EngagementMap } from "@/components/engagement-map";
import { buildEngagementGraph } from "@/lib/engagement-graph";
import { EvidencePanel } from "@/components/evidence-panel";
import { AssessmentPanel } from "@/components/assessment-panel";
import { classifyConfidence } from "@/lib/exploit-confidence";
import {
  getEngagement,
  updateEngagementStatus,
  updateEngagementAuthorization,
  updateFindingStatus,
  deleteFinding,
  deleteEngagement,
  setEngagementAuthSession,
} from "@/lib/engagements";
import {
  ENGAGEMENT_STATUSES,
  FINDING_STATUSES,
} from "@/lib/engagement-constants";
import { getPillar } from "@/data/portal";
import { EngagementWorkbench } from "@/components/engagement-workbench";
import { ReconnaissanceScanner } from "@/components/reconnaissance-scanner";
import { PipelinePanel } from "@/components/pipeline-panel";
import { EngagementDiagnostics } from "@/components/engagement-diagnostics";
import { createResource, deleteResource } from "@/lib/resources";
import { RESOURCE_TYPES } from "@/lib/resource-constants";
import { prisma } from "@/lib/db";
import { stageProgressMap, recheckPipeline } from "@/lib/pipeline-engine";
import { AutoRefresh } from "@/components/auto-refresh";
import { engagementReadiness } from "@/lib/diagnostics";
import { runScanNow, runDeepScanNow, runExploitNow, runTriageNow } from "@/lib/pipeline";
import { setSourceRepo, queueSourceRecon } from "@/lib/source-recon";
import { decryptSecret } from "@/lib/crypto";
import { describeHeader, AUTH_HEADER_TOOLS } from "@/lib/auth-scan";
import { AuthSessionForm } from "@/components/auth-session-form";

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

  // Authenticated-scan session: decrypt only to derive a safe display label
  // (the header NAME, e.g. "Cookie" / "Authorization (Bearer token)") — never
  // the secret value.
  const authSessionLabel = (() => {
    if (!e.authSession) return "";
    const header = decryptSecret(e.authSession);
    return header ? describeHeader(header) : "";
  })();

  // Severity tally for the dashboard stat row (ProjectDiscovery-style).
  const sevCount = (s: string) => e.findings.filter((f) => f.severity === s).length;
  const SEV_STATS = [
    { key: "critical", label: "Critical", dot: "bg-red-500" },
    { key: "high", label: "High", dot: "bg-orange-500" },
    { key: "medium", label: "Medium", dot: "bg-amber-500" },
    { key: "low", label: "Low", dot: "bg-sky-500" },
    { key: "info", label: "Info", dot: "bg-gray-400" },
  ];

  // Self-heal the pipeline on view: if the current stage's jobs are all done but
  // a completion event was missed (runner POST hiccup, cron not firing), nudge it
  // forward (auto-advance when autoApprove is on, else surface the approval gate)
  // so stages don't appear stuck. No-op when there's no running pipeline.
  await recheckPipeline(e.id);

  // Guided-assessment pipeline state, how many runner machines exist, and a
  // readiness diagnostic (why bug-finding might be producing nothing).
  const [pipeline, progress, runnerCount, readiness] = await Promise.all([
    prisma.pipeline.findUnique({
      where: { engagementId: e.id },
      include: { stages: true },
    }),
    stageProgressMap(e.id),
    prisma.runner.count(),
    engagementReadiness({ id: e.id, authorized: e.authorized, scope: e.scope }),
  ]);

  // Engagement data map (3D galaxy): hosts/subdomains/services/findings +
  // programs + collaborators, built from this engagement's own data.
  const [mapJobs, mapPrograms] = await Promise.all([
    prisma.job.findMany({
      where: { engagementId: e.id },
      select: { tool: true, target: true, status: true, queuedBy: true },
      take: 500,
    }),
    prisma.bugProgram.findMany({ where: { engagementId: e.id }, select: { id: true, name: true } }),
  ]);
  const engGraph = buildEngagementGraph({
    engagement: {
      id: e.id, name: e.name, client: e.client, type: e.type, status: e.status,
      scope: e.scope, ownerEmail: e.ownerEmail, sourceRepo: e.sourceRepo,
    },
    findings: e.findings.map((f) => ({
      id: f.id, title: f.title, severity: f.severity, status: f.status,
      confirmed: f.confirmed, description: f.description,
    })),
    jobs: mapJobs,
    programs: mapPrograms,
  });

  // Discipline-specific data: forensics evidence + custody, consulting assessments.
  const isForensics = e.type === "forensics";
  const isConsulting = e.type === "consulting";
  const [evidence, assessments] = await Promise.all([
    isForensics
      ? prisma.evidence.findMany({ where: { engagementId: e.id }, orderBy: { acquiredAt: "desc" }, include: { custody: { orderBy: { at: "asc" } } } })
      : Promise.resolve([]),
    isConsulting
      ? prisma.assessment.findMany({ where: { engagementId: e.id }, orderBy: { createdAt: "desc" }, include: { controls: { orderBy: { controlId: "asc" } } } })
      : Promise.resolve([]),
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

      <PageHeader title={e.name} />

      {/* Header */}
      <header className="card mt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">{e.name}</div>
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


      {/* Sub-sections as tabs so the workspace isn't one long scroll. */}
      <div className="mt-6">
      <Tabs
        defaultTab="details"
        tabs={[
          { id: "details", label: "📋 Details & Status" },
          { id: "readiness", label: "✅ Readiness" },
          { id: "command", label: "⚡ Command Center" },
          { id: "pipeline", label: "🤖 Assessment Pipeline" },
          { id: "findings", label: `🐞 Findings (${e.findings.length})` },
          ...(isForensics ? [{ id: "evidence", label: `🧪 Evidence (${evidence.length})` }] : []),
          ...(isConsulting ? [{ id: "controls", label: `🛡 Controls (${assessments.length})` }] : []),
          { id: "map", label: "🌌 Map" },
          { id: "resources", label: `📎 Resources (${e.resources.length})` },
        ]}
      >
      {/* ── Details & Status ── */}
      <TabPanel id="details">
      {/* Authorization */}
      <section
        className={`rounded-xl border px-4 py-3 text-sm ${
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
        <form action={updateEngagementAuthorization} className="mt-4 flex flex-wrap items-center gap-3">
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
              className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs text-gray-100 outline-none placeholder:text-gray-500 focus:border-brand"
            />
          )}
          <button type="submit" className="btn-ghost text-xs">
            Update
          </button>
        </form>
      </section>

      {/* Severity dashboard row */}
      <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {SEV_STATS.map((s) => (
          <div key={s.key} className="card !p-3">
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </span>
            <p className="mt-1 text-2xl font-bold text-white">{sevCount(s.key)}</p>
          </div>
        ))}
      </div>
      </TabPanel>

      {/* ── Readiness ── */}
      <TabPanel id="readiness">
        <EngagementDiagnostics readiness={readiness} engagementId={e.id} />
      </TabPanel>

      <TabPanel id="command">
      {/* Command center — drive every workflow for this engagement */}
      <section id="command" className="scroll-mt-20">
        <p className="text-sm text-gray-400">
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

        {/* White-box source recon — clone a repo on a runner and analyze it for
            frameworks, endpoints, and code-level vulnerability hypotheses. */}
        <div className="card mt-4">
          <div className="flex items-center gap-2">
            <Icon name="search" className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold text-white">White-box source recon</h3>
            <span className="tag ring-sky accent-sky text-[10px]">Shannon-style</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Point this at the target&apos;s <b>https git repo</b> (one you&apos;re authorized to
            test). A runner shallow-clones it, the portal maps frameworks + endpoints and raises
            code-level vulnerability hypotheses, then deletes the clone. Hypotheses stay
            &quot;detected&quot; until an exploit validates them.
          </p>
          <form action={setSourceRepo} className="mt-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="engagementId" value={e.id} />
            <input
              type="url"
              name="repo"
              defaultValue={e.sourceRepo ?? ""}
              placeholder="https://github.com/owner/repo"
              className="min-w-0 flex-1 rounded-lg border border-surface-border bg-black/40 px-3 py-2 font-mono text-xs text-gray-200 outline-none focus:border-brand"
            />
            <button type="submit" className="btn-ghost text-xs">Save</button>
          </form>
          <form action={queueSourceRecon} className="mt-2">
            <input type="hidden" name="engagementId" value={e.id} />
            <button
              type="submit"
              disabled={!e.authorized}
              className="btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-60"
              title={e.authorized ? "Clone + analyze on a runner" : "Record authorization first"}
            >
              <Icon name="radar" className="mr-1 inline h-4 w-4" /> Run source recon
            </button>
            <span className="ml-2 text-[11px] text-gray-600">
              runs on a connected machine · git clone is read-only and auto-deleted
            </span>
          </form>
        </div>

        {/* Authenticated / session-aware scanning — carry a login session into
            header-capable scan tools so they test AS the logged-in user, which
            reaches IDOR, broken-access-control and business-logic bugs that are
            invisible to an anonymous scan. Stored encrypted; value never shown
            back. */}
        <div className="card mt-4">
          <div className="flex items-center gap-2">
            <Icon name="lock" className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold text-white">Authenticated scanning</h3>
            {authSessionLabel ? (
              <span className="tag border-emerald-500/50 text-emerald-300 text-[10px]">
                active · {authSessionLabel}
              </span>
            ) : (
              <span className="tag text-[10px]">not set</span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Pick the auth type and enter the value — the header is built for you,
            stored <b>encrypted</b>, and once set <b>every scan on this engagement
            runs authenticated automatically</b> (injected into {AUTH_HEADER_TOOLS.join(", ")}),
            reaching IDOR / access-control / business-logic bugs an anonymous scan
            can&apos;t. The value is never displayed again.
          </p>
          <AuthSessionForm engagementId={e.id} active={authSessionLabel} />
          {authSessionLabel && (
            <form action={setEngagementAuthSession} className="mt-2">
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="authSession" value="" />
              <button type="submit" className="text-[11px] text-gray-500 hover:text-red-400">
                Clear stored session
              </button>
            </form>
          )}
          <p className="mt-2 text-[11px] text-amber-500/80">
            <Icon name="alert" className="mr-1 inline h-3 w-3" />
            Only use a session you own or are explicitly authorized to test with.
          </p>
        </div>
      </section>
      </TabPanel>

      <TabPanel id="pipeline">
      {/* While the pipeline is actively running, poll so it advances stages
          hands-free (each refresh re-checks completion via recheckPipeline). */}
      {(pipeline?.status === "running" || pipeline?.status === "advancing") && (
        <AutoRefresh seconds={6} />
      )}
      {/* Guided assessment pipeline */}
      <div id="pipeline" className="scroll-mt-20">
        <PipelinePanel
          engagementId={e.id}
          authorized={e.authorized}
          hasRunner={runnerCount > 0}
          pipeline={pipeline}
          progress={progress}
        />
      </div>

      {/* Reconnaissance Scanner — for pentest engagements (advanced, collapsed) */}
      {e.type === "pentest" && e.authorized && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-gray-300 hover:text-brand">
            <Icon name="radar" className="mr-1 inline h-4 w-4" /> More scan tools (manual recon)
          </summary>
          <section className="mt-3">
            <ReconnaissanceScanner engagementId={e.id} />
          </section>
        </details>
      )}
      </TabPanel>

      <TabPanel id="findings">
      {/* Findings */}
      <div id="findings" className="flex items-center justify-between gap-3 scroll-mt-20">
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

      {/* Findings — tabular with search, category filter, and a bulk action bar
          (tag / set status / delete) + per-row confidence badge & exploit link. */}
      <div className="mt-4">
        {e.findings.length === 0 ? (
          <p className="card text-sm text-gray-500">No findings recorded yet.</p>
        ) : (
          <FindingsBulk
            findings={e.findings.map((f) => ({
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
              engagementId: e.id,
              engagementName: e.name,
            }))}
          />
        )}
      </div>

      </TabPanel>

      {isForensics && (
        <TabPanel id="evidence">
          <EvidencePanel engagementId={e.id} evidence={evidence} />
        </TabPanel>
      )}

      {isConsulting && (
        <TabPanel id="controls">
          <AssessmentPanel engagementId={e.id} assessments={assessments} />
        </TabPanel>
      )}

      <TabPanel id="map">
      {/* Engagement data map — 3D galaxy of this case's hosts/findings/people. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">🌌 Engagement map</h2>
        <Link href={`/dashboard/engagements/map?e=${e.id}`} className="text-xs text-brand hover:underline">
          Open full-screen <Icon name="arrow" className="inline h-3 w-3" />
        </Link>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Hosts, subdomains, services, findings, programs and collaborators for this
        engagement — linked and explorable. Tap any bubble for details.
      </p>
      <div className="mt-3">
        <EngagementMap graph={engGraph} engagementId={e.id} />
      </div>
      </TabPanel>

      <TabPanel id="resources">
      {/* Resources */}
      <h2 id="resources" className="scroll-mt-20 text-lg font-semibold">
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

      </TabPanel>
      </Tabs>
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
