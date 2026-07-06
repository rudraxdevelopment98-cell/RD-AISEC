import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { Workflow } from "@/components/workflow";
import { EngagementStatusBadge } from "@/components/badges";
import type { Pillar } from "@/data/portal";
import type { PillarEngagement } from "@/lib/pillars";

export function PillarView({
  pillar,
  engagements = [],
}: {
  pillar: Pillar;
  engagements?: PillarEngagement[];
}) {
  const openTotal = engagements.reduce((n, e) => n + e.open, 0);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={pillar.title} subtitle={pillar.tagline} />
      <header className="card relative mt-3 overflow-hidden">
        <div className={`pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl ring-${pillar.accent}`} />
        <div className="flex items-center gap-3">
          <span className={`flex h-12 w-12 items-center justify-center rounded-xl border ring-${pillar.accent} accent-${pillar.accent}`}>
            <Icon name={pillar.icon} className="h-6 w-6" />
          </span>
          <div>
            <div className="text-2xl font-bold text-gradient">{pillar.title}</div>
            <p className={`text-sm accent-${pillar.accent}`}>{pillar.tagline}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-400">{pillar.description}</p>

        {/* At-a-glance */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="tag">{engagements.length} engagement{engagements.length === 1 ? "" : "s"}</span>
          {openTotal > 0 && <span className="tag border-amber-500/40 text-amber-300">{openTotal} open finding{openTotal === 1 ? "" : "s"}</span>}
          <span className={`tag ring-${pillar.accent} accent-${pillar.accent}`}>{pillar.stages.length} workflow stages</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/engagements?type=${pillar.slug}`} className="btn-primary">
            <Icon name="briefcase" className="h-4 w-4" /> Start a {pillar.title} engagement
          </Link>
          <Link href="/dashboard/engagements" className="btn-ghost">All engagements</Link>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <Icon name="lock" className="h-4 w-4" />
          Authorized engagements only. Confirm scope and written permission before any testing.
        </p>
      </header>

      {/* Your engagements in this discipline — the real work, not a brochure. */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
          Your {pillar.title.toLowerCase()} engagements
        </h2>
        <Link href="/dashboard/engagements" className="text-xs text-brand hover:underline">All →</Link>
      </div>

      {engagements.length === 0 ? (
        <div className="card mt-3 flex flex-col items-center gap-2 py-8 text-center">
          <Icon name={pillar.icon} className={`h-7 w-7 accent-${pillar.accent}`} />
          <p className="text-sm text-gray-400">No {pillar.title.toLowerCase()} engagements yet.</p>
          <Link href={`/dashboard/engagements?type=${pillar.slug}`} className="btn-primary mt-1 text-sm">
            <Icon name="briefcase" className="h-4 w-4" /> Start your first one
          </Link>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {engagements.map((e) => (
            <Link
              key={e.id}
              href={`/dashboard/engagements/${e.id}`}
              className="card-hover flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-white">{e.name}</span>
                {e.client && <span className="text-xs text-gray-500">{e.client}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                {e.open > 0 && <span className="tag border-amber-500/40 text-amber-300">{e.open} open</span>}
                <span className="text-gray-500">{e.findings} finding{e.findings === 1 ? "" : "s"}</span>
                <EngagementStatusBadge value={e.status} />
                <Icon name="arrow" className="h-4 w-4 text-gray-500" />
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Tailored workflow for this discipline */}
      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-gray-500">
        {pillar.title} workflow · {pillar.stages.length} stages
      </h2>
      <Workflow stages={pillar.stages} engagements={engagements.map((e) => ({ id: e.id, name: e.name }))} />
    </div>
  );
}
