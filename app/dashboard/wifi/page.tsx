import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { AutoRefresh } from "@/components/auto-refresh";
import { requestInstall } from "@/lib/runners";
import { scanWifi, runWifiCommand, inspectNetwork, captureHandshake, deauthClient, autoHandshake, autoPwn, autoEvilTwin, crackHandshake, crackHashcat, capturePmkid, saveWifiFindings } from "@/lib/wifi";
import { parseWifiNetworks, parseWifiInspect, estimateDistance } from "@/lib/network";
import { wifiSecurityAdvice, wifiAdviceText, extractCrackedKey, extractEvilTwinKey } from "@/lib/wifi-advice";
import { lookupVendor, deviceType } from "@/data/oui";
import { CopyText } from "@/components/copy-text";
import { Tabs, TabPanel } from "@/components/tabs";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";
import { PageHeader } from "@/components/page-header";

const RISK_TONE: Record<string, string> = {
  critical: "border-sev-crit/50 text-sev-crit",
  high: "border-sev-high/50 text-sev-high",
  medium: "border-sev-med/40 text-sev-med",
  low: "border-sev-low/40 text-sev-low",
  good: "border-brand/40 text-brand",
};
const ISSUE_TONE: Record<string, string> = {
  critical: "text-sev-crit",
  high: "text-sev-high",
  medium: "text-sev-med",
  low: "text-sev-low",
  info: "text-gray-400",
};

// Smart, SAFE-by-default monitor-mode enable. The dangerous old version ran
// `airmon-ng check kill` (which kills NetworkManager globally — taking down
// ETHERNET too) and converted whatever managed wireless interface it found,
// including the one carrying THIS runner's uplink — severing it from the portal
// with no way back but a reboot. This version instead:
//   • finds the uplink interface (default route) and NEVER touches it;
//   • only converts a managed wireless card that is NOT the uplink;
//   • if the only wireless card IS the uplink, it refuses and asks for a USB
//     dongle (so the runner can never cut its own connection);
//   • scopes the change with `nmcli dev set <if> managed no` instead of killing
//     NetworkManager process-wide, so ethernet / other Wi-Fi stay online.
const ENABLE_MONITOR_CMD =
  `bash -lc 'UP=$(ip route show default 2>/dev/null | grep -oE "dev [a-z0-9]+" | head -1 | cut -d" " -f2); ` +
  `M=""; CAND=""; for d in /sys/class/net/*; do n=$(basename "$d"); ` +
  `t=$(iw dev "$n" info 2>/dev/null | grep -oE "type [a-z]+" | head -1); [ -z "$t" ] && continue; ` +
  `if [ "$t" = "type monitor" ]; then M="$n"; elif [ "$t" = "type managed" ]; then ` +
  `if [ "$n" != "$UP" ] && [ -z "$CAND" ]; then CAND="$n"; fi; fi; done; ` +
  `if [ -n "$M" ]; then echo "Already in monitor mode: $M"; iw dev; exit 0; fi; ` +
  `if [ -z "$CAND" ]; then echo "SAFE-STOP: the only wireless card is also this runners uplink ($UP)."; ` +
  `echo "Enabling monitor on it would cut the runner off the portal and kill networking (no ethernet, no wifi)."; ` +
  `echo "Plug in a SEPARATE USB WiFi dongle for monitor mode, then retry."; iw dev; exit 0; fi; ` +
  `echo "Enabling monitor on $CAND (uplink $UP stays online)"; ` +
  `nmcli dev set "$CAND" managed no >/dev/null 2>&1 || true; ` +
  `airmon-ng start "$CAND" >/dev/null 2>&1 || { ip link set "$CAND" down; iw dev "$CAND" set type monitor 2>/dev/null; ip link set "$CAND" up; }; ` +
  `echo; iw dev'`;
const STOP_MONITOR_CMD =
  `bash -lc 'for d in /sys/class/net/*; do n=$(basename "$d"); ` +
  `iw dev "$n" info 2>/dev/null | grep -q "type monitor" && airmon-ng stop "$n" >/dev/null 2>&1; done; ` +
  `for d in /sys/class/net/*; do n=$(basename "$d"); ` +
  `iw dev "$n" info 2>/dev/null | grep -q "type" && nmcli dev set "$n" managed yes >/dev/null 2>&1; done; ` +
  `rfkill unblock all 2>/dev/null; ` +
  `(systemctl restart NetworkManager 2>/dev/null || service NetworkManager restart 2>/dev/null || service network-manager restart 2>/dev/null); ` +
  `echo "Monitor stopped, interfaces re-managed, NetworkManager restarted"; iw dev'`;
