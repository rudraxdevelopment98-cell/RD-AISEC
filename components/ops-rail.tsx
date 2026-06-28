import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { SeverityBadge } from "@/components/badges";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { canAccess, type AccessInfo } from "@/lib/access";

// The right-hand "Live ops" rail: at-a-glance situational awareness shown on
// every dashboard page (machine status · active jobs · latest findings). Each
// block is gated by the viewer's access, so people only see what they can open.
// Read-only; refreshes when the page does.
export async function OpsRail({ info }: { info: AccessInfo }) {
  const showRunners = canAccess("/dashboard/runners", info);
  const showJobs = canAccess("/dashboard/jobs", info);
  const showFindings = canAccess("/dashboard/findings", info);

  const runners = showRunners
    ? await prisma.runner.findMany({
        select: { id: true, name: true, lastSeenAt: true },
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
  const findings = showFindings
    ? await prisma.finding.findMany({
        select: { id: true, title: true, severity: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      })
    : [];

  const now = Date.now();
  const online = runners.filter(
    (r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
  ).length;
  const running = activeJobs.filter((j) => j.status === "running").length;
  const queued = activeJobs.filter((j) => j.status === "queued").length;

  return (
    <div className="space-y-5 text-sm">
      {/* Machines */}
      {showRunners && (
        <section>
          <RailHeading icon="server" label="Machines" href="/dashboard/runners">
            {online}/{runners.length} online
          </RailHeading>
          {runners.length === 0 ? (
            <RailEmpty>No machines registered.</RailEmpty>
          ) : (
            <ul className="mt-2 space-y-1">
              {runners.map((r) => {
                const isOnline =
                  r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
                return (
                  <li key={r.id} className="flex items-center gap-2 text-xs text-gray-300">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOnline ? "bg-emerald-400" : "bg-gray-600"}`}
                    />
                    <span className="truncate">{r.name || "Runner"}</span>
                    <span className={`ml-auto text-[10px] ${isOnline ? "text-emerald-400" : "text-gray-600"}`}>
                      {isOnline ? "online" : "offline"}
                    </span>
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
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${j.status === "running" ? "bg-sky-400 animate-pulse" : "bg-amber-400"}`}
                  />
                  <span className="font-mono">{j.tool}</span>
                  <span className="ml-auto truncate text-[10px] text-gray-500">{j.target}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Latest findings */}
      {showFindings && (
        <section>
          <RailHeading icon="alert" label="Latest findings" href="/dashboard/findings" />
          {findings.length === 0 ? (
            <RailEmpty>No findings yet.</RailEmpty>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {findings.map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-xs">
                  <SeverityBadge value={f.severity} />
                  <span className="line-clamp-2 text-gray-300">{f.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!showRunners && !showJobs && !showFindings && (
        <RailEmpty>No live-ops sections are available for your access.</RailEmpty>
      )}
    </div>
  );
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
