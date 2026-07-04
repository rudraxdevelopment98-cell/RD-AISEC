import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { NavSelect } from "@/components/nav-select";
import { EmptyState } from "@/components/empty-state";
import { EngagementMap } from "@/components/engagement-map";
import { buildEngagementGraph } from "@/lib/engagement-graph";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";

export default async function EngagementMapPage({
  searchParams,
}: {
  searchParams: { e?: string };
}) {
  const engagements = await prisma.engagement.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });

  if (engagements.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Engagement Map" />
        <div className="mt-4">
          <EmptyState
            icon="globe"
            title="No engagements yet"
            actionHref="/dashboard/engagements"
            actionLabel="Create an engagement"
          >
            The map visualizes an engagement&apos;s whole picture — hosts, subdomains,
            services, findings, programs and collaborators — as a 3D galaxy.
          </EmptyState>
        </div>
      </div>
    );
  }

  const selectedId = searchParams.e && engagements.some((x) => x.id === searchParams.e)
    ? searchParams.e
    : engagements[0].id;

  const [eng, findings, jobs, programs] = await Promise.all([
    prisma.engagement.findUnique({ where: { id: selectedId } }),
    prisma.finding.findMany({
      where: { engagementId: selectedId },
      select: { id: true, title: true, severity: true, status: true, confirmed: true, description: true },
      take: 1000,
    }),
    prisma.job.findMany({
      where: { engagementId: selectedId },
      select: { tool: true, target: true, status: true, queuedBy: true },
      take: 500,
    }),
    prisma.bugProgram.findMany({ where: { engagementId: selectedId }, select: { id: true, name: true } }),
  ]);

  const graph = buildEngagementGraph({
    engagement: {
      id: eng!.id,
      name: eng!.name,
      client: eng!.client,
      type: eng!.type,
      status: eng!.status,
      scope: eng!.scope,
      ownerEmail: eng!.ownerEmail,
      sourceRepo: eng!.sourceRepo,
    },
    findings,
    jobs,
    programs,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Engagement Map"
        subtitle={
          <>
            The whole engagement as a 3D galaxy — hosts, subdomains, services,
            findings, programs and collaborators, linked and explorable. This is the
            engagement&apos;s picture; the{" "}
            <Link href="/dashboard/network" className="text-brand hover:underline">Network Map</Link>{" "}
            stays for live local-network scans.
          </>
        }
        actions={
          <NavSelect
            param="e"
            value={selectedId}
            label="Engagement"
            allLabel="Pick engagement"
            options={engagements.map((x) => ({ value: x.id, label: x.name }))}
          />
        }
      />

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span>{graph.nodes.length} nodes · {graph.edges.length} links</span>
        <Link href={`/dashboard/engagements/${selectedId}`} className="text-brand hover:underline">
          Open engagement <Icon name="arrow" className="inline h-3 w-3" />
        </Link>
      </div>

      <div className="mt-4">
        <EngagementMap graph={graph} engagementId={selectedId} />
      </div>
    </div>
  );
}