const AIRODUMP_60_CMD =
  `bash -lc 'M=$(for d in /sys/class/net/*; do n=$(basename "$d"); ` +
  `iw dev "$n" info 2>/dev/null | grep -q "type monitor" && echo "$n" && break; done); ` +
  `if [ -z "$M" ]; then echo "Enable monitor mode first"; exit 0; fi; timeout 60 airodump-ng "$M"'`;

export const dynamic = "force-dynamic";

const SEC_TONE: Record<string, string> = {
  OPEN: "border-sev-crit/50 text-sev-crit",
  WEP: "border-sev-crit/50 text-sev-crit",
  WPA: "border-sev-med/40 text-sev-med",
  WPA2: "border-brand/40 text-brand",
  WPA3: "border-brand/40 text-brand",
};

export default async function WifiPage({
  searchParams,
}: {
  searchParams: { error?: string; scanned?: string; inspected?: string; pwning?: string; eviltwin?: string };
}) {
  const [runners, engagements] = await Promise.all([
    prisma.runner.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.engagement.findMany({
      where: { authorized: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);
  const now = Date.now();

  // Latest WiFi-scan + inspect jobs per runner (most recent first).
  const wifiJobs = await prisma.job.findMany({
    where: { tool: "custom", target: { startsWith: "wifi-" } },
    orderBy: { createdAt: "desc" },
    take: 80,
    select: { id: true, runnerId: true, status: true, output: true, target: true, createdAt: true },
  });
  const latestByRunner = new Map<string, (typeof wifiJobs)[number]>();
  const inspectByRunner = new Map<string, (typeof wifiJobs)[number]>();
  const crackByRunner = new Map<string, (typeof wifiJobs)[number]>();
  const evilByRunner = new Map<string, (typeof wifiJobs)[number]>();
  for (const j of wifiJobs) {
    if (!j.runnerId) continue;
    if (j.target === "wifi-scan" && !latestByRunner.has(j.runnerId)) latestByRunner.set(j.runnerId, j);
    if (j.target.startsWith("wifi-inspect") && !inspectByRunner.has(j.runnerId)) inspectByRunner.set(j.runnerId, j);
    if (j.target.startsWith("wifi-crack") && !crackByRunner.has(j.runnerId)) crackByRunner.set(j.runnerId, j);
    if (j.target.startsWith("wifi-eviltwin") && !evilByRunner.has(j.runnerId)) evilByRunner.set(j.runnerId, j);
  }

  const anyActive = wifiJobs.some((j) => j.status === "queued" || j.status === "running");

  return (
    <div className="mx-auto max-w-4xl">
      {/* Live-refresh while a scan is running so results appear on their own. */}
      {anyActive && <AutoRefresh seconds={5} />}

      <PageHeader
        title="WiFi"
        subtitle={
          <span className="block max-w-2xl">
            Wireless recon from a machine with a WiFi adapter. Scan nearby access
            points, then (with a monitor-mode dongle) capture handshakes and run deauth
            on networks you own — via the aircrack-ng suite on your runner.
          </span>
        }
      />

      <div className="mt-4 rounded-lg border border-sev-med/40 bg-sev-med/10 px-4 py-3 text-sm text-sev-med">
        <Icon name="alert" className="mr-1 inline h-4 w-4" />
        Capturing handshakes and sending deauth frames is only legal on networks
        you own or are explicitly authorized to test. Misuse is illegal.
      </div>

      <HelpBanner>
        <p>• Click <b>Scan networks now</b> on a machine — nearby access points appear below.</p>
        <p>• Open/WEP networks are flagged red. Results refresh automatically while scanning.</p>
        <p>• For capture/deauth, plug in a monitor-mode USB adapter and install aircrack-ng.</p>
        <p>
          • <b>WiFi is radio, not remote.</b> Each machine only sees networks in range of <i>its</i>
          adapter. To assess a network somewhere else, run a runner (a laptop/Pi with a dongle)
          <b> at that location</b> — it polls the portal over HTTPS, so you drive it from anywhere.
          Pick that machine&apos;s card below to scan from it.
        </p>
      </HelpBanner>

      {searchParams.error && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-2 text-sm text-sev-crit">
          <Icon name="alert" className="mr-1 inline h-4 w-4" /> {searchParams.error}
        </div>
      )}
      {searchParams.scanned && (
        <div className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand">
          ✓ Scan queued — networks appear below in a few seconds.
        </div>
      )}
      {searchParams.inspected && (
        <div className="mt-4 rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm text-brand">
          ✓ Inspecting the network (~30s capture) — connected devices appear below.
        </div>
      )}
      {searchParams.pwning && (
        <div className="mt-4 rounded-lg border border-sev-med/40 bg-sev-med/10 px-4 py-2 text-sm text-sev-med">
          💥 Auto-pwn running — capture (~2 min) then crack. The password appears in
          the network&apos;s 🔓 banner below when done (this page auto-refreshes).
        </div>
      )}
      {searchParams.eviltwin && (
        <div className="mt-4 rounded-lg border border-sev-crit/40 bg-sev-crit/10 px-4 py-2 text-sm text-sev-crit">
          🪤 Auto Evil-Twin running — a fake AP + captive portal is up (up to ~5 min).
          It quits the moment a victim submits the password, which then appears in
          the network&apos;s 🪤 banner below (this page auto-refreshes).
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
            // If an interface is already in monitor mode (wlanXmon), use it as-is
            // — don't append "mon" again (that produced "wlan0monmon").
            const monIface = ifaces.find((i) => /mon$/i.test(i));
            const mon = monIface ?? `${iface}mon`;
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

            const installedSet = new Set((r.installed ?? "").split(",").map((s) => s.trim()));
            const wifiTools = [
              { id: "hcxdumptool", label: "hcxdumptool (PMKID)" },
              { id: "hcxtools", label: "hcxtools (convert)" },
              { id: "hashcat", label: "hashcat (GPU crack)" },
              { id: "wifiphisher", label: "wifiphisher (evil twin)" },
            ].filter((t) => !installedSet.has(t.id));

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
                      <span className="tag border-sev-med/40 text-sev-med">no monitor mode</span>
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

                    <Tabs
                      defaultTab="networks"
                      tabs={[
                        { id: "networks", label: "📡 Networks" },
                        { id: "tools", label: "🛠 Tools & monitor" },
                      ]}
                    >
                    <TabPanel id="networks">
                    {/* Results */}
                    {scanning && (
                      <p className="mt-3 text-sm text-sev-low">
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
                      <p className="mt-3 text-sm text-sev-crit">
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
                              <th className="py-1 pr-3">Vendor</th>
                              <th className="py-1 pr-3">Ch</th>
                              <th className="py-1 pr-3">Signal</th>
                              <th className="py-1 pr-3">Dist</th>
                              <th className="py-1 pr-3">Security</th>
                              <th className="py-1 pr-3">Risk</th>
                              <th className="py-1"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {networks.map((n) => {
                              const vendor = lookupVendor(n.bssid);
                              const risk = wifiSecurityAdvice({ security: n.security, cipher: n.cipher, auth: n.auth }).risk;
                              return (
                              <tr key={n.bssid} className="border-t border-surface-border/60">
                                <td className="py-1 pr-3 text-white">{n.ssid}</td>
                                <td className="py-1 pr-3 font-mono text-gray-400">{n.bssid}</td>
                                <td className="py-1 pr-3 text-gray-400">{vendor && vendor !== "Unknown" ? vendor : "—"}</td>
                                <td className="py-1 pr-3 text-gray-400">{n.chan}</td>
                                <td className="py-1 pr-3 text-gray-400">{n.signal}</td>
                                <td className="py-1 pr-3 text-gray-400">{estimateDistance(n.signal) || "—"}</td>
                                <td className="py-1 pr-3">
                                  <span className={`tag ${SEC_TONE[n.security] ?? "border-gray-500/40 text-gray-400"}`}>
                                    {n.security}
                                  </span>
                                </td>
                                <td className="py-1 pr-3">
                                  <span className={`tag ${RISK_TONE[risk] ?? "border-gray-500/40 text-gray-400"}`}>{risk}</span>
                                </td>
                                <td className="py-1">
                                  <form action={inspectNetwork}>
                                    <input type="hidden" name="runnerId" value={r.id} />
                                    <input type="hidden" name="bssid" value={n.bssid} />
                                    <input type="hidden" name="channel" value={n.chan} />
                                    <button className="text-brand hover:underline" title="See connected devices + activity (needs monitor mode)">
                                      🔍 Inspect
                                    </button>
                                  </form>
                                </td>
                              </tr>
                            );})}
                          </tbody>
                        </table>
                        <p className="mt-1 text-[11px] text-gray-500">
                          Distance is a rough signal estimate. Inspect runs a 30s targeted
                          capture (needs a monitor-mode adapter).
                        </p>
                      </div>
                    )}

                    {/* Inspect results — devices connected to the chosen AP */}
                    {(() => {
                      const insp = inspectByRunner.get(r.id);
                      if (!insp) return null;
                      const target = insp.target.split(":").slice(1).join(":");
                      const busy = insp.status === "queued" || insp.status === "running";
                      const noMon = /NO_MONITOR/.test(insp.output || "");
                      const data = insp.status === "done" && !noMon ? parseWifiInspect(insp.output) : { aps: [], clients: [] };
                      const ap = data.aps[0];
                      const apChan = ap?.chan ?? "";
                      const apVendor = lookupVendor(target);
                      // A passphrase cracked from a recent crack job for this AP.
                      const crackJob = crackByRunner.get(r.id);
                      const crackedKey =
                        crackJob && crackJob.target === `wifi-crack:${target}` && crackJob.status === "done"
                          ? extractCrackedKey(crackJob.output)
                          : "";
                      // Evil-twin job for this AP (running, or captured password).
                      const evilJob = evilByRunner.get(r.id);
                      const evilForThis = evilJob && evilJob.target === `wifi-eviltwin:${target}`;
                      const evilRunning = !!evilForThis && (evilJob!.status === "queued" || evilJob!.status === "running");
                      const evilKey =
                        evilForThis && evilJob!.status === "done" ? extractEvilTwinKey(evilJob!.output) : "";
                      return (
                        <div className="mt-4 rounded-lg border border-brand/30 bg-brand/5 p-3">
                          <p className="text-xs font-semibold text-brand-glow">
                            🔍 Inspecting {target || "AP"}{apVendor && apVendor !== "Unknown" ? ` · ${apVendor}` : ""} {busy && <span className="text-sev-low">· capturing…</span>}
                          </p>
                          {noMon && (
                            <p className="mt-2 text-xs text-sev-med">
                              Needs a monitor-mode adapter. Enable monitor mode below, then Inspect again.
                            </p>
                          )}
                          {insp.status === "done" && !noMon && (
                            <>
                              {ap && (
                                <p className="mt-1 text-xs text-gray-400">
                                  {ap.ssid} · ch {ap.chan} · {ap.security}
                                  {ap.cipher ? `/${ap.cipher}` : ""}{ap.auth ? `/${ap.auth}` : ""} ·{" "}
                                  {ap.signal} dBm {estimateDistance(ap.signal) && `(${estimateDistance(ap.signal)})`}
                                  {ap.data ? ` · ${ap.data} data frames` : ""}{ap.beacons ? ` · ${ap.beacons} beacons` : ""}
                                </p>
                              )}
                              {/* Attack actions for the inspected AP (authorized only). */}
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <form action={autoPwn}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <input type="hidden" name="channel" value={apChan} />
                                  <button className="btn-primary px-2 py-1" title="Capture → crack → reveal, all in one (authorized networks only)">
                                    💥 Auto-pwn (capture → crack → reveal)
                                  </button>
                                </form>
                                <form action={autoEvilTwin}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <input type="hidden" name="ssid" value={ap?.ssid ?? ""} />
                                  <button
                                    className="btn-ghost px-2 py-1"
                                    title="Stand up a fake AP + captive portal and capture the password a victim submits — one click (authorized networks only)"
                                    disabled={evilRunning}
                                  >
                                    {evilRunning ? "🪤 Evil-Twin running…" : "🪤 Auto Evil-Twin (capture password)"}
                                  </button>
                                </form>
                                <form action={autoHandshake}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <input type="hidden" name="channel" value={apChan} />
                                  <button className="btn-ghost px-2 py-1" title="Deauth + capture in one go, then handshake check">
                                    🤝 Auto handshake
                                  </button>
                                </form>
                                <form action={captureHandshake}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <input type="hidden" name="channel" value={apChan} />
                                  <button className="btn-ghost px-2 py-1" title="120s passive capture, then handshake check">
                                    Capture (passive)
                                  </button>
                                </form>
                                <form action={deauthClient}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <button className="px-2 py-1 text-sev-med hover:text-sev-med" title="Deauth all clients to force reconnect (authorized!)">
                                    ⚡ Deauth all
                                  </button>
                                </form>
                              </div>

                              {/* Other capture methods. */}
                              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                <form action={capturePmkid}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <button className="btn-ghost px-2 py-1" title="Clientless PMKID capture (hcxdumptool) — no connected device needed">
                                    📡 PMKID capture
                                  </button>
                                </form>
                              </div>

                              {/* Crack a captured handshake/PMKID. */}
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                <form action={crackHandshake} className="flex flex-wrap items-center gap-2">
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <input
                                    name="wordlist"
                                    placeholder="wordlist path (blank = rockyou)"
                                    className="w-52 rounded-md border border-surface-border bg-surface px-2 py-1 font-mono outline-none focus:border-brand"
                                  />
                                  <button className="btn-ghost px-2 py-1" title="CPU dictionary attack (aircrack-ng)">
                                    🔓 Crack (CPU)
                                  </button>
                                </form>
                                <form action={crackHashcat}>
                                  <input type="hidden" name="runnerId" value={r.id} />
                                  <input type="hidden" name="bssid" value={target} />
                                  <button className="btn-ghost px-2 py-1" title="GPU/CPU crack via hashcat (mode 22000) — much faster on a GPU">
                                    ⚡ Crack (hashcat)
                                  </button>
                                </form>
                              </div>

                              {/* Cracked passphrase banner. */}
                              {crackedKey && (
                                <div className="mt-2 rounded-lg border border-sev-crit/50 bg-sev-crit/10 px-3 py-2 text-xs text-sev-crit">
                                  🔓 <b>Passphrase cracked:</b> <span className="font-mono">{crackedKey}</span> — weak/guessable. Recommend a long random passphrase or WPA3.
                                </div>
                              )}

                              {/* Evil-twin captured password banner (from the one-click run). */}
                              {evilKey && (
                                <div className="mt-2 rounded-lg border border-sev-crit/50 bg-sev-crit/10 px-3 py-2 text-xs text-sev-crit">
                                  🪤 <b>Password captured via Evil Twin:</b>{" "}
                                  <span className="font-mono">{evilKey}</span> — a user typed this into the
                                  fake captive portal. Strong proof the network is phishable; recommend
                                  WPA3/802.1X and user awareness.
                                </div>
                              )}

                              {/* Evil Twin — aggressive. One-click auto runs above; manual fallback here. */}
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs font-semibold text-sev-med hover:text-sev-med">
                                  🪤 Evil Twin / captive portal (how it works · manual command)
                                </summary>
                                <div className="mt-2 space-y-2 rounded-lg border border-sev-crit/30 bg-sev-crit/5 p-2">
                                  <p className="text-[11px] text-sev-crit">
                                    The <b>🪤 Auto Evil-Twin</b> button above does this for you in one click:
                                    it stands up a fake AP with this SSID + a captive portal that asks the
                                    victim for the WiFi password, runs headless, and quits the moment a
                                    password is submitted (shown in the banner above). Very intrusive —
                                    <b> only on networks you own / are explicitly authorized to test</b>.
                                    Needs <code className="font-mono">wifiphisher</code> + root on the runner.
                                  </p>
                                  <p className="text-[11px] text-gray-400">
                                    Prefer to drive it by hand in the runner&apos;s Kali terminal instead:
                                  </p>
                                  <div className="flex items-center gap-2">
                                    <code className="flex-1 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-gray-300">
                                      sudo wifiphisher -e &quot;{ap?.ssid || "SSID"}&quot; -p firmware-upgrade
                                    </code>
                                    <CopyText text={`sudo wifiphisher -e "${ap?.ssid || "SSID"}" -p firmware-upgrade`} label="Copy" />
                                  </div>
                                  <p className="text-[11px] text-gray-500">
                                    All-in-one alternative: <code className="font-mono">sudo airgeddon</code> (menu-driven evil twin + handshake + crack).
                                  </p>
                                </div>
                              </details>

                              {/* Security assessment & suggestions */}
                              {ap && (() => {
                                const apIn = {
                                  ssid: ap.ssid, security: ap.security, cipher: ap.cipher,
                                  auth: ap.auth, clients: data.clients.length, crackedKey,
                                };
                                const assess = wifiSecurityAdvice(apIn);
                                const text = wifiAdviceText(apIn, assess);
                                return (
                                  <div className="mt-3 rounded-lg border border-surface-border bg-black/20 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <p className="text-xs font-semibold text-gray-300">
                                        🛡 Security assessment{" "}
                                        <span className={`tag ${RISK_TONE[assess.risk] ?? ""}`}>{assess.risk} risk</span>
                                      </p>
                                      <CopyText text={text} label="Copy suggestions" />
                                    </div>
                                    <ul className="mt-2 space-y-2">
                                      {assess.issues.map((i, idx) => (
                                        <li key={idx} className="text-xs">
                                          <span className={`font-semibold ${ISSUE_TONE[i.severity] ?? "text-gray-300"}`}>
                                            [{i.severity}] {i.title}
                                          </span>
                                          <p className="text-gray-500">{i.detail}</p>
                                          <p className="text-gray-400"><span className="text-gray-500">Fix:</span> {i.fix}</p>
                                        </li>
                                      ))}
                                    </ul>
                                    {/* Save the review into an engagement's findings (report-ready). */}
                                    {engagements.length > 0 && (
                                      <form action={saveWifiFindings} className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-border pt-2">
                                        <input type="hidden" name="ssid" value={ap.ssid} />
                                        <input type="hidden" name="bssid" value={target} />
                                        <input type="hidden" name="security" value={ap.security} />
                                        <input type="hidden" name="cipher" value={ap.cipher ?? ""} />
                                        <input type="hidden" name="auth" value={ap.auth ?? ""} />
                                        <input type="hidden" name="clients" value={data.clients.length} />
                                        <input type="hidden" name="crackedKey" value={crackedKey} />
                                        <span className="text-[11px] text-gray-500">Save to engagement:</span>
                                        <select name="engagementId" className="rounded-md border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand">
                                          {engagements.map((e) => (
                                            <option key={e.id} value={e.id}>{e.name}</option>
                                          ))}
                                        </select>
                                        <button className="btn-ghost px-2 py-1 text-xs">Save as findings</button>
                                      </form>
                                    )}
                                  </div>
                                );
                              })()}
                              {data.clients.length === 0 ? (
                                <p className="mt-2 text-xs text-gray-500">No connected devices seen yet — capture again at peak time, or the AP may be idle.</p>
                              ) : (
                                <div className="mt-2 overflow-x-auto">
                                  <p className="mb-1 text-xs font-semibold text-gray-400">{data.clients.length} device(s) connected / nearby</p>
                                  <table className="w-full text-left text-xs">
                                    <thead className="text-gray-500">
                                      <tr>
                                        <th className="py-1 pr-3">Device (MAC)</th>
                                        <th className="py-1 pr-3">Likely</th>
                                        <th className="py-1 pr-3">Connected to</th>
                                        <th className="py-1 pr-3">Signal</th>
                                        <th className="py-1 pr-3">Dist</th>
                                        <th className="py-1 pr-3">Packets</th>
                                        <th className="py-1 pr-3">Probing for</th>
                                        <th className="py-1"></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {data.clients.map((c) => {
                                        const v = lookupVendor(c.mac);
                                        const dt = deviceType(v);
                                        return (
                                        <tr key={c.mac} className="border-t border-surface-border/60">
                                          <td className="py-1 pr-3 font-mono text-white">{c.mac}</td>
                                          <td className="py-1 pr-3 text-gray-300">
                                            {dt || (v && v !== "Unknown" ? v : "—")}
                                            {dt && v && v !== "Unknown" && !/randomized/i.test(v) ? <span className="text-gray-500"> · {v}</span> : null}
                                          </td>
                                          <td className="py-1 pr-3 font-mono text-gray-400">{c.assoc}</td>
                                          <td className="py-1 pr-3 text-gray-400">{c.power}</td>
                                          <td className="py-1 pr-3 text-gray-400">{estimateDistance(c.power) || "—"}</td>
                                          <td className="py-1 pr-3 text-gray-400">{c.packets}</td>
                                          <td className="py-1 pr-3 text-gray-500">{c.probes || "—"}</td>
                                          <td className="py-1">
                                            <form action={deauthClient}>
                                              <input type="hidden" name="runnerId" value={r.id} />
                                              <input type="hidden" name="bssid" value={target} />
                                              <input type="hidden" name="client" value={c.mac} />
                                              <button className="text-sev-med hover:text-sev-med" title="Deauth this device (authorized!)">⚡ Deauth</button>
                                            </form>
                                          </td>
                                        </tr>
                                      );})}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </>
                          )}
                          {insp.status === "failed" && (
                            <p className="mt-2 text-xs text-sev-crit">Capture failed — ensure aircrack-ng is installed and the runner runs as root.</p>
                          )}
                        </div>
                      );
                    })()}

                    </TabPanel>

                    <TabPanel id="tools">
                    {/* Install WiFi tooling (capture/crack/evil-twin) */}
                    {(!hasAircrack || wifiTools.length > 0) && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {!hasAircrack && (
                          <form action={requestInstall}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="tool" value="aircrack" />
                            <input type="hidden" name="confirm" value="true" />
                            <button className="btn-ghost text-xs">Install aircrack-ng</button>
                          </form>
                        )}
                        {wifiTools.map((t) => (
                          <form key={t.id} action={requestInstall}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="tool" value={t.id} />
                            <input type="hidden" name="confirm" value="true" />
                            <button className="btn-ghost text-xs">Install {t.label}</button>
                          </form>
                        ))}
                      </div>
                    )}

                    {/* Monitor / capture (collapsible — advanced) */}
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-semibold text-gray-300 hover:text-brand">
                        Monitor mode &amp; handshake capture
                      </summary>
                      <div className="mt-2 space-y-2">
                        {!r.wifiMonitor && (
                          <p className="rounded-lg border border-sev-med/30 bg-sev-med/5 px-3 py-2 text-[11px] text-sev-med">
                            📡 No monitor-mode adapter detected. Plug a USB WiFi adapter that supports monitor mode into this machine (appears within ~30s). A VM&apos;s built-in WiFi usually can&apos;t capture.
                          </p>
                        )}
                        <p className="rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] text-gray-400">
                          🛡 Safe by default: &quot;Enable monitor mode&quot; only converts a wireless card that is <b className="text-gray-200">not</b> this runner&apos;s uplink, and scopes the change to that one interface (it no longer kills NetworkManager globally, so ethernet stays up). If the <b className="text-gray-200">only</b> WiFi card is also the uplink, it refuses and asks for a separate USB dongle — so the runner can never cut its own link to the portal. &quot;Stop monitor mode&quot; re-manages every interface and restarts NetworkManager.
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs">
                          <form action={runWifiCommand}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="command" value={ENABLE_MONITOR_CMD} />
                            <button className="btn-ghost px-2 py-1">Enable monitor mode</button>
                          </form>
                          <form action={runWifiCommand}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="command" value={AIRODUMP_60_CMD} />
                            <button className="btn-ghost px-2 py-1">Scan APs (airodump 60s)</button>
                          </form>
                          <form action={runWifiCommand}>
                            <input type="hidden" name="runnerId" value={r.id} />
                            <input type="hidden" name="command" value={STOP_MONITOR_CMD} />
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
                        <p className="text-[11px] text-gray-500">
                          Crack a captured handshake:{" "}
                          <code className="font-mono">aircrack-ng -w wordlist.txt /tmp/capture-01.cap</code>
                        </p>
                      </div>
                    </details>
                  </TabPanel>
                  </Tabs>
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
