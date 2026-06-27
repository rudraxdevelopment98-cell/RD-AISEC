import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { prisma } from "@/lib/db";
import { updateEngagement, deleteEngagement } from "@/lib/engagements";
import { ENGAGEMENT_TYPES, ENGAGEMENT_STATUSES } from "@/lib/engagement-constants";

export const dynamic = "force-dynamic";

export default async function EditEngagementPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const e = await prisma.engagement.findUnique({ where: { id: params.id } });
  if (!e) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/dashboard/engagements/${e.id}`}
        className="text-sm text-gray-500 hover:text-brand"
      >
        ← Back to engagement
      </Link>

      <h1 className="mt-2 text-2xl font-bold">Edit engagement</h1>
      <p className="mt-1 text-gray-400">
        Update the scope, authorization, type, and status.
      </p>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}

      <form action={updateEngagement} className="card mt-6 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={e.id} />

        <label className="sm:col-span-2">
          <span className="text-sm font-medium text-gray-300">Name *</span>
          <input
            name="name"
            required
            defaultValue={e.name}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label>
          <span className="text-sm font-medium text-gray-300">Client / org</span>
          <input
            name="client"
            defaultValue={e.client}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label>
          <span className="text-sm font-medium text-gray-300">Type</span>
          <select
            name="type"
            defaultValue={e.type}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {ENGAGEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="sm:col-span-2">
          <span className="text-sm font-medium text-gray-300">Category</span>
          <input
            name="category"
            defaultValue={e.category}
            placeholder="e.g. HackerOne, manual, internal"
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label className="sm:col-span-2">
          <span className="text-sm font-medium text-gray-300">Status</span>
          <select
            name="status"
            defaultValue={e.status}
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm capitalize outline-none focus:border-brand"
          >
            {ENGAGEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="sm:col-span-2">
          <span className="text-sm font-medium text-gray-300">Scope</span>
          <textarea
            name="scope"
            rows={5}
            defaultValue={e.scope}
            placeholder="Targets, IP ranges/CIDRs, domains, time windows, rules of engagement…"
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <span className="mt-1 block text-xs text-gray-500">
            Targets must appear here for scanning to be allowed (the scope gate).
          </span>
        </label>

        <label className="sm:col-span-2">
          <span className="text-sm font-medium text-gray-300">Authorized by</span>
          <input
            name="authorizedBy"
            defaultValue={e.authorizedBy}
            placeholder="Name / signed-off contact"
            className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2">
          <input
            name="authorized"
            type="checkbox"
            defaultChecked={e.authorized}
            className="h-4 w-4 accent-emerald-500"
          />
          Written authorization obtained
        </label>

        <button type="submit" className="btn-primary sm:col-span-2">
          Save changes
        </button>
      </form>

      {/* Danger zone */}
      <div className="card mt-6 border-red-500/30">
        <h2 className="font-semibold text-red-300">Delete engagement</h2>
        <p className="mt-1 text-sm text-gray-400">
          Permanently deletes this engagement and its findings. This can&apos;t be
          undone.
        </p>
        <form action={deleteEngagement} className="mt-3">
          <input type="hidden" name="id" value={e.id} />
          <button className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">
            Delete this engagement
          </button>
        </form>
      </div>
    </div>
  );
}
