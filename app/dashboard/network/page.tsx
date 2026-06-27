import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { parseNmapNetwork, mergeNetworkHosts } from "@/lib/network";
import { NetworkGraph } from "@/components/network-graph";
import { LocalScanForm } from "@/components/local-scan-form";
import { ScanSelect } from "@/components/scan-select";
import { HelpBanner } from "@/components/hint";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

export default async function NetworkPage({
  searchParams,
}: {
  searchParams: { job?: string; error?: string; queued?: string; engagement?: string };
}) {
  const engId = searchParams.engagement || "";
  const [jobs, runnerRows, engagementRows, engJobs] = await Promise.all([
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
    // All nmap scans for the chosen engagement (for the merged, full-engagement map).
    engId
      ? prisma.job.findMany({
          where: { engagementId: engId, tool: "nmap", status: "done" },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { id: true, output: true, target: true },
        })
      : Promise.resolve([] as { id: string; output: string; target: string }[]),
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

  // Engagement mode merges every nmap scan in the engagement into one map;
  // otherwise we show a single selected scan.
  const engName = engagementRows.find((e) => e.id === engId)?.name ?? "";
  const selected = engId ? null : jobs.find((j) => j.id === searchParams.job) ?? jobs[0] ?? null;
  const hosts = engId
    ? mergeNetworkHosts(engJobs.map((j) => parseNmapNetwork(j.output)))
    : selected
      ? parseNmapNetwork(selected.output)
      : [];
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

      <HelpBanner>
        <p>• Use the scan form to scan a network your machine is on (it auto-detects subnets).</p>
        <p>• Or queue an nmap discovery/network scan against a CIDR on the Jobs page.</p>
        <p>• Hosts, ports and services from the latest scan render as a map below.</p>
      </HelpBanner>

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

      {/* Wireless / environment recon (runs on a machine; pick the runner on Jobs) */}
      <div className="card mt-4">
        <h2 className="flex items-center gap-2 font-semibold text-brand">
          <Icon name="globe" className="h-4 w-4" /> Wireless &amp; environment
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Scan the air and the local LAN. These open the Jobs page with the command
          pre-filled — pick your machine and run. Only scan networks you own or are
          authorized to test.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {[
            { label: "WiFi access points", cmd: "nmcli -f SSID,BSSID,CHAN,SIGNAL,SECURITY dev wifi list" },
            { label: "Rescan WiFi", cmd: "nmcli dev wifi rescan" },
            { label: "LAN devices (arp-scan)", cmd: "arp-scan --localnet" },
            { label: "WiFi interfaces", cmd: "iw dev" },
          ].map((q) => (
            <Link
              key={q.label}
              href={`/dashboard/jobs?cmd=${encodeURIComponent(q.cmd)}`}
              className="btn-ghost px-2 py-1"
            >
              <Icon name="bolt" className="h-3 w-3" /> {q.label}
            </Link>
          ))}
        </div>
        <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
          📡 <b>Monitor-mode capture</b> (deauth, handshake capture with
          airodump-ng) needs a USB adapter that supports monitor mode plugged into
          the runner machine and put into monitor mode
          (<code className="font-mono">airmon-ng start wlan1</code>). Then run{" "}
          <code className="font-mono">airodump-ng wlan1mon</code> via a custom job.
          The built-in/VM WiFi usually can&apos;t do this — attach your dongle first.
        </p>
      </div>

      {/* View switch: a single scan, or the merged map of a whole engagement. */}
      {engagementRows.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">View:</span>
          <Link
            href="/dashboard/network"
            className={`tag ${!engId ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
          >
            Single scan
          </Link>
          {engagementRows.map((e) => (
            <Link
              key={e.id}
              href={`/dashboard/network?engagement=${e.id}`}
              className={`tag ${engId === e.id ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
            >
              {e.name}
            </Link>
          ))}
        </div>
      )}

      {engId ? (
        // ── Full-engagement map (all nmap scans merged) ──
        <>
          <h2 className="mt-4 flex items-center gap-2 text-lg font-semibold">
            <Icon name="globe" className="h-4 w-4 text-brand" /> {engName} — full map
            <span className="text-sm font-normal text-gray-500">({engJobs.length} scan{engJobs.length === 1 ? "" : "s"} merged)</span>
          </h2>
          <section className="mt-4 grid grid-cols-3 gap-4">
            <Stat value={hosts.length} label="hosts up" />
            <Stat value={withPorts} label="with open ports" accent="text-emerald-300" />
            <Stat value={totalPorts} label="open ports" accent="text-amber-300" />
          </section>
          {hosts.length === 0 ? (
            <div className="card mt-6 text-sm text-gray-500">
              No nmap hosts in this engagement yet. Run a <strong>Scan &amp; recon</strong> (or an
              nmap network scan) from the engagement, then refresh.
            </div>
          ) : (
            <div className="mt-6">
              <NetworkGraph hosts={hosts} subnet={engName} />
            </div>
          )}
        </>
      ) : jobs.length === 0 ? (
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
          {/* Scan selector (compact dropdown — many scans otherwise flood the page) */}
          <ScanSelect
            selectedId={selected?.id}
            scans={jobs.map((j) => ({
              id: j.id,
              target: j.target,
              engagement: j.engagement?.name ?? "—",
              date: new Date(j.createdAt).toLocaleDateString(),
            }))}
          />

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
