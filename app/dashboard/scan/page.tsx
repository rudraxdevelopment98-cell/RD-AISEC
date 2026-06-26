import Link from "next/link";
import { Scanner } from "@/components/scanner";
import { Icon } from "@/components/icons";
import { listEngagements } from "@/lib/engagements";
import { prisma } from "@/lib/db";
import {
  createSchedule,
  toggleSchedule,
  deleteSchedule,
  runScheduleNow,
} from "@/lib/scheduled-scans";
import { splitTargets, intervalMs } from "@/lib/scheduled-core";
import { MAX_BULK_TARGETS } from "@/lib/scanner";

export const dynamic = "force-dynamic";

function nextRun(s: { frequency: string; lastRunAt: Date | null }): string {
  if (!s.lastRunAt) return "on next cron run";
  const due = new Date(s.lastRunAt).getTime() + intervalMs(s.frequency);
  if (due <= Date.now()) return "due now";
  return new Date(due).toLocaleString();
}

export default async function ScanPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const [engagements, schedules] = await Promise.all([
    listEngagements(),
    prisma.scheduledScan.findMany({
      orderBy: { createdAt: "desc" },
      include: { engagement: { select: { id: true, name: true } } },
    }),
  ]);
  const engOptions = engagements.map((e) => ({ id: e.id, name: e.name }));

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Auto Scan</h1>
      <p className="mt-1 text-gray-400">
        Passive web posture check (HTTPS, security headers, cookie hardening) —
        no machine needed. Run one now, or schedule it to repeat and track
        posture over time. Every gap becomes a finding on the engagement.
      </p>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <Scanner engagements={engOptions} />

      {/* ── Scheduled scans ─────────────────────────────── */}
      <h2 className="mt-12 flex items-center gap-2 text-lg font-bold">
        <Icon name="clock" className="h-5 w-5 text-brand" />
        Scheduled scans
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        A daily Vercel cron runs each schedule whose interval has elapsed and
        saves new findings to its engagement (duplicates of still-open findings
        are skipped).
      </p>

      {engOptions.length === 0 ? (
        <p className="card mt-4 text-sm text-gray-500">
          Create an{" "}
          <Link href="/dashboard/engagements" className="text-brand hover:underline">
            engagement
          </Link>{" "}
          first — scheduled findings need somewhere to go.
        </p>
      ) : (
        <form action={createSchedule} className="card mt-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-400">
              Targets (one per line, up to {MAX_BULK_TARGETS})
            </label>
            <textarea
              name="targets"
              rows={3}
              required
              placeholder={"example.com\napp.example.com"}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-gray-400">Engagement</label>
              <select
                name="engagementId"
                required
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              >
                {engOptions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-400">Frequency</label>
              <select
                name="frequency"
                defaultValue="daily"
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>
          <button className="btn-primary text-sm">Schedule scan</button>
        </form>
      )}

      {schedules.length > 0 && (
        <div className="mt-4 space-y-3">
          {schedules.map((s) => {
            const targets = splitTargets(s.targets);
            return (
              <div key={s.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`tag capitalize ${
                          s.enabled
                            ? "ring-emerald accent-emerald"
                            : "border-gray-500/40 text-gray-400"
                        }`}
                      >
                        {s.enabled ? "● active" : "paused"}
                      </span>
                      <span className="tag capitalize">{s.frequency}</span>
                      <Link
                        href={`/dashboard/engagements/${s.engagementId}`}
                        className="text-sm text-gray-300 hover:text-brand"
                      >
                        {s.engagement?.name ?? "engagement"}
                      </Link>
                    </div>
                    <p className="mt-2 truncate font-mono text-xs text-gray-400">
                      {targets.join(", ")}
                    </p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-gray-500 sm:max-w-md">
                      <dt>Last run</dt>
                      <dd className="text-right text-gray-400">
                        {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : "never"}
                      </dd>
                      <dt>Next</dt>
                      <dd className="text-right text-gray-400">
                        {s.enabled ? nextRun(s) : "paused"}
                      </dd>
                    </dl>
                    {s.lastStatus && (
                      <p className="mt-2 text-xs text-gray-500">{s.lastStatus}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2 text-xs">
                    <form action={runScheduleNow}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-sky-400 hover:text-sky-300">Run now</button>
                    </form>
                    <form action={toggleSchedule}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-gray-400 hover:text-gray-200">
                        {s.enabled ? "Pause" : "Resume"}
                      </button>
                    </form>
                    <form action={deleteSchedule}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-gray-500 hover:text-red-400">Delete</button>
                    </form>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
