import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { CreateRunnerForm } from "@/components/runner-create";
import { EnrollCodeForm } from "@/components/runner-enroll";
import { RunnerDownloadCard } from "@/components/runner-download";
import { MaintenanceBadge } from "@/components/maintenance-indicator";
import { AutoRefresh } from "@/components/auto-refresh";
import { HelpBanner, Hint } from "@/components/hint";
import { deleteRunner, setRunnerAnonymity, setRunnerWorkers, setRunnerMaintenance, requestInstall, installAllTools, revokeEnrollCode } from "@/lib/runners";
import {
  RUNNER_ONLINE_WINDOW_MS,
  RUNNER_VERSION,
  installableTools,
  installLabel,
  isInstallable,
} from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

// Hour choices for the maintenance-window selects (00:00–23:00).
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// Compact relative time ("just now" / "12s ago" / "4m ago" / "2h ago") — far more
// scannable on a status card than a full locale timestamp.
function ago(date: Date | string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// GB from MB, one decimal (e.g. 2.1).
const gb = (mb?: number | null) => (mb ? (mb / 1024).toFixed(1) : "—");

export default async function RunnersPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  // Auto-fail installs stuck "installing" too long (runner restarted mid-install).
  await prisma.install.updateMany({
    where: { status: "installing", createdAt: { lt: new Date(Date.now() - 45 * 60_000) } },
    data: {
      status: "failed",
      output: "Install did not finish in time (the runner may have restarted). Try again.",
      finishedAt: new Date(),
    },
  });

  const session = await auth();
  const ownerEmail = session?.user?.email ?? "";

  const [runners, missingFromJobs, enrollCodes, activeJobs] = await Promise.all([
    prisma.runner.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        installs: {
          where: { status: { in: ["pending", "installing", "failed"] } },
          orderBy: { createdAt: "desc" },
          take: 6,
        },
      },
    }),
    // Jobs that failed because the tool wasn't installed → install suggestions.
    prisma.job.findMany({
      where: {
        status: "failed",
        output: { contains: "is not installed" },
        runnerId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { runner: { select: { id: true, name: true } } },
    }),
    // This owner's live enrollment codes (not revoked, not expired) for the
    // management list. Hash is never selected; the plaintext is long gone.
    ownerEmail
      ? prisma.enrollCode.findMany({
          where: { ownerEmail, revoked: false, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    // What every machine is running right now — for the fleet matrix.
    prisma.job.findMany({
      where: { status: "running", runnerId: { not: null } },
      select: { runnerId: true, tool: true, target: true },
      take: 200,
    }),
  ]);

  // Group running jobs by machine for the "what's running now" column.
  const runningByRunner = new Map<string, { tool: string; target: string }[]>();
  for (const j of activeJobs) {
    if (!j.runnerId) continue;
    const list = runningByRunner.get(j.runnerId) ?? [];
    list.push({ tool: j.tool, target: j.target });
    runningByRunner.set(j.runnerId, list);
  }

  // Build a deduped list of (runner, tool) install suggestions from failures,
  // limited to tools we can install via apt and not already queued/installed.
  const installablePending = new Set(
    runners.flatMap((r) =>
      r.installs
        .filter((i) => i.status === "pending" || i.status === "installing")
        .map((i) => `${r.id}:${i.tool}`),
    ),
  );
  const installedByRunner = new Map(
    runners.map((r) => [r.id, new Set((r.installed ?? "").split(",").map((s) => s.trim()))]),
  );
  const seenSug = new Set<string>();
  const suggestions = missingFromJobs
    .filter((j) => j.runner && isInstallable(j.tool))
    .map((j) => ({ runnerId: j.runner!.id, runnerName: j.runner!.name, tool: j.tool }))
    .filter((s) => {
      const key = `${s.runnerId}:${s.tool}`;
      if (seenSug.has(key) || installablePending.has(key)) return false;
      if (installedByRunner.get(s.runnerId)?.has(s.tool)) return false;
      seenSug.add(key);
      return true;
    });

  const now = Date.now();
  // Only poll when there's something live to watch — a runner online, or a tool
  // install in flight. On an idle page nothing changes, so don't reload under
  // the user. (Visibility-gated in the component too.)
  const anyLive =
    installablePending.size > 0 ||
    runners.some(
      (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
    );

  return (
    <div className="mx-auto max-w-5xl">
      {anyLive && <AutoRefresh seconds={10} />}

      <PageHeader
        title="Machines"
        subtitle={
          <>
            Connect machines you control (e.g. Kali in UTM/Parallels) as runners. Each
            polls over HTTPS, executes tools locally, and posts results back — nothing
            offensive runs in the cloud. Anything the portal needs to run goes to the
            machine you select. See{" "}
            <code className="font-mono text-xs text-brand">runner/README.md</code>.
          </>
        }
      />

      <HelpBanner>
        <p>• <strong>Add a machine</strong> below → generate an enrollment code → run the one command on your machine. It comes online and stays online (self-heals a lost token).</p>
        <p>• A green dot = online (polled recently). Install missing tools right from a machine&apos;s card.</p>
        <p>• Toggle Tor per machine to route tool traffic anonymously. Then queue work on the Jobs page.</p>
      </HelpBanner>

      {/* Fleet matrix — every machine at a glance: status, resources, tools, and
          what each is running right now. One place to see the whole fleet. */}
      {runners.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-surface-border">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Machine</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">CPU / RAM</th>
                <th className="px-3 py-2 font-medium">Tools</th>
                <th className="px-3 py-2 font-medium">Running now</th>
                <th className="px-3 py-2 font-medium">Control</th>
              </tr>
            </thead>
            <tbody>
              {runners.map((r) => {
                const seenMs = r.lastSeenAt ? now - new Date(r.lastSeenAt).getTime() : Infinity;
                const isOnline = seenMs < RUNNER_ONLINE_WINDOW_MS;
                const isRecon = !isOnline && seenMs < RUNNER_ONLINE_WINDOW_MS * 4;
                const toolN = (r.installed ?? "").split(",").map((s) => s.trim()).filter(Boolean).length;
                const running = runningByRunner.get(r.id) ?? [];
                const unlockedRow = !!r.fullControlUntil && new Date(r.fullControlUntil).getTime() > now;
                return (
                  <tr key={r.id} className="border-b border-surface-border/50 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <Link href={`/dashboard/runners/${r.id}`} className="font-medium text-white hover:text-brand">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span className={isOnline ? "text-emerald-400" : isRecon ? "text-amber-400" : "text-gray-500"}>
                        ● {isOnline ? "online" : isRecon ? "reconnecting" : "offline"}
                      </span>
                      {r.lastSeenAt && !isOnline && (
                        <span className="ml-1 text-xs text-gray-600">{ago(r.lastSeenAt, now)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-gray-400">
                      {isOnline && (r.cpuPct != null || r.memPct != null)
                        ? `${r.cpuPct ?? "–"}% / ${r.memPct ?? "–"}%`
                        : "–"}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{toolN}</td>
                    <td className="px-3 py-2">
                      {running.length === 0 ? (
                        <span className="text-gray-600">idle</span>
                      ) : (
                        <span className="text-sky-400">
                          {running.length} job{running.length > 1 ? "s" : ""}
                          <span className="ml-1 text-xs text-gray-500">
                            ({running.slice(0, 3).map((j) => j.tool).join(", ")}
                            {running.length > 3 ? "…" : ""})
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {unlockedRow ? (
                        <span className="text-xs text-emerald-400">🔓 unlocked</span>
                      ) : (
                        <span className="text-xs text-gray-500">🔒 locked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Installations — tools that jobs need but the machine is missing */}
      {suggestions.length > 0 && (
        <div className="mt-4 rounded-lg border border-sev-med/40 bg-sev-med/10 p-4">
          <h2 className="text-sm font-semibold text-sev-med">
            <Icon name="wrench" className="mr-1 inline h-4 w-4" />
            Installations needed
          </h2>
          <p className="mt-1 text-xs text-gray-400">
            A job failed because a tool isn&apos;t installed on the machine.
            Approve the install — one click runs <code className="font-mono">apt</code>{" "}
            (or <code className="font-mono">go install</code> for tools with no apt
            package, like httpx) on the machine (needs your authorization).
          </p>
          <div className="mt-3 space-y-2">
            {suggestions.map((s) => (
              <form
                key={`${s.runnerId}:${s.tool}`}
                action={requestInstall}
                className="flex flex-wrap items-center gap-3 rounded-md border border-surface-border bg-black/30 px-3 py-2"
              >
                <input type="hidden" name="runnerId" value={s.runnerId} />
                <input type="hidden" name="tool" value={s.tool} />
                <span className="text-sm">
                  Install <span className="font-mono text-white">{s.tool}</span> on{" "}
                  <span className="text-gray-300">{s.runnerName}</span>
                </span>
                <label className="flex items-center gap-1.5 text-xs text-gray-400">
                  <input type="checkbox" name="confirm" value="true" required className="h-3.5 w-3.5 accent-emerald-500" />
                  I authorize this install
                </label>
                <button className="btn-ghost px-2 py-1 text-xs">Install</button>
              </form>
            ))}
          </div>
        </div>
      )}

      {/* How-to-connect hint */}
      <details className="card mt-6">
        <summary className="cursor-pointer font-semibold text-brand">
          <Icon name="bolt" className="mr-1 inline h-4 w-4" />
          How do I connect my Kali Linux?
        </summary>
        <div className="mt-4 space-y-4 text-sm text-gray-300">
          <p className="text-gray-400">
            Works with any Kali — UTM VM, a physical laptop, bare metal, or a
            cloud box. The runner only makes <strong>outbound HTTPS</strong>{" "}
            calls, so there are no ports to open.
          </p>

          <div>
            <p className="font-semibold text-white">1. Add a machine (get a code)</p>
            <p className="text-gray-400">
              In <strong>Add a machine</strong> below, click{" "}
              <em>Generate enrollment code</em> and <strong>copy the one command</strong>{" "}
              it shows. That command does everything on the machine — no token to
              paste, and it self-heals if the token is ever lost.
            </p>
          </div>

          <div>
            <p className="font-semibold text-white">2. Run that one command on Kali</p>
            <p className="text-gray-400">
              Paste it into a terminal on your machine (UTM/Parallels VM, a laptop,
              bare metal, or a cloud box). It downloads the runner, installs it as a
              service that starts on boot, and enrolls it — no git, no repo, no
              config. The runner makes only <strong>outbound HTTPS</strong> calls —
              no ports to open, nothing to <code className="font-mono">pip install</code>{" "}
              (Python 3 stdlib only).
            </p>
            <pre className="mt-1 overflow-x-auto rounded-lg border border-surface-border bg-black/50 p-3 font-mono text-xs text-gray-300">
{`# one command — the card fills in your code:
curl -fsSL "https://rd-aisec.vercel.app/api/runner/bootstrap?code=rde_…" | sudo bash`}
            </pre>
          </div>

          <div>
            <p className="font-semibold text-white">3. Verify &amp; test</p>
            <p className="text-gray-400">
              The machine flips to <span className="text-brand">online</span>{" "}
              below within seconds. Install any missing tool <strong>one-click</strong>{" "}
              from its card, then queue an <code className="font-mono">nmap</code> →{" "}
              <em>Quick</em> against{" "}
              <code className="font-mono">scanme.nmap.org</code>, watch it run, and{" "}
              <strong>Import to findings</strong>.
            </p>
          </div>

          <p className="text-xs text-gray-500">
            Prefer a fixed token instead of self-healing enrollment? Use{" "}
            <strong>Advanced — create a one-off token</strong> under{" "}
            <strong>Add a machine</strong>, then set{" "}
            <code className="font-mono">RUNNER_TOKEN</code> when you run the installer.
          </p>

          <p className="rounded-lg border border-sev-low/30 bg-sev-low/10 px-3 py-2 text-xs text-sev-low">
            💡 Running the portal locally instead of Vercel? Set{" "}
            <code className="font-mono">PORTAL_URL=&quot;http://&lt;your-PC-LAN-IP&gt;:3000&quot;</code>{" "}
            — not <code className="font-mono">localhost</code>, which would point
            at the Kali box itself. Full guide:{" "}
            <code className="font-mono">runner/README.md</code>.
          </p>
        </div>
      </details>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-3 text-sm text-sev-crit">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <RunnerDownloadCard />

      <EnrollCodeForm />

      {enrollCodes.length > 0 && (
        <div className="card mt-4">
          <h2 className="text-sm font-semibold text-brand">
            <Icon name="lock" className="mr-1 inline h-4 w-4" />
            Active enrollment codes{" "}
            <Hint>
              Machines can still enroll with these. The code itself is never shown
              again — revoke one to stop any new enrollments using it (already-enrolled
              machines keep their tokens).
            </Hint>
          </h2>
          <div className="mt-3 divide-y divide-surface-border">
            {enrollCodes.map((c) => {
              const atLimit = c.usedCount >= c.maxUses;
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-white">
                      {c.label || "Unlabeled code"}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      code …{c.id.slice(-6)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                    <span title="Enrollments used / allowed" className={atLimit ? "text-sev-med" : ""}>
                      {c.usedCount}/{c.maxUses} used
                    </span>
                    <span>expires {new Date(c.expiresAt).toLocaleDateString()}</span>
                    {c.lastUsedAt && (
                      <span>last used {new Date(c.lastUsedAt).toLocaleDateString()}</span>
                    )}
                    <form action={revokeEnrollCode}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="btn-ghost px-2 py-1 text-xs text-sev-crit">
                        Revoke
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-200">
          Advanced — create a one-off token manually (no self-heal)
        </summary>
        <CreateRunnerForm />
      </details>

      {/* Registered runners */}
      {runners.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {runners.map((r) => {
            const lastSeenMs = r.lastSeenAt
              ? now - new Date(r.lastSeenAt).getTime()
              : Infinity;
            const online = lastSeenMs < RUNNER_ONLINE_WINDOW_MS;
            // Seen very recently but just outside the window → a transient blip
            // (a missed heartbeat / brief DB hiccup), not a dead machine. Show
            // "reconnecting" instead of a stark offline so a healthy box that
            // skipped one beat doesn't look gone.
            const reconnecting = !online && lastSeenMs < RUNNER_ONLINE_WINDOW_MS * 4;
            const installedSet = new Set(
              (r.installed ?? "").split(",").map((s) => s.trim()).filter(Boolean),
            );
            const missing = installableTools().filter(
              (t) => !installedSet.has(t),
            );
            const activeInstalls = r.installs.filter(
              (i) => i.status === "pending" || i.status === "installing",
            ).length;
            const outdated = !!r.version && r.version !== RUNNER_VERSION;
            return (
              <details key={r.id} className="card flex flex-col gap-3">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {/* ── Header: name · status (click the card to expand settings) ── */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="server" className="h-4 w-4 shrink-0 text-brand" />
                    <span className="truncate font-semibold text-white">{r.name}</span>
                    {outdated && (
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
                        title={`Update available (v${r.version} → v${RUNNER_VERSION}) — open to restart/update`}
                      />
                    )}
                  </div>
                  <span
                    className={`tag shrink-0 ${
                      online
                        ? "ring-emerald accent-emerald"
                        : reconnecting
                          ? "border-amber-500/40 text-amber-400"
                          : "border-gray-500/40 text-gray-400"
                    }`}
                    title={
                      r.lastSeenAt
                        ? `Last heartbeat ${ago(r.lastSeenAt, now)}`
                        : "Never connected"
                    }
                  >
                    <span
                      className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${
                        online ? "bg-emerald-400" : reconnecting ? "bg-amber-400" : "bg-gray-500"
                      }`}
                    />
                    {online ? "online" : reconnecting ? "reconnecting" : "offline"}
                  </span>
                </div>

                {/* ── Meta: last seen + at-a-glance badges ── */}
                <div>
                  <p className="text-xs text-gray-500">
                    {r.lastSeenAt
                      ? `Last seen ${ago(r.lastSeenAt, now)}`
                      : "Never connected yet — run the agent on the machine."}
                  </p>
                  {/* Live vitals at a glance (only when online + reported). */}
                  {online && (r.cpuPct != null || r.memTotalMb) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-gray-400">
                      {r.cpuPct != null && <span>CPU <b className="font-semibold text-gray-200">{r.cpuPct}%</b></span>}
                      {r.memTotalMb ? <span>RAM <b className="font-semibold text-gray-200">{gb(r.memUsedMb)}/{gb(r.memTotalMb)}G</b></span> : null}
                      {r.diskTotalMb ? <span>SSD <b className="font-semibold text-gray-200">{gb(r.diskUsedMb)}/{gb(r.diskTotalMb)}G</b></span> : null}
                      {r.tempC != null && <span><b className="font-semibold text-gray-200">{r.tempC}°C</b></span>}
                      {r.cores ? <span><b className="font-semibold text-gray-200">{r.cores}</b> cores</span> : null}
                    </div>
                  )}
                  {r.lastSeenAt && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {r.maintStage && r.maintStage !== "idle" && (
                        <MaintenanceBadge
                          stage={r.maintStage}
                          note={r.maintNote}
                          pct={r.maintPct}
                          startedAt={r.maintStartedAt ? new Date(r.maintStartedAt).toISOString() : null}
                          updatedAt={r.maintUpdatedAt ? new Date(r.maintUpdatedAt).toISOString() : null}
                        />
                      )}
                      {r.toolCount > 0 && <span className="tag">🧰 {r.toolCount} tools</span>}
                      {missing.length > 0 && (
                        <span className="tag border-sev-med/40 text-sev-med">
                          {missing.length} missing
                        </span>
                      )}
                      {r.version && (
                        <span
                          className={`tag ${outdated ? "border-sev-med/40 text-sev-med" : ""}`}
                          title={outdated ? "A newer runner is out — it updates itself automatically" : undefined}
                        >
                          v{r.version}
                          {outdated ? " · update ready" : ""}
                        </span>
                      )}
                      {r.anonymity && (
                        <span
                          className={`tag ${
                            r.anonStatus === "no-tor"
                              ? "border-sev-crit/40 text-sev-crit"
                              : "border-violet-500/40 text-violet-300"
                          }`}
                        >
                          🧅 Tor
                          {r.exitIp
                            ? ` · ${r.exitIp}`
                            : r.anonStatus === "no-tor"
                              ? " · not installed"
                              : " · connecting…"}
                        </span>
                      )}
                      <span className="tag" title="Jobs this machine runs in parallel">
                        ⚙ {r.maxWorkers}× parallel
                      </span>
                      {activeInstalls > 0 && (
                        <span className="tag ring-sky accent-sky">
                          <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
                          installing {activeInstalls}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-gray-600">Click to expand — or open the full machine page.</p>
                </div>
                </summary>

                {/* Full per-machine page: console, all tools, settings, jobs. */}
                <Link
                  href={`/dashboard/runners/${r.id}`}
                  className="flex items-center justify-between rounded-lg border border-surface-border bg-black/20 px-3 py-2 text-sm text-gray-300 hover:border-brand hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <Icon name="server" className="h-4 w-4 text-brand" />
                    Open machine — console · tools · settings
                  </span>
                  <Icon name="arrow" className="h-4 w-4 text-gray-500" />
                </Link>

                {/* Revoke lives in the expanded body (out of the summary). */}
                <div className="flex justify-end">
                  <form action={deleteRunner}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="text-xs text-gray-600 hover:text-sev-crit">Revoke machine</button>
                  </form>
                </div>

                {/* ── Controls: tools + anonymity ── */}
                {r.lastSeenAt && (
                  <div className="flex flex-col gap-2 border-t border-surface-border pt-3">
                    {/* Install tools (authorized) */}
                    {(missing.length > 0 || r.installs.length > 0) && (
                      <details>
                        <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-gray-300 hover:text-brand">
                          <Icon name="wrench" className="h-3.5 w-3.5" />
                          Tools
                          {missing.length > 0 && (
                            <span className="text-xs font-normal text-sev-med">
                              · {missing.length} to install
                            </span>
                          )}
                        </summary>

                        {missing.length > 0 ? (
                          <form action={requestInstall} className="mt-3 space-y-2">
                            <input type="hidden" name="runnerId" value={r.id} />
                            <select
                              name="tool"
                              className="w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-brand"
                            >
                              {missing.map((t) => (
                                <option key={t} value={t}>
                                  {t} → {installLabel(t)}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-start gap-2 text-xs text-gray-400">
                              <input
                                type="checkbox"
                                name="confirm"
                                value="true"
                                required
                                className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
                              />
                              I authorize installing software on this machine (I have permission).
                            </label>
                            <button className="btn-ghost px-3 py-1 text-xs">Install one-click</button>
                          </form>
                        ) : (
                          <p className="mt-2 text-xs text-brand/80">
                            ✓ All installable tools are present.
                          </p>
                        )}

                        {r.installs.length > 0 && (
                          <ul className="mt-3 space-y-1.5">
                            {r.installs.map((ins) => (
                              <li key={ins.id} className="text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-gray-300">{ins.tool}</span>
                                  <span
                                    className={
                                      ins.status === "failed"
                                        ? "text-sev-crit"
                                        : ins.status === "installing"
                                          ? "text-sev-low"
                                          : ins.status === "done"
                                            ? "text-brand"
                                            : "text-sev-med"
                                    }
                                  >
                                    {ins.status === "installing" && (
                                      <span className="pulse-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
                                    )}
                                    {ins.status}
                                  </span>
                                </div>
                                {ins.output && (
                                  <details className="mt-1" open={ins.status === "installing"}>
                                    <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-brand">
                                      {ins.status === "installing" ? "Live output" : "Output"}
                                    </summary>
                                    <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-surface-border bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-gray-300">
                                      {ins.output}
                                    </pre>
                                  </details>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}

                        <p className="mt-2 text-[11px] text-gray-600">
                          One-click installs use <code className="font-mono">apt</code>, or{" "}
                          <code className="font-mono">go install</code> for tools with no apt
                          package (e.g. httpx). They need the runner to run as root, set{" "}
                          <code className="font-mono">RUNNER_SUDO_PASS</code>, or have
                          passwordless sudo. (Never put a sudo password in the portal.)
                        </p>
                      </details>
                    )}

                    {/* Parallelism — how many jobs run at once on this machine */}
                    <form action={setRunnerWorkers} className="flex items-center gap-2 text-xs text-gray-400">
                      <input type="hidden" name="id" value={r.id} />
                      <label htmlFor={`w-${r.id}`}>⚙ Run</label>
                      <select
                        id={`w-${r.id}`}
                        name="workers"
                        defaultValue={String(r.maxWorkers)}
                        className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
                      >
                        {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </select>
                      <span>job(s) at once</span>
                      <button className="btn-ghost px-2 py-1 text-xs">Apply</button>
                    </form>

                    {/* Daily self-heal / maintenance window (machine local time) */}
                    <form action={setRunnerMaintenance} className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                      <input type="hidden" name="id" value={r.id} />
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          name="enabled"
                          defaultChecked={r.maintEnabled}
                          className="h-3.5 w-3.5 rounded border-surface-border bg-transparent accent-brand"
                        />
                        🔧 Self-heal
                      </label>
                      <select
                        name="startHour"
                        defaultValue={String(r.maintStartHour ?? 6)}
                        className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
                        ))}
                      </select>
                      <span>–</span>
                      <select
                        name="endHour"
                        defaultValue={String(r.maintEndHour ?? 8)}
                        className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
                        ))}
                      </select>
                      <button className="btn-ghost px-2 py-1 text-xs">Apply</button>
                    </form>

                    {/* One-click: install every missing tool on this machine */}
                    {missing.length > 0 && (
                      <form action={installAllTools}>
                        <input type="hidden" name="runnerId" value={r.id} />
                        <button
                          className="text-xs text-sev-med hover:text-sev-med disabled:opacity-40"
                          disabled={!online}
                          title={online ? "" : "Machine is offline"}
                        >
                          ⚡ Install all {missing.length} missing tool{missing.length === 1 ? "" : "s"}
                        </button>
                      </form>
                    )}

                    {/* Anonymity (Tor) */}
                    <div>
                      <form action={setRunnerAnonymity}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="on" value={(!r.anonymity).toString()} />
                        <button
                          className={`text-xs ${
                            r.anonymity
                              ? "text-violet-300 hover:text-violet-200"
                              : "text-gray-500 hover:text-violet-300"
                          }`}
                        >
                          {r.anonymity ? "🧅 Turn off Tor" : "🧅 Turn on Tor (anonymize traffic)"}
                        </button>
                      </form>

                      {/* Tor not installed → one-click install */}
                      {r.anonymity && r.anonStatus === "no-tor" && (
                        <div className="mt-2 rounded-lg border border-sev-crit/30 bg-sev-crit/5 p-2 text-xs text-sev-crit">
                          Tor isn&apos;t installed, so traffic can&apos;t be anonymized. Install it:
                          <div className="mt-1.5 flex gap-2">
                            {(["tor", "torsocks"] as const).map((pkg) => (
                              <form key={pkg} action={requestInstall}>
                                <input type="hidden" name="runnerId" value={r.id} />
                                <input type="hidden" name="tool" value={pkg} />
                                <input type="hidden" name="confirm" value="true" />
                                <button className="btn-ghost px-2 py-1 text-xs">Install {pkg}</button>
                              </form>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </details>
            );
          })}
        </div>
      )}

      <Link
        href="/dashboard/jobs"
        className="card-hover mt-6 flex items-center justify-between"
      >
        <span className="flex items-center gap-2 text-sm text-gray-300">
          <Icon name="bolt" className="h-4 w-4 text-brand" />
          Queue &amp; monitor jobs on these machines
        </span>
        <Icon name="arrow" className="h-4 w-4 text-gray-500" />
      </Link>
    </div>
  );
}
