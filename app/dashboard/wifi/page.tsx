import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { AutoRefresh } from "@/components/auto-refresh";
import { requestInstall } from "@/lib/runners";
import { scanWifi, runWifiCommand } from "@/lib/wifi";
import { parseWifiNetworks } from "@/lib/network";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

const SEC_TONE: Record<string, string> = {
  OPEN: "border-red-500/50 text-red-300",
  WEP: "border-red-500/50 text-red-300",
  WPA: "border-amber-500/40 text-amber-300",
  WPA2: "border-emerald-500/40 text-emerald-300",
  WPA3: "border-emerald-500/40 text-emerald-300",
};

export default async function WifiPage({
  searchParams,
}: {
  searchParams: { error?: string; scanned?: string };
}) {
  const runners = await prisma.runner.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();

  // Latest WiFi-scan job per runner (most recent first).
  const wifiJobs = await prisma.job.findMany({
    where: { tool: "custom", target: "wifi-scan" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, runnerId: true, status: true, output: true, createdAt: true },
  });
  const latestByRunner = new Map<string, (typeof wifiJobs)[number]>();
  for (const j of wifiJobs) {
    if (j.runnerId && !latestByRunner.has(j.runnerId)) latestByRunner.set(j.runnerId, j);
  }

  const anyActive = wifiJobs.some((j) => j.status === "queued" || j.status === "running");

  return (
    <div className="mx-auto max-w-4xl">
      {/* Live-refresh while a scan is running so results appear on their own. */}
      {anyActive && <AutoRefresh seconds={5} />}

      <h1 className="text-2xl font-bold">WiFi</h1>
      <p className="mt-1 max-w-2xl text-gray-400">
        Wireless recon from a machine with a WiFi adapter. Scan nearby access
        points, then (with a monitor-mode dongle) capture handshakes and run deauth
        on networks you own — via the aircrack-ng suite on your runner.
      </p>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        <Icon name="alert" className="mr-1 inline h-4 w-4" />
        Capturing handshakes and sending deauth frames is only legal on networks
        you own or are explicitly authorized to test. Misuse is illegal.
      </div>

      <HelpBanner>
        <p>• Click <b>Scan networks now</b> on a machine — nearby access points appear below.</p>
        <p>• Open/WEP networks are flagged red. Results refresh automatically while scanning.</p>
        <p>• For capture/deauth, plug in a monitor-mode USB adapter and install aircrack-ng.</p>
      </HelpBanner>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          <Icon name="alert" className="mr-1 inline h-4 w-4" /> {searchParams.error}
        </div>
      )}
      {searchParams.scanned && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          ✓ Scan queued — networks appear below in a few seconds.
        </div>
      )}

      {runners.length === 0 ? (
        <p className="mt-6 card text-sm text-gray-500">
          Connect a machine first on the{" "}
          <Link href="/dashboard/runners" className="text-brand hover:underline">Machines</Link> page.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {runners.map((r) => {
            const online = r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS;
            const ifaces = (r.wifi ?? "").split(",").map((s) => s.trim()).filter(Boolean);
            const iface = ifaces[0] ?? "wlan1";
            const mon = `${iface}mon`;
            const hasAircrack = (r.installed ?? "").split(",").map((s) => s.trim()).includes("aircrack");
            const inMonitor = ifaces.some((i) => /mon$/i.test(i));
            const job = latestByRunner.get(r.id);
            const scanning = job?.status === "queued" || job?.status === "running";
            const networks = job?.status === "done" ? parseWifiNetworks(job.output) : [];

            // Capture/monitor commands that need a channel/BSSID — opened on Jobs to edit.
            const captureActions = [
              { label: "Capture handshake", cmd: `timeout 180 airodump-ng -c CHANNEL --bssid AA:BB:CC:DD:EE:FF -w /tmp/capture ${mon}` },
              { label: "Deauth (authorized!)", cmd: `aireplay-ng --deauth 5 -a AA:BB:CC:DD:EE:FF ${mon}` },
              { label: "Read capture CSV", cmd: "cat /tmp/capture-01.csv" },
            ];

            return (
              <div key={r.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-gray-500"}`} />
                    <span className="font-semibold text-white">{r.name}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {ifaces.length > 0 ? (
                      <span className="tag font-mono">{ifaces.join(", ")}</span>
                    ) : (
                      <span className="tag border-gray-500/40 text-gray-400">no WiFi interfaces</span>
                    )}
                    {r.wifiMonitor ? (
                      <span className="tag ring-emerald accent-emerald">monitor-capable</span>
                    ) : (
                      <span className="tag border-amber-500/40 text-amber-300">no monitor mode</span>
                    )}
                  </div>
                </div>

                {!online && (
                  <p className="mt-3 text-xs text-gray-500">Machine offline — start the runner to scan.</p>
                )}

                {online && (
                  <>
                    {/* Primary action: scan now */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <form action={scanWifi}>
                        <input type="hidden" name="runnerId" value={r.id} />
                        <button className="btn-primary text-sm" disabled={scanning}>
                          <Icon name="radar" className="mr-1 inline h-4 w-4" />
                          {scanning ? "Scanning…" : "Scan networks now"}
                        </button>
                      </form>
                      {job && (
                        <span className="text-xs text-gray-500">
                          last scan {new Date(job.createdAt).toLocaleTimeString()} · {job.status}
                        </span>
                      )}
                    </div>

                    {/* Results */}
                    {scanning && (
                      <p className="mt-3 text-sm text-sky-300">
                        <Icon name="bolt" className="mr-1 inline h-4 w-4" /> Scanning the air… results appear here automatically.
                      </p>
                    )}
                    {job?.status === "done" && networks.length === 0 && (
                      <p className="mt-3 text-sm text-gray-500">
                        No networks parsed.{" "}
                        {inMonitor ? (
                          <>
                            This adapter is in <b>monitor mode</b> ({iface}) so the scan uses{" "}
                            <code className="font-mono">airodump-ng</code> — make sure <b>aircrack-ng</b> is
                            installed and the runner runs as <b>root</b>, then scan again (give it a few seconds to hear beacons).
                          </>
                        ) : (
                          <>
                            This machine may have no WiFi adapter, or nmcli/NetworkManager isn&apos;t available.
                            Try <code className="font-mono">iw dev</code> via a custom job to check.
                          </>
                        )}
                      </p>
                    )}
                    {job?.status === "failed" && (
                      <p className="mt-3 text-sm text-red-300">
                        Scan failed —{" "}
                        {inMonitor
                          ? "airodump-ng may not be installed (install aircrack-ng below) or needs root."
                          : "nmcli may not be installed/usable here."}{" "}
                        Check the <Link href={`/dashboard/jobs`} className="text-brand hover:underline">job output</Link>.
                      </p>
                    )}
                    {/* Raw output for diagnosis when nothing parsed. */}
                    {job?.status === "done" && networks.length === 0 && job.output && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
                          View raw scan output
                        </summary>
                        <pre className="mt-1 max-h-60 overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-gray-400">
                          {job.output.slice(0, 5000) || "(empty)"}
                        </pre>
                      </details>
                    )}
                    {networks.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <p className="mb-1 text-xs font-semibold text-gray-400">{networks.length} access point(s)</p>
                        <table className="w-full text-left text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="py-1 pr-3">SSID</th>
                              <th className="py-1 pr-3">BSSID</th>
                              <th className="py-1 pr-3">Ch</th>
                              <th className="py-1 pr-3">Signal</th>
                              <th className="py-1">Security</th>
                            </tr>
                          </thead>
                          <tbody>
                            {networks.map((n) => (
                              <tr key={n.bssid} className="border-t border-surface-border/60">
                                <td className="py-1 pr-3 text-white">{n.ssid}</td>
                                <td className="py-1 pr-3 font-mono text-gray-400">{n.bssid}</td>
                                <td className="py-1 pr-3 text-gray-400">{n.chan}</td>
                                <td className="py-1 pr-3 text-gray-400">{n.signal}</td>
                                <td className="py-1">
                                  <span className={`tag ${SEC_TONE[n.security] ?? "border-gray-500/40 text-gray-400"}`}>
                                    {n.security}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Install aircrack (for capture) */}
                    {!hasAircrack && (
                      <form action={requestInstall} className="mt-3">
                        <input type="hidden" name="runnerId" value={r.id} />
                        <input type="hidden" name="tool" value="aircrack" />
                        <input type="hidden" name="confirm" value="true" />
                        <button className="btn-ghost text-xs">Install aircrack-ng suite (for capture)</button>
                      </form>
                    )}

                    {/* Monitor / capture (collapsible — advanced) */}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-brand">
                        Monitor mode &amp; handshake capture
                      </summary>
                      <div className="mt-2 space-y-2">
                        {!r.wifiMonitor && (
                          <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
                            📡 No monitor-mode adapter detected. Plug a USB WiFi adapter that supports monitor mode into this machine (appears within ~30s). A VM&apos;s built-in WiFi usually can&apos;t capture.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2 text-xs">
                          <form action={runWifiCommand}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="command" value={`airmon-ng start ${iface}`} />
                            <button className="btn-ghost px-2 py-1">Enable monitor mode</button>
                          </form>
                          <form action={runWifiCommand}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="command" value={`timeout 60 airodump-ng ${mon}`} />
                            <button className="btn-ghost px-2 py-1">Scan APs (airodump 60s)</button>
                          </form>
                          <form action={runWifiCommand}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="command" value={`airmon-ng stop ${mon}`} />
                            <button className="btn-ghost px-2 py-1">Stop monitor mode</button>
                          </form>
                          {captureActions.map((a) => (
                            <Link
                              key={a.label}
                              href={`/dashboard/jobs?cmd=${encodeURIComponent(a.cmd)}`}
                              className="btn-ghost px-2 py-1"
                              title="Opens Jobs so you can set the channel/BSSID first"
                            >
                              {a.label} →
                            </Link>
                          ))}
                        </div>
                        <p className="text-[11px] text-gray-600">
                          Crack a captured handshake:{" "}
                          <code className="font-mono">aircrack-ng -w wordlist.txt /tmp/capture-01.cap</code>
                        </p>
                      </div>
                    </details>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
