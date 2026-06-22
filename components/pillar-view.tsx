import Link from "next/link";
import { Icon } from "@/components/icons";
import { Workflow } from "@/components/workflow";
import type { Pillar } from "@/data/portal";

export function PillarView({ pillar }: { pillar: Pillar }) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="card relative overflow-hidden">
        <div className={`pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl ring-${pillar.accent}`} />
        <div className="flex items-center gap-3">
          <span className={`flex h-12 w-12 items-center justify-center rounded-xl border ring-${pillar.accent} accent-${pillar.accent}`}>
            <Icon name={pillar.icon} className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-gradient">{pillar.title}</h1>
            <p className={`text-sm accent-${pillar.accent}`}>{pillar.tagline}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-400">{pillar.description}</p>
        <p className="mt-4 flex items-center gap-2 text-xs text-gray-500">
          <Icon name="lock" className="h-4 w-4" />
          Authorized engagements only. Confirm scope and written permission
          before any testing.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link href="/dashboard/engagements" className="btn-ghost">
            <Icon name="briefcase" className="h-4 w-4" /> Track this in an engagement
          </Link>
          <span className={`tag ring-${pillar.accent} accent-${pillar.accent}`}>
            {pillar.stages.length} stages
          </span>
        </div>
      </header>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Workflow · {pillar.stages.length} stages
      </h2>
      <Workflow stages={pillar.stages} />
    </div>
  );
}
