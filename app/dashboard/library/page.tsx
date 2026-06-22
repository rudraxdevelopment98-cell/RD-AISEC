import { prisma } from "@/lib/db";
import { createResource } from "@/lib/resources";
import { RESOURCE_TYPES } from "@/lib/resource-constants";
import { ResourceList, type ResourceItem } from "@/components/resource-list";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const [rows, engagements] = await Promise.all([
    prisma.resource.findMany({
      orderBy: { createdAt: "desc" },
      include: { engagement: { select: { name: true } } },
    }),
    prisma.engagement.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  const resources: ResourceItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    url: r.url,
    location: r.location,
    tags: r.tags,
    notes: r.notes,
    engagementName: r.engagement?.name ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Resource Vault</h1>
      <p className="mt-1 text-gray-400">
        Your catalog of cybersecurity resources — links, books, exploits, tools,
        and cheatsheets. Big files stay offline on your drive; the vault stores
        the index and a drive location, so you find it here and open it from your
        external drive.
      </p>

      {/* Add resource */}
      <details className="card mt-6">
        <summary className="cursor-pointer font-semibold text-brand">
          + Add resource
        </summary>
        <form action={createResource} className="mt-4 grid gap-3 sm:grid-cols-2">
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
          <select
            name="engagementId"
            defaultValue=""
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">No engagement (global)</option>
            {engagements.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <input
            name="url"
            placeholder="Online link (https://…) — optional"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <input
            name="location"
            placeholder="Offline drive location — e.g. SSD:/Books/nmap-guide.pdf"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <input
            name="tags"
            placeholder="Tags (comma-separated) — e.g. recon, nmap, web"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <textarea
            name="notes"
            rows={2}
            placeholder="Notes — what it's for, why it's useful"
            className="rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:col-span-2"
          />
          <button type="submit" className="btn-primary sm:col-span-2">
            Add to vault
          </button>
        </form>
      </details>

      <ResourceList resources={resources} />
    </div>
  );
}
