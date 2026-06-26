import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { parseNmapNetwork } from "@/lib/network";
import { NetworkGraph } from "@/components/network-graph";
import { LocalScanForm } from "@/components/local-scan-form";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: { job?: string; error?: string; queued?: string };
}) {
  const [jobs, runnerRows, engagementRows] = await Promise.all([
    prisma.job.findMany({
      where: { tool: "nmap", status: "done" },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { engagement: { select: { name: true } } },
    }),
    prisma.runner.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.engagement.findMany({
      where: { authorized: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  const now = Date.now();
  const runners = runnerRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      online: !!r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS,
      subnets: (r.subnets ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    }))
    .filter((r) => r.subnets.length > 0);

  const selected = jobs.find((j) => j.id === searchParams.job) ?? jobs[0] ?? null;
  const hosts = selected ? parseNmapNetwork(selected.output) : [];
  const withPorts = hosts.filter((h) => h.ports.length > 0).length;
  const totalPorts = hosts.reduce((n, h) => n + h.ports.length, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-bold">Network map</h1>
      <p className="mt-1 text-gray-400">
        Visualize a network from an nmap scan run on your runner. Queue an{" "}
        <strong>nmap → Network discovery</strong> or <strong>Network scan</strong>{" "}
        against a CIDR (e.g. <code className="font-mono">10.0.0.0/24</code>), then
        view live hosts, open ports, and services here.
      </p>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" />
          {searchParams.error}
        </div>
      )}
      {searchParams.queued && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <Icon name="check" className="mr-1 inline h-4 w-4" />
          Scan queued — it&apos;ll appear below once the runner finishes (refresh
          in a bit).
        </div>
      )}

      {/* One-click: scan the runner's own network */}
      <div className="mt-6">
        <LocalScanForm runners={runners} engagements={engagementRows} />
      </div>

      {jobs.length === 0 ? (
        <div className="card mt-6 text-center">
          <p className="text-gray-400">
            No nmap scans yet. Run one from{" "}
            <Link href="/dashboard/runners" className="text-brand hover:underline">
              Runners
            </Link>{" "}
            — pick <strong>nmap</strong>, the <strong>Network discovery</strong> or{" "}
            <strong>Network scan</strong> preset, and a CIDR target.
          </p>
        </div>
      ) : (
        <>
          {/* Scan selector */}
          <div className="mt-6 flex flex-wrap gap-2">
            {jobs.map((j) => {
              const active = selected?.id === j.id;
              return (
                <Link
                  key={j.id}
                  href={`/dashboard/network?job=${j.id}`}
                  className={`rounded-lg border px-3 py-2 text-xs transition ${
                    active
                      ? "border-brand bg-brand/10 text-white"
                      : "border-surface-border text-gray-400 hover:border-brand"
                  }`}
                >
                  <span className="font-mono">{j.target}</span>
                  <span className="ml-2 text-gray-500">
                    {j.engagement?.name ?? "—"} · {new Date(j.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* Summary */}
          <section className="mt-6 grid grid-cols-3 gap-4">
            <Stat value={hosts.length} label="hosts up" />
            <Stat value={withPorts} label="with open ports" accent="text-emerald-300" />
            <Stat value={totalPorts} label="open ports" accent="text-amber-300" />
          </section>

          {hosts.length === 0 ? (
            <div className="card mt-6 text-sm text-gray-500">
              This scan didn&apos;t report any live hosts. For a range, use the{" "}
              <strong>Network discovery</strong> (ping sweep) or{" "}
              <strong>Network scan</strong> preset against a CIDR.
            </div>
          ) : (
            <div className="mt-6">
              <NetworkGraph hosts={hosts} subnet={selected?.target ?? ""} />
            </div>
          )}

          <p className="mt-4 text-xs text-gray-500">
            <Icon name="bolt" className="mr-1 inline h-3 w-3" />
            Tip: open ports here can be imported as findings from the job on the{" "}
            <Link href="/dashboard/runners" className="text-brand hover:underline">
              Runners
            </Link>{" "}
            page (&ldquo;Import to findings&rdquo;).
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  value,
  label,
  accent,
}: {
  value: number;
  label: string;
  accent?: string;
}) {
  return (
    <div className="card">
      <p className={`text-3xl font-bold ${accent ?? "text-brand"}`}>{value}</p>
      <p className="mt-1 text-sm text-gray-400">{label}</p>
    </div>
  );
}
