import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner, Hint } from "@/components/hint";
import {
  saveBugAccount,
  deleteBugAccount,
  syncHackerOne,
  automateAllPrograms,
  pauseAllPrograms,
  resyncAllProgramScopes,
} from "@/lib/bugbounty";
import { BUG_PLATFORMS, platformLabel } from "@/lib/bugbounty-core";
import { ProgramsManager } from "@/components/programs-manager";
import { AddProgramForm } from "@/components/add-program-form";
import { SubmissionsManager } from "@/components/submissions-manager";
import { Tabs, TabPanel } from "@/components/tabs";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";
// HackerOne sync makes several sequential API calls — give it headroom.
export const maxDuration = 60;

function PlatformSelect({ name = "platform" }: { name?: string }) {
  return (
    <select
      name={name}
      className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
    >
      {BUG_PLATFORMS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
}

export default async function BugBountyPage({
  searchParams,
}: {
  searchParams: { ok?: string; error?: string };
}) {
  const [accounts, programs, runners, submissions] = await Promise.all([
    prisma.bugAccount.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.bugProgram.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        engagement: {
          select: {
            id: true,
            name: true,
            findings: { select: { severity: true, status: true, title: true } },
            jobs: { select: { status: true } },
          },
        },
      },
    }),
    prisma.runner.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true } }),
    prisma.submission.findMany({
      orderBy: { submittedAt: "desc" },
      include: { engagement: { select: { name: true } } },
    }),
  ]);
  const submissionRows = submissions.map((s) => ({
    id: s.id,
    title: s.title,
    platform: s.platform,
    status: s.status,
    severity: s.severity,
    rewardCents: s.rewardCents,
    reportUrl: s.reportUrl,
    submittedAt: s.submittedAt.toISOString(),
    engagementName: s.engagement?.name ?? null,
  }));
  const earnedCents = submissions.reduce((n, s) => n + (s.rewardCents || 0), 0);

  const programRows = programs.map((p) => ({
    id: p.id,
    platform: p.platform,
    name: p.name,
    url: p.url,
    reward: p.reward,
    scope: p.scope,
    outScope: p.outScope,
    category: p.category,
    status: p.status,
    auto: p.auto,
    autoRunnerId: p.autoRunnerId,
    lastAutoAt: p.lastAutoAt ? p.lastAutoAt.toISOString() : null,
    engagement: p.engagement
      ? {
          id: p.engagement.id,
          name: p.engagement.name,
          findings: p.engagement.findings,
          jobs: p.engagement.jobs,
        }
      : null,
  }));
  const engagedRows = programRows.filter((p) => p.engagement);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Bug Bounty"
        subtitle={
          <span className="block max-w-2xl">
            Track the programs you hunt on HackerOne, Bugcrowd, and others. Paste a
            program&apos;s scope, turn it into an authorized engagement, and let the
            portal automate recon against the in-scope targets.
          </span>
        }
      />

      <HelpBanner>
        <p>• Save your platform handles for quick links to your dashboards.</p>
        <p>• Add a program and paste its in-scope targets (one per line).</p>
        <p>• &quot;Run pipeline now&quot; scans every in-scope target (httpx + nuclei) on a machine; findings import automatically.</p>
        <p>• Turn on <b>Enable automation</b> to run that pipeline daily and auto-sync HackerOne — fully hands-off.</p>
        <p className="text-gray-500">Only test what each program&apos;s scope explicitly authorizes.</p>
      </HelpBanner>

      {searchParams.ok && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          ✓ {searchParams.ok}
        </div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-2 text-sm text-sev-crit">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <div className="mt-6">
      <Tabs
        tabs={[
          { id: "programs", label: <span className="inline-flex items-center gap-1.5"><Icon name="target" className="h-4 w-4" />Programs ({programs.length})</span> },
          { id: "engaged", label: <span className="inline-flex items-center gap-1.5"><Icon name="briefcase" className="h-4 w-4" />Engaged ({engagedRows.length})</span> },
          { id: "submissions", label: <span className="inline-flex items-center gap-1.5"><Icon name="book" className="h-4 w-4" />Submissions ({submissions.length})</span> },
          { id: "accounts", label: <span className="inline-flex items-center gap-1.5"><Icon name="fingerprint" className="h-4 w-4" />Accounts ({accounts.length})</span> },
        ]}
        defaultTab="programs"
      >
      {/* ══════════ PROGRAMS ══════════ */}
      <TabPanel id="programs">
      {/* One-click full automation across all programs */}
      {programs.length > 0 && runners.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs">
          <form action={automateAllPrograms} className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-brand-glow">🤖 Hands-off mode:</span>
            <span className="text-gray-400">scan + auto-exploit daily on</span>
            <select
              name="runnerId"
              defaultValue={runners[0]?.id}
              className="rounded-lg border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand"
            >
              {runners.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button className="btn-primary px-2 py-1">Automate engaged programs</button>
          </form>
          <form action={pauseAllPrograms}>
            <button className="text-gray-500 hover:text-sev-med">Pause all</button>
          </form>
          <span className="text-gray-600">Only programs you&apos;ve engaged are automated.</span>
        </div>
      )}

      {/* Add a program (collapsed by default) */}
      <details className="card mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-gray-200 hover:text-brand">
          ＋ Add a program
        </summary>
        <AddProgramForm />
      </details>

      <div className="mt-4">
        <ProgramsManager programs={programRows} runners={runners} />
      </div>
      </TabPanel>

      {/* ══════════ ENGAGED ══════════ */}
      <TabPanel id="engaged">
        <p className="text-sm text-gray-400">
          Programs you&apos;ve turned into engagements — your active hunts, kept separate so
          they&apos;re easy to find and don&apos;t get lost among every program when you resync scope.
        </p>
        <div className="mt-3">
          {engagedRows.length === 0 ? (
            <p className="card text-sm text-gray-500">
              No engaged programs yet. In the Programs tab, use &quot;Create engagement&quot; on a program to start hunting it.
            </p>
          ) : (
            <ProgramsManager programs={engagedRows} runners={runners} />
          )}
        </div>
      </TabPanel>

      {/* ══════════ SUBMISSIONS ══════════ */}
      <TabPanel id="submissions">
        <p className="text-sm text-gray-400">
          The end of the loop — every bug you submit, from triage to accepted to bounty.
          {earnedCents > 0 && <span className="ml-1 text-emerald-300">Keep it going.</span>}
        </p>
        <div className="mt-3">
          <SubmissionsManager submissions={submissionRows} />
        </div>
      </TabPanel>

      {/* ══════════ ACCOUNTS ══════════ */}
      <TabPanel id="accounts">
      <p className="flex items-center gap-2 text-sm text-gray-400">
        A convenience pointer to your profile/dashboard on each platform, plus an
        optional HackerOne API token for auto-sync.
        <Hint>No passwords are stored; API tokens are encrypted and never shown again.</Hint>
      </p>

      {/* Resync every program's scope from its link, all at once */}
      {programs.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs">
          <span className="font-semibold text-brand-glow">↻ Resync all scopes</span>
          <span className="text-gray-400">
            Re-fetch every program&apos;s scope from its link — HackerOne (API), Bugcrowd &amp;
            others — and add any newly published targets. Nothing is removed.
          </span>
          <form action={resyncAllProgramScopes} className="ml-auto">
            <button className="btn-ghost px-2 py-1">Resync all programs</button>
          </form>
        </div>
      )}

      {/* Add / connect an account (collapsed by default) */}
      <details className="card mt-3" open={accounts.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-200 hover:text-brand">
          ＋ Add / connect an account
        </summary>
        <form action={saveBugAccount} className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PlatformSelect />
          <input
            name="handle"
            placeholder="@handle"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="url"
            placeholder="https://hackerone.com/yourhandle"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            name="apiUser"
            placeholder="HackerOne API username (for auto-sync)"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <input
            name="apiToken"
            type="password"
            placeholder="HackerOne API token (stored encrypted)"
            className="flex-1 rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button className="btn-ghost text-sm">Save</button>
        </div>
        <p className="text-[11px] text-gray-500">
          API auto-sync works for HackerOne (free token at hackerone.com → Settings → API
          Token). Bugcrowd/Intigriti/YesWeHack don&apos;t offer a free researcher API — add
          those programs manually below. Tokens are encrypted and never shown again.
        </p>
      </form>
      </details>

      {accounts.length > 0 && (
        <div className="mt-3 space-y-2">
          {accounts.map((a) => {
            const canSync = a.platform === "hackerone" && !!a.apiUser && !!a.apiToken;
            return (
              <div key={a.id} className="card flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0 text-sm">
                  <span className="tag mr-2 text-brand">{platformLabel(a.platform)}</span>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:underline">
                      {a.handle || a.url}
                    </a>
                  ) : (
                    <span className="text-gray-300">{a.handle}</span>
                  )}
                  {a.apiToken && <span className="ml-2 text-[11px] text-emerald-400">🔑 token set</span>}
                  {a.lastSyncStatus && (
                    <span className="ml-2 text-[11px] text-gray-500">· {a.lastSyncStatus}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {canSync && (
                    <form action={syncHackerOne}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="text-sev-low hover:text-sev-low">Sync now</button>
                    </form>
                  )}
                  <form action={deleteBugAccount}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-gray-500 hover:text-sev-crit">Remove</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      </TabPanel>
      </Tabs>
      </div>
    </div>
  );
}
