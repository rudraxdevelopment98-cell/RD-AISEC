import Link from "next/link";
import { Icon } from "@/components/icons";
import { EngagementStatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { listEngagements, createEngagement } from "@/lib/engagements";
import { ENGAGEMENT_TYPES } from "@/lib/engagement-constants";

export const dynamic = "force-dynamic";

const TYPE_ICON: Record<string, string> = {
  pentest: "target",
  forensics: "fingerprint",
  consulting: "briefcase",
};

export default async function EngagementsPage() {
  const engagements = await listEngagements();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Engagements</h1>
          <p className="mt-1 text-gray-400">
            Cases for pentests, forensics, and consulting — scope, findings, and
            status in one place.
          </p>
        </div>
      </div>

      {/* Create */}
      <details className="card mt-6">
        <summary className="cursor-pointer font-semibold text-brand">
          + New engagement
        </summary>
        <form action={createEngagement} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            name="name"
            required
            placeholder="Engagement name *"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <input
            name="client"
            placeholder="Client / org"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <select
            name="type"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {ENGAGEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <textarea
            name="scope"
            placeholder="Scope — targets, windows, rules of engagement"
            rows={2}
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <input
            name="authorizedBy"
            placeholder="Authorized by (name / signed-off contact)"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input name="authorized" type="checkbox" className="h-4 w-4 accent-emerald-500" />
            Written authorization obtained
          </label>
          <button type="submit" className="btn-primary sm:col-span-2">
            Create engagement
          </button>
        </form>
      </details>

      {/* List */}
      <div className="mt-6 space-y-3">
        {engagements.length === 0 && (
          <EmptyState icon="briefcase" title="No engagements yet">
            Create your first engagement above — a pentest, forensics case, or
            consulting job. Findings, scans, and reports all live inside one.
          </EmptyState>
        )}
        {engagements.map((e) => (
          <div
            key={e.id}
            className="card-hover flex items-center justify-between gap-4"
          >
            <Link
              href={`/dashboard/engagements/${e.id}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-surface-border text-brand">
                <Icon name={TYPE_ICON[e.type] ?? "target"} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{e.name}</p>
                <p className="truncate text-xs text-gray-500">
                  <span className="capitalize">{e.type}</span> · {e.client || "—"} ·{" "}
                  {e._count.findings} finding{e._count.findings === 1 ? "" : "s"}
                  {!e.authorized && (
                    <span className="ml-2 text-amber-400">⚠ unauthorized</span>
                  )}
                </p>
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-3">
              <EngagementStatusBadge value={e.status} />
              <Link
                href={`/dashboard/engagements/${e.id}/edit`}
                className="text-xs text-gray-500 hover:text-brand"
                title="Edit engagement"
              >
                Edit
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
