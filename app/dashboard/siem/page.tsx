import { auth, isOwnerEmail } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { EmptyState } from "@/components/empty-state";
import { NavSelect } from "@/components/nav-select";

export const dynamic = "force-dynamic";

type SP = {
  type?: string;
  actor?: string;
  severity?: string;
  since?: string;
};

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

const SEV_STYLE: Record<string, string> = {
  critical: "text-fuchsia-300",
  high: "text-red-300",
  medium: "text-amber-300",
  low: "text-sky-300",
  info: "text-gray-400",
};

function ago(d: Date): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function SiemPage({ searchParams }: { searchParams: SP }) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  if (!isOwnerEmail(email)) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-2xl font-bold">SIEM · Activity</h1>
        <p className="mt-3 card text-sm text-gray-400">
          Only an owner can view the activity log.
        </p>
      </div>
    );
  }

  const sp = searchParams;
  const where: Record<string, unknown> = {};
  if (sp.type) where.type = sp.type;
  if (sp.actor) where.actor = sp.actor;
  if (sp.severity) where.severity = sp.severity;
  if (sp.since && SINCE_MS[sp.since]) {
    where.createdAt = { gte: new Date(Date.now() - SINCE_MS[sp.since]) };
  }

  const [events, types, actors] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.auditEvent.groupBy({ by: ["type"], _count: true }),
    prisma.auditEvent.groupBy({ by: ["actor"], _count: true }),
  ]);

  const typeOptions = types
    .map((t) => t.type)
    .filter(Boolean)
    .sort()
    .map((t) => ({ value: t, label: t }));
  const actorOptions = actors
    .map((a) => a.actor)
    .filter(Boolean)
    .sort()
    .map((a) => ({ value: a, label: a }));
  const anyFilter = !!(sp.type || sp.actor || sp.severity || sp.since);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="SIEM · Activity"
        subtitle="A timeline of security-relevant events — sign-ins, sign-outs, and (as they are wired in) jobs, findings and exports."
      />

      <HelpBanner>
        <p>• Filter by event type, who did it, severity, or time window.</p>
        <p>• Append-only audit trail — events are never edited or deleted here.</p>
      </HelpBanner>

      {/* Filter bar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {typeOptions.length > 0 && (
          <NavSelect param="type" value={sp.type} label="Type" allLabel="All types" options={typeOptions} />
        )}
        {actorOptions.length > 0 && (
          <NavSelect param="actor" value={sp.actor} label="Actor" allLabel="Anyone" options={actorOptions} />
        )}
        <NavSelect
          param="severity"
          value={sp.severity}
          label="Severity"
          allLabel="Any severity"
          options={["critical", "high", "medium", "low", "info"].map((s) => ({ value: s, label: s }))}
        />
        <NavSelect param="since" value={sp.since} label="When" allLabel="Any time" options={SINCE_OPTIONS} />
      </div>

      <p className="mt-3 text-sm text-gray-400">
        {events.length} event{events.length === 1 ? "" : "s"}
        {anyFilter && " match your filters"}
        {events.length === 300 && " (showing latest 300)"}
      </p>

      {events.length === 0 ? (
        <div className="mt-4">
          <EmptyState icon="clock" title="No activity yet">
            Events appear here as people sign in and work runs.
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 overflow-hidden rounded-lg border border-surface-border">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-3 border-b border-surface-border px-3 py-2.5 text-sm last:border-0 hover:bg-surface-card/30"
            >
              <span className={`shrink-0 font-mono text-xs ${SEV_STYLE[e.severity] ?? SEV_STYLE.info}`}>
                {e.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-300">
                {e.summary || "—"}
                {e.target && <span className="text-gray-500"> · {e.target}</span>}
              </span>
              <span className="shrink-0 text-xs text-gray-500">{e.actor || "system"}</span>
              <span className="shrink-0 text-xs text-gray-600" title={new Date(e.createdAt).toLocaleString()}>
                {ago(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
