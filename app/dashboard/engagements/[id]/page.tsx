import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  SeverityBadge,
  FindingStatusBadge,
  EngagementStatusBadge,
} from "@/components/badges";
import {
  getEngagement,
  updateEngagementStatus,
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

export const dynamic = "force-dynamic";

export default async function EngagementDetail({
  params,
}: {
  params: { id: string };
}) {
  const e = await getEngagement(params.id);
  if (!e) notFound();

  const openCount = e.findings.filter((f) => f.status === "open").length;
  const pillar = getPillar(e.type);

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/dashboard/engagements"
        className="text-sm text-gray-500 hover:text-brand"
      >
        ← All engagements
      </Link>

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
      </section>

      {/* Findings */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Findings{" "}
          <span className="text-sm font-normal text-gray-500">
            ({e.findings.length} total · {openCount} open)
          </span>
        </h2>
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
          <div key={f.id} className="card">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-white">{f.title}</h3>
              <div className="flex shrink-0 items-center gap-2">
                <SeverityBadge value={f.severity} />
                <FindingStatusBadge value={f.status} />
              </div>
            </div>
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
