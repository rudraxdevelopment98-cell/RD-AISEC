import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { AutoRefresh } from "@/components/auto-refresh";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { MachineConsole } from "@/components/machine-console";
import { MachineStats } from "@/components/machine-stats";
import { turboWorkers } from "@/lib/stats-format";
import {
  deleteRunner,
  setRunnerAnonymity,
  setRunnerWorkers,
  restartRunner,
  renameRunner,
  requestInstall,
} from "@/lib/runners";
import {
  RUNNER_ONLINE_WINDOW_MS,
  RUNNER_VERSION,
  RUNNER_TOOLS,
  installableTools,
  installLabel,
} from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  done: "text-emerald-300",
  running: "text-sky-300",
  queued: "text-amber-300",
  failed: "text-red-300",
  canceled: "text-gray-400",
};

export default async function MachinePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string; queued?: string };
}) {
  const r = await prisma.runner.findUnique({
    where: { id: params.id },
    include: {
      installs: { orderBy: { createdAt: "desc" }, take: 10 },
      jobs: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });
  if (!r) notFound();

  const now = Date.now();
  const online = !!r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
  const installedSet = new Set(
    (r.installed ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const installable = installableTools();
  const missing = installable.filter((t) => !installedSet.has(t));
  const outdated = !!r.version && r.version !== RUNNER_VERSION;

  // Why an outdated runner hasn't self-updated: it only updates while idle, so a
  // busy machine with a backlog stays on the old version. Surface that + a rough
  // ETA to clear the queue.
  const [runningCount, queuedCount, recentDone] = await Promise.all([
    prisma.job.count({ where: { runnerId: r.id, status: "running" } }),
    prisma.job.count({ where: { runnerId: r.id, status: "queued" } }),
    prisma.job.findMany({
      where: { runnerId: r.id, status: { in: ["done", "failed"] }, startedAt: { not: null }, finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      take: 20,
      select: { startedAt: true, finishedAt: true },
    }),
  ]);
  const busy = runningCount > 0 || queuedCount > 0;
  const durs = recentDone
    .map((j) => (new Date(j.finishedAt!).getTime() - new Date(j.startedAt!).getTime()) / 1000)
    .filter((s) => s > 0 && s < 3600);
  const avgSec = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 90;
  const etaSec = Math.round((queuedCount / Math.max(1, r.maxWorkers)) * avgSec + runningCount * avgSec * 0.5);
  const etaText = etaSec < 60 ? `~${etaSec}s` : etaSec < 3600 ? `~${Math.round(etaSec / 60)}m` : `~${Math.floor(etaSec / 3600)}h ${Math.round((etaSec % 3600) / 60)}m`;

  const activeInstalls = r.installs.filter((i) => i.status === "pending" || i.status === "installing");
  const subnets = (r.subnets ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const wifi = (r.wifi ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // All catalog tools with their state for this machine.
  const toolRows = RUNNER_TOOLS.map((t) => ({
    id: t.id,
    label: t.label,
    installed: installedSet.has(t.id),
    installable: installable.includes(t.id),
  }));
  const installedCount = toolRows.filter((t) => t.installed).length;

  return (
    <div className="mx-auto max-w-4xl">
      {(online || activeInstalls.length > 0) && <AutoRefresh seconds={10} />}
      <Breadcrumbs
        items={[
          { label: "Machines", href: "/dashboard/runners" },
          { label: r.name },
        ]}
      />

      {/* ── Header ───────────────────────────────────────── */}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Icon name="server" className="h-6 w-6 shrink-0 text-brand" />
            <span className="truncate">{r.name}</span>
            <span
              className={`tag shrink-0 ${online ? "ring-emerald accent-emerald" : "border-gray-500/40 text-gray-400"}`}
            >
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-gray-500"}`} />
              {online ? "online" : "offline"}
            </span>
          </span>
        }
        subtitle={
          r.lastSeenAt
            ? `Last seen ${new Date(r.lastSeenAt).toLocaleString()}`
            : "Never connected — run the agent on the machine with its token."
        }
        actions={
          <form action={deleteRunner}>
            <input type="hidden" name="id" value={r.id} />
            <button className="text-xs text-gray-600 hover:text-red-400">Revoke machine</button>
          </form>
        }
      />

      {searchParams.queued && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">
          ✓ Command queued — watch it under Recent jobs below.
        </div>
      )}
      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      {/* ── Update status ────────────────────────────────── */}
      {outdated && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-semibold">
            <Icon name="alert" className="mr-1 inline h-4 w-4" />
            Runner update available — v{r.version} → v{RUNNER_VERSION}
          </p>
          {busy ? (
            <p className="mt-1 text-amber-200/90">
              This machine only self-updates while <b>idle</b>, and right now it&apos;s running{" "}
              {runningCount} job{runningCount === 1 ? "" : "s"}
              {queuedCount > 0 ? ` with ${queuedCount} queued (${etaText} to clear)` : ""} — so it hasn&apos;t
              updated yet. <b>Restart the runner</b> to update immediately, or use <b>⚡ Turbo</b> below to
              drain the queue faster.
            </p>
          ) : (
            <p className="mt-1 text-amber-200/90">
              It&apos;s idle now, so it should self-update within a few minutes — or restart it to update right away.
            </p>
          )}
          <p className="mt-1 text-[11px] text-amber-200/60">
            Updates jump straight to the latest (v{RUNNER_VERSION}) — intermediate versions are skipped.
          </p>
          <form action={restartRunner} className="mt-2">
            <input type="hidden" name="id" value={r.id} />
            <button
              className="btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
              disabled={!online}
              title={online ? "Restart the machine and update to the latest version" : "Machine is offline"}
            >
              ↻ Restart &amp; update now
            </button>
          </form>
        </div>
      )}

      {/* ── System info ──────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tools installed" value={`${installedCount}`} sub={`of ${toolRows.length}`} />
        <Stat label="Parallel jobs" value={`${r.maxWorkers}×`} />
        <Stat
          label="Runner version"
          value={r.version ? `v${r.version}` : "—"}
          sub={outdated ? "updates when idle · restart to update now" : online ? "latest" : ""}
          warn={outdated}
        />
        <Stat
          label="Anonymity"
          value={r.anonymity ? "Tor on" : "off"}
          sub={r.anonymity ? (r.exitIp ? r.exitIp : r.anonStatus || "connecting…") : ""}
        />
      </div>

      {/* ── Live resources ───────────────────────────────── */}
      <div className="card mt-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">
            <Icon name="chart" className="mr-1 inline h-4 w-4 text-brand" /> Live resources
          </p>
          <span className={`text-[10px] ${online ? "text-emerald-400" : "text-gray-600"}`}>
            {online ? "live · refreshes on reload" : "offline"}
          </span>
        </div>
        <div className="mt-3">
          <MachineStats s={r} />
        </div>
      </div>

      {(subnets.length > 0 || wifi.length > 0) && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {subnets.length > 0 && (
            <div className="card">
              <p className="text-xs font-semibold text-gray-400">
                <Icon name="globe" className="mr-1 inline h-3.5 w-3.5" /> Local subnets
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {subnets.map((s) => (
                  <span key={s} className="tag font-mono text-[11px]">{s}</span>
                ))}
              </div>
            </div>
          )}
          {wifi.length > 0 && (
            <div className="card">
              <p className="text-xs font-semibold text-gray-400">
                📶 Wireless interfaces {r.wifiMonitor && <span className="text-emerald-300">· monitor-capable</span>}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {wifi.map((w) => (
                  <span key={w} className="tag font-mono text-[11px]">{w}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Settings ─────────────────────────────────────── */}
      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <Icon name="wrench" className="h-4 w-4 text-brand" /> Settings
      </h2>
      <div className="mt-3 space-y-3">
        {/* Rename */}
        <form action={renameRunner} className="card flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="back" value={`/dashboard/runners/${r.id}`} />
          <label className="text-xs font-semibold text-gray-400">Name</label>
          <input
            name="name"
            defaultValue={r.name}
            className="min-w-[12rem] flex-1 rounded-md border border-surface-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button className="btn-ghost px-3 py-1.5 text-xs">Rename</button>
        </form>

        {/* Parallelism */}
        <form action={setRunnerWorkers} className="card flex flex-wrap items-center gap-2 text-sm text-gray-400">
          <input type="hidden" name="id" value={r.id} />
          <label htmlFor="workers" className="text-xs font-semibold">⚙ Run</label>
          <select
            id="workers"
            name="workers"
            defaultValue={String(r.maxWorkers)}
            className="rounded-md border border-surface-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>job(s) in parallel</span>
          <button className="btn-ghost px-3 py-1.5 text-xs">Apply</button>
        </form>

        {/* Turbo — one-click high parallelism to drain a job backlog */}
        <div className="card flex flex-wrap items-center gap-2 text-sm text-gray-400">
          <span className="text-xs font-semibold">⚡ Turbo</span>
          <form action={setRunnerWorkers}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="workers" value={turboWorkers(r.cores)} />
            <button className="btn-primary px-3 py-1.5 text-xs">⚡ Turbo ({turboWorkers(r.cores)}× parallel)</button>
          </form>
          <form action={setRunnerWorkers}>
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="workers" value="3" />
            <button className="btn-ghost px-3 py-1.5 text-xs">Normal (3×)</button>
          </form>
          <span className="text-[11px] text-gray-500">
            Runs many more jobs at once — drains a big queue fast when the machine has spare CPU.
          </span>
        </div>

        {/* Restart — remote reboot of the runner (also self-updates on startup) */}
        <div className="card flex flex-wrap items-center gap-2 text-sm text-gray-400">
          <span className="text-xs font-semibold">↻ Restart</span>
          <form action={restartRunner}>
            <input type="hidden" name="id" value={r.id} />
            <button className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50" disabled={!online}>
              Restart machine
            </button>
          </form>
          <span className="text-[11px] text-gray-500">
            Reboots the runner from here on its next check-in (~seconds){outdated ? " — and updates to the latest version" : ""}. Any in-flight jobs re-queue.
          </span>
        </div>

        {/* Anonymity */}
        <div className="card flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-gray-300">
            🧅 Route tool traffic through Tor
            {r.anonymity && r.anonStatus === "no-tor" && (
              <span className="ml-2 text-xs text-red-300">Tor isn&apos;t installed</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {r.anonymity && r.anonStatus === "no-tor" &&
              (["tor", "torsocks"] as const).map((pkg) => (
                <form key={pkg} action={requestInstall}>
                  <input type="hidden" name="runnerId" value={r.id} />
                  <input type="hidden" name="tool" value={pkg} />
                  <input type="hidden" name="confirm" value="true" />
                  <button className="btn-ghost px-2 py-1 text-xs">Install {pkg}</button>
                </form>
              ))}
            <form action={setRunnerAnonymity}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="on" value={(!r.anonymity).toString()} />
              <button
                className={`text-xs ${r.anonymity ? "text-violet-300 hover:text-violet-200" : "text-gray-500 hover:text-violet-300"}`}
              >
                {r.anonymity ? "Turn off" : "Turn on"}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── Command console ──────────────────────────────── */}
      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <Icon name="bolt" className="h-4 w-4 text-brand" /> Run a command
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        A full console for this machine — run any command, or tap a quick command
        to check the box and its tools.
      </p>
      <div className="card mt-3">
        <MachineConsole runnerId={r.id} online={online} />
      </div>

      {/* ── Tools ────────────────────────────────────────── */}
      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <Icon name="wrench" className="h-4 w-4 text-brand" /> Tools
        <span className="text-sm font-normal text-gray-500">
          {installedCount}/{toolRows.length} installed
        </span>
      </h2>

      {missing.length > 0 && (
        <form action={requestInstall} className="card mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="runnerId" value={r.id} />
          <div className="flex-1">
            <label className="text-xs font-semibold text-gray-400">Install a missing tool</label>
            <select
              name="tool"
              className="mt-1 w-full rounded-md border border-surface-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
            >
              {missing.map((t) => (
                <option key={t} value={t}>{t} → {installLabel(t)}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" name="confirm" value="true" required className="h-3.5 w-3.5 accent-emerald-500" />
            I authorize this install
          </label>
          <button className="btn-primary px-3 py-1.5 text-sm">Install</button>
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {toolRows.map((t) => (
          <span
            key={t.id}
            title={t.label}
            className={`tag ${
              t.installed
                ? "ring-emerald accent-emerald"
                : t.installable
                  ? "border-amber-500/30 text-amber-300/80"
                  : "border-gray-600/30 text-gray-500"
            }`}
          >
            {t.installed ? "✓" : t.installable ? "＋" : "·"} {t.id}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-600">
        <span className="text-emerald-300">✓ installed</span> ·{" "}
        <span className="text-amber-300/80">＋ installable (one-click above)</span> ·{" "}
        <span className="text-gray-500">· not auto-installable</span>. Installs use
        apt or <code className="font-mono">go install</code>; the runner also
        self-heals missing tools when a job needs one.
      </p>

      {/* Live install output */}
      {r.installs.length > 0 && (
        <div className="mt-4 space-y-2">
          {r.installs.slice(0, 5).map((ins) => (
            <details key={ins.id} className="card" open={ins.status === "installing"}>
              <summary className="flex cursor-pointer items-center gap-2 text-sm">
                <span className="font-mono text-gray-300">{ins.tool}</span>
                <span className={STATUS_COLOR[ins.status] ?? "text-gray-400"}>{ins.status}</span>
              </summary>
              {ins.output && (
                <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-surface-border bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-gray-300">
                  {ins.output}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}

      {/* ── Recent jobs ──────────────────────────────────── */}
      <h2 className="mt-8 flex items-center gap-2 text-lg font-semibold">
        <Icon name="bolt" className="h-4 w-4 text-brand" /> Recent jobs
      </h2>
      {r.jobs.length === 0 ? (
        <p className="card mt-3 text-sm text-gray-500">No jobs have run on this machine yet.</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {r.jobs.map((j) => (
            <Link
              key={j.id}
              href={`/dashboard/jobs?job=${j.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-card/30 px-3 py-2 text-sm hover:border-brand"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="font-mono text-xs text-brand">{j.tool}</span>
                <span className="truncate text-gray-400">{j.target}</span>
              </span>
              <span className={`shrink-0 text-xs ${STATUS_COLOR[j.status] ?? "text-gray-400"}`}>
                {j.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${warn ? "text-amber-300" : "text-white"}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
    </div>
  );
}
