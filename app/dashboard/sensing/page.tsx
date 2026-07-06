import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { HelpBanner } from "@/components/hint";
import { SensingObservatory } from "@/components/sensing-observatory";
import { WifiCamera } from "@/components/wifi-camera";
import { Tabs, TabPanel } from "@/components/tabs";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

export default async function SensingPage() {
  const runners = await prisma.runner.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, name: true, lastSeenAt: true, wifi: true },
  });
  const now = Date.now();
  // Online machines + their wireless interfaces — the real adapters we sample
  // RSSI from (and where a real CSI feed would come from).
  const machines = runners
    .filter((r) => r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name || "Machine"),
      wifi: String(r.wifi ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    }));
  const interfaces: string[] = Array.from(new Set(machines.flatMap((m) => m.wifi)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="WiFi Sensing"
        subtitle={
          <span className="block max-w-2xl">
            Use WiFi as a camera — detect presence, motion, speed, direction, breathing and
            room occupancy from the radio signal, through walls and with no camera.
          </span>
        }
        actions={<span className="tag ring-emerald accent-emerald">● Real signal · CSI-ready</span>}
      />

      <HelpBanner>
        <p>
          • <b>WiFi Camera (2D)</b> runs on a <b>real RSSI capture</b> from a connected machine:
          movement perturbs the WiFi multipath, and the engine derives motion, a Doppler speed
          estimate, direction, coarse range, breathing and a top-down occupancy heatmap. Several
          access points fuse into real 2D zones; one AP shows range as a ring.
        </p>
        <p>
          • Full body <b>pose / vitals imaging</b> (the 3D Observatory) needs Channel State
          Information — ESP32-S3 CSI nodes or a supported adapter. That view is a
          physically-plausible simulation until CSI hardware feeds it; the frame shape is identical,
          so it drops onto real hardware unchanged.
        </p>
        <p className="text-gray-500">
          Use only in spaces you own or are authorized to monitor. Sensing people has real privacy
          implications.
        </p>
      </HelpBanner>

      <Tabs
        defaultTab="camera"
        tabs={[
          { id: "camera", label: "📷 WiFi Camera (2D)" },
          { id: "observatory", label: "🛰 3D Observatory" },
        ]}
      >
        <TabPanel id="camera">
          <p className="mb-3 text-sm text-gray-400">
            A top-down occupancy view built from a <b>real RSSI capture</b> on a connected machine —
            motion is detected, ranged, and placed on the floor plan. Precise readouts (speed,
            direction, breathing, presence, confidence) are computed from the live signal; switch to{" "}
            <b>Demo</b> to preview without hardware.
          </p>
          <WifiCamera machines={machines} defaultIface={interfaces[0]} />
        </TabPanel>

        <TabPanel id="observatory">
          <SensingObservatory interfaces={interfaces} defaultIface={interfaces[0]} machines={machines} />
        </TabPanel>
      </Tabs>
    </div>
  );
}
