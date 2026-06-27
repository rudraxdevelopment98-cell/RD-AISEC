import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner, Hint } from "@/components/hint";
import {
  saveBugAccount,
  deleteBugAccount,
  addBugProgram,
  syncHackerOne,
  automateAllPrograms,
  pauseAllPrograms,
} from "@/lib/bugbounty";
import { BUG_PLATFORMS, platformLabel } from "@/lib/bugbounty-core";
import { ProgramsManager } from "@/components/programs-manager";

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
  const [accounts, programs, runners] = await Promise.all([
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
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">Bug Bounty</h1>
      <p className="mt-1 max-w-2xl text-gray-400">
        Track the programs you hunt on HackerOne, Bugcrowd, and others. Paste a
        program&apos;s scope, turn it into an authorized engagement, and let the
        portal automate recon against the in-scope targets.
      </p>

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
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      {/* ── Accounts ─────────────────────────────────────── */}
      <h2 className="mt-8 flex items-center gap-2 text-lg font-bold">
        Platform accounts
        <Hint>
          A convenience pointer to your profile/dashboard on each platform. No
          passwords or API tokens are stored.
        </Hint>
      </h2>
      <form action={saveBugAccount} className="card mt-3 space-y-2">
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
                      <button className="text-sky-400 hover:text-sky-300">Sync now</button>
                    </form>
                  )}
                  <form action={deleteBugAccount}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-gray-500 hover:text-red-400">Remove</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add program ──────────────────────────────────── */}
      <h2 className="mt-8 text-lg font-bold">Add a program</h2>
      <form action={addBugProgram} className="card mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <PlatformSelect />
          <input
            name="name"
            required
            placeholder="Program name"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </div>
        <input
          name="url"
          placeholder="Program/brief link"
          className="w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <div>
          <label className="flex items-center gap-1 text-xs font-semibold text-gray-400">
            In-scope targets (one per line)
            <Hint>Paste from the program&apos;s scope. Wildcards (*.example.com) and URLs are cleaned to scannable hosts.</Hint>
          </label>
          <textarea
            name="scope"
            rows={4}
            placeholder={"*.example.com\napi.example.com\nexample.com"}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <textarea
            name="outScope"
            rows={2}
            placeholder="Out of scope (one per line)"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand"
          />
          <div className="flex flex-col gap-3">
            <input
              name="reward"
              placeholder="Rewards (e.g. up to $5,000)"
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <input
              name="category"
              placeholder="Category (e.g. web, mobile, priority)"
              className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
        </div>
        <button className="btn-primary text-sm">Add program</button>
      </form>

      {/* ── Programs ─────────────────────────────────────── */}
      <h2 className="mt-8 text-lg font-bold">
        Programs {programs.length > 0 && <span className="text-sm font-normal text-gray-500">({programs.length})</span>}
      </h2>

      {/* One-click full automation across all programs */}
      {programs.length > 0 && runners.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs">
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
            <button className="text-gray-500 hover:text-amber-400">Pause all</button>
          </form>
          <span className="text-gray-600">Only programs you&apos;ve engaged are automated.</span>
        </div>
      )}
      <ProgramsManager
        programs={programs.map((p) => ({
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
        }))}
        runners={runners}
      />
    </div>
  );
}
