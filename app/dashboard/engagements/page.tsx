import { Icon } from "@/components/icons";
import { listEngagements, createEngagement } from "@/lib/engagements";
import { ENGAGEMENT_TYPES } from "@/lib/engagement-constants";
import { EngagementsManager } from "@/components/engagements-manager";

export const dynamic = "force-dynamic";

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
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

      {searchParams.ok && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          ✓ {searchParams.ok}
        </div>
      )}

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
          <input
            name="category"
            placeholder="Category (e.g. HackerOne, manual, internal)"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
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

      {/* List + management bar */}
      <div className="mt-6">
        <EngagementsManager
          engagements={engagements.map((e) => ({
            id: e.id,
            name: e.name,
            client: e.client,
            type: e.type,
            status: e.status,
            category: e.category,
            scope: e.scope,
            authorized: e.authorized,
            findingCount: e._count.findings,
          }))}
        />
      </div>
    </div>
  );
}
