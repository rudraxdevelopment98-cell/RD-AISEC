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
  updateEngagementAuthorization,
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
import { ReconnaissanceScanner } from "@/components/reconnaissance-scanner";
import { createResource, deleteResource } from "@/lib/resources";
import { RESOURCE_TYPES } from "@/lib/resource-constants";

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

        {/* Authorization toggle form */}
        <form action={updateEngagementAuthorization} className="mt-4 flex items-center gap-3">
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
              className="rounded border border-gray-600 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-500"
            />
          )}
          <button type="submit" className="btn-ghost text-xs">
            Update
          </button>
        </form>
      </section>

      {/* Reconnaissance Scanner — for pentest engagements */}
      {e.type === "pentest" && e.authorized && (
        <section className="mt-6">
          <ReconnaissanceScanner engagementId={e.id} />
        </section>
      )}

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

      {/* Resources */}
      <h2 className="mt-10 text-lg font-semibold">
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
