import Link from "next/link";
import { Icon } from "@/components/icons";
import { EngagementStatusBadge } from "@/components/badges";
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
          <p className="card text-sm text-gray-500">
            No engagements yet. Create one above to get started.
          </p>
        )}
        {engagements.map((e) => (
          <Link
            key={e.id}
            href={`/dashboard/engagements/${e.id}`}
            className="card-hover flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-surface-border text-brand">
                <Icon name={TYPE_ICON[e.type] ?? "target"} className="h-5 w-5" />
              </span>
              <div>
                <p className="font-semibold text-white">{e.name}</p>
                <p className="text-xs text-gray-500">
                  {e.client || "—"} · {e._count.findings} finding
                  {e._count.findings === 1 ? "" : "s"}
                  {!e.authorized && (
                    <span className="ml-2 text-amber-400">⚠ unauthorized</span>
                  )}
                </p>
              </div>
            </div>
            <EngagementStatusBadge value={e.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}
