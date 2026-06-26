import Link from "next/link";
import { prisma } from "@/lib/db";
import { Icon } from "@/components/icons";
import { HelpBanner } from "@/components/hint";
import { requestInstall } from "@/lib/runners";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

// Quick actions; {iface} = a wireless interface, {mon} = its monitor interface.
// They open Jobs pre-filled — set the BSSID/channel and run on the machine.
function actions(iface: string, mon: string) {
  return [
    { label: "Enable monitor mode", cmd: `airmon-ng start ${iface}` },
    { label: "Scan APs (60s)", cmd: `timeout 60 airodump-ng ${mon}` },
    {
      label: "Capture handshake",
      cmd: `timeout 180 airodump-ng -c CHANNEL --bssid AA:BB:CC:DD:EE:FF -w /tmp/capture ${mon}`,
    },
    { label: "Deauth (authorized!)", cmd: `aireplay-ng --deauth 5 -a AA:BB:CC:DD:EE:FF ${mon}` },
    { label: "Stop monitor mode", cmd: `airmon-ng stop ${mon}` },
  ];
}

export default async function WifiPage() {
  const runners = await prisma.runner.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold">WiFi</h1>
      <p className="mt-1 max-w-2xl text-gray-400">
        Wireless recon and capture from a machine with a monitor-mode adapter.
        Scan access points and clients, capture handshakes, and (for networks you
        own) run deauth — all via the aircrack-ng suite on your runner.
      </p>

      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        <Icon name="alert" className="mr-1 inline h-4 w-4" />
        Capturing handshakes and sending deauth frames is only legal on networks
        you own or are explicitly authorized to test. Misuse is illegal.
      </div>

      <HelpBanner>
        <p>• Plug a monitor-mode USB adapter into the runner machine — it&apos;s auto-detected below.</p>
        <p>• Install the aircrack-ng suite (one click), enable monitor mode, then scan / capture.</p>
        <p>• Each action opens Jobs pre-filled — set the channel/BSSID and run on the machine.</p>
      </HelpBanner>

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

                {/* Notify: attach a monitor-mode dongle */}
                {online && !r.wifiMonitor && (
                  <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                    📡 No monitor-mode adapter detected on this machine. Plug in a
                    USB WiFi adapter that supports monitor mode (then it appears here
                    within ~30s). A VM&apos;s built-in WiFi usually can&apos;t capture.
                  </p>
                )}

                {/* Install aircrack-ng */}
                {online && !hasAircrack && (
                  <form action={requestInstall} className="mt-3">
                    <input type="hidden" name="runnerId" value={r.id} />
                    <input type="hidden" name="tool" value="aircrack" />
                    <input type="hidden" name="confirm" value="true" />
                    <button className="btn-ghost text-xs">Install aircrack-ng suite</button>
                  </form>
                )}

                {/* Quick actions */}
                {online && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-400">
                      Actions (run on <span className="font-mono">{iface}</span> — edit channel/BSSID after)
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {actions(iface, mon).map((a) => (
                        <Link
                          key={a.label}
                          href={`/dashboard/jobs?cmd=${encodeURIComponent(a.cmd)}`}
                          className="btn-ghost px-2 py-1"
                        >
                          <Icon name="bolt" className="h-3 w-3" /> {a.label}
                        </Link>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-600">
                      Crack a captured handshake with a wordlist:{" "}
                      <code className="font-mono">aircrack-ng -w wordlist.txt /tmp/capture-01.cap</code>
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
