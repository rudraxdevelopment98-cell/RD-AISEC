import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HelpBanner } from "@/components/hint";
import { WifiSensing } from "@/components/wifi-sensing";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

export default async function SensingPage() {
  const runners = await prisma.runner.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: { name: true, lastSeenAt: true, wifi: true },
  });
  const now = Date.now();
  // Wireless interfaces reported by online machines — the "antennas" a real CSI
  // feed would come from.
  const interfaces = Array.from(
    new Set(
      runners
        .filter((r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS)
        .flatMap((r) => (r.wifi ? r.wifi.split(",") : []))
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="WiFi Sensing"
        subtitle={
          <span className="block max-w-2xl">
            Spatial sensing from WiFi — detect presence, breathing, heart rate, motion and
            body pose from Channel State Information, through walls and with no camera.
          </span>
        }
        actions={<span className="tag ring-amber-500/40 text-amber-300">◐ Simulation</span>}
      />

      <HelpBanner>
        <p>
          • This runs our own sensing engine on a <b>physically-plausible simulation</b> right now,
          so the whole dashboard is live without special hardware.
        </p>
        <p>
          • Real Channel State Information (CSI) needs CSI-capable antennas — ESP32-S3 nodes or a
          supported adapter on a machine. The dashboard reads the same frame shape, so it drops onto
          real hardware unchanged.
        </p>
        <p className="text-gray-500">
          Use only in spaces you own or are authorized to monitor. Sensing people has real privacy
          implications.
        </p>
      </HelpBanner>

      <WifiSensing interfaces={interfaces} defaultIface={interfaces[0]} />
    </div>
  );
}
