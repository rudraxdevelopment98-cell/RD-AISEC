import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { AutoRefresh } from "@/components/auto-refresh";
import { MachineStats } from "@/components/machine-stats";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { canAccess, isOwnerRole, type AccessInfo } from "@/lib/access";

// A member counts as "online" if they signed in within this window (we have no
// real presence channel, so last-login is the proxy).
const USER_ONLINE_MS = 15 * 60_000;

// The right-hand "Live ops" rail: at-a-glance situational awareness on every
// page — high-criticised work, machines, active jobs, and (for owners) the
// live team. Each block is gated by the viewer's access. Read-only; refreshes
// with the page.
export async function OpsRail({ info }: { info: AccessInfo }) {
  const showFindings = canAccess("/dashboard/findings", info);
  const showRunners = canAccess("/dashboard/runners", info);
  const showJobs = canAccess("/dashboard/jobs", info);
  const showTeam = isOwnerRole(info);

  const critical = showFindings
    ? await prisma.finding.findMany({
        where: { status: "open", severity: { in: ["critical", "high"] } },
        select: { id: true, title: true, severity: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];
  const runners = showRunners
    ? await prisma.runner.findMany({
        select: {
          id: true,
          name: true,
          lastSeenAt: true,
          cpuPct: true,
          memPct: true,
          memUsedMb: true,
          memTotalMb: true,
          diskUsedMb: true,
          diskTotalMb: true,
          tempC: true,
          loadAvg: true,
          cores: true,
          uptimeSec: true,
          gpuPct: true,
          batteryPct: true,
          charging: true,
          powerW: true,
          maxWorkers: true,
        },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : [];
  const activeJobs = showJobs
    ? await prisma.job.findMany({
        where: { status: { in: ["running", "queued"] } },
        select: { id: true, tool: true, target: true, status: true },
        orderBy: { createdAt: "desc" },
        take: 6,
      })
    : [];
  const team = showTeam
    ? await prisma.member.findMany({
        where: { status: "approved" },
        select: { id: true, name: true, email: true, lastLoginAt: true },
        orderBy: { lastLoginAt: "desc" },
        take: 6,
      })
    : [];

  const now = Date.now();
  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  ).length;
  const running = activeJobs.filter((j) => j.status === "running").length;
  const queued = activeJobs.filter((j) => j.status === "queued").length;
  const usersOnline = team.filter(
    (m) => m.lastLoginAt && now - new Date(m.lastLoginAt).getTime() < USER_ONLINE_MS,
  ).length;

  // Only poll while a job is actually running/queued — that's the only rail
  // state that changes on its own. A merely-connected idle runner is NOT a
  // reason to reload pages under the user. The rail lives on every page, so this
  // gate is what stops the "every page reloads after a few seconds" feeling.
  // (The component is also paused while the tab is hidden.)
  const anyLive = activeJobs.length > 0;

  return (
    <div className="space-y-5 text-sm">
      {/* Keep the rail live so counts (active jobs, online) update without a
          manual reload — but only while there's live work to watch. */}
      {anyLive && <AutoRefresh seconds={20} />}

      {/* Needs attention — high-criticised work */}
      {showFindings && (
        <section>
          <RailHeading icon="alert" label="Needs attention" href="/dashboard/findings?severity=critical">
            {critical.length ? `${critical.length} open` : "clear"}
          </RailHeading>
          {critical.length === 0 ? (
            <RailEmpty>No open critical / high findings.</RailEmpty>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {critical.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-xs">
                  <SeverityBadge value={f.severity} />
                  <span className="line-clamp-2 text-gray-300">{f.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Machines */}
      {showRunners && (
        <section>
          <RailHeading icon="server" label="Machines" href="/dashboard/runners">
            {online}/{runners.length} online
          </RailHeading>
          {runners.length === 0 ? (
            <RailEmpty>No machines registered.</RailEmpty>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {runners.map((r) => {
                const isOnline =
                  r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
                return (
                  <li key={r.id} className="text-xs text-gray-300">
                    <Link href={`/dashboard/runners/${r.id}`} className="flex items-center gap-2 hover:text-white">
                      <Dot on={!!isOnline} />
                      <span className="truncate">{r.name || "Runner"}</span>
                      <span className={`ml-auto text-[10px] ${isOnline ? "text-emerald-400" : "text-gray-600"}`}>
                        {isOnline ? "online" : "offline"}
                      </span>
                    </Link>
                    {isOnline && (
                      <div className="mt-1.5 rounded-lg border border-surface-border bg-black/20 px-2 py-1.5">
                        <MachineStats s={r} compact />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Active jobs */}
      {showJobs && (
        <section>
          <RailHeading icon="bolt" label="Active jobs" href="/dashboard/jobs">
            {running} running · {queued} queued
          </RailHeading>
          {activeJobs.length === 0 ? (
            <RailEmpty>Nothing running.</RailEmpty>
          ) : (
            <ul className="mt-2 space-y-1">
              {activeJobs.map((j) => (
                <li key={j.id} className="flex items-center gap-2 text-xs text-gray-300">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${j.status === "running" ? "animate-pulse bg-sky-400" : "bg-amber-400"}`}
                  />
                  <span className="font-mono">{j.tool}</span>
                  <span className="ml-auto truncate text-[10px] text-gray-500">{j.target}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Team — live users + recent logins (owners only) */}
      {showTeam && (
        <section>
          <RailHeading icon="bot" label="Team" href="/dashboard/members">
            {usersOnline} online
          </RailHeading>
          {team.length === 0 ? (
            <RailEmpty>No members yet.</RailEmpty>
          ) : (
            <ul className="mt-2 space-y-1">
              {team.map((m) => {
                const isOnline =
                  m.lastLoginAt && now - new Date(m.lastLoginAt).getTime() < USER_ONLINE_MS;
                return (
                  <li key={m.id} className="flex items-center gap-2 text-xs text-gray-300">
                    <Dot on={!!isOnline} />
                    <span className="truncate">{m.name || m.email}</span>
                    <span className="ml-auto text-[10px] text-gray-600">{ago(m.lastLoginAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {!showFindings && !showRunners && !showJobs && !showTeam && (
        <RailEmpty>No live-ops sections are available for your access.</RailEmpty>
      )}
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-emerald-400" : "bg-gray-600"}`}
    />
  );
}

function ago(d: Date | null): string {
  if (!d) return "never";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function RailHeading({
  icon,
  label,
  href,
  children,
}: {
  icon: string;
  label: string;
  href: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} className="h-3.5 w-3.5 text-brand" />
      <Link href={href} className="text-xs font-semibold text-gray-200 hover:text-brand">
        {label}
      </Link>
      {children && <span className="ml-auto text-[10px] text-gray-500">{children}</span>}
    </div>
  );
}

function RailEmpty({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] text-gray-600">{children}</p>;
}
