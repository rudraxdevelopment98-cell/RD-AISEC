import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { HelpBanner } from "@/components/hint";
import { SensingObservatory } from "@/components/sensing-observatory";
import { WifiCamera } from "@/components/wifi-camera";
import { WifiDevices } from "@/components/wifi-devices";
import { FloorPlanEditor } from "@/components/floorplan-editor";
import { WifiAutomap } from "@/components/wifi-automap";
import { WifiHomemap } from "@/components/wifi-homemap";
import { CsiCapability } from "@/components/csi-capability";
import { AirsightSetup } from "@/components/airsight-setup";
import { AirsightConsole } from "@/components/airsight-console";
import { normalizePlan, defaultPlan } from "@/lib/floorplan-core";
import { Tabs, TabPanel } from "@/components/tabs";
import { RUNNER_ONLINE_WINDOW_MS } from "@/lib/runner-constants";

export const dynamic = "force-dynamic";

export default async function SensingPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const runners = await prisma.runner.findMany({
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, name: true, lastSeenAt: true, wifi: true, wifiDetail: true },
  });
  // Load the saved home floor plan (or a starter template).
  const planRow = email ? await prisma.homePlan.findUnique({ where: { ownerEmail: email } }) : null;
  let homePlan = defaultPlan();
  if (planRow?.data) {
    try { homePlan = normalizePlan(JSON.parse(planRow.data)); } catch { /* keep default */ }
  }
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

  // Device-aware capture nodes for the AirSight Setup console (online + offline,
  // with per-adapter chipset/driver detail).
  const airsightMachines = runners.map((r) => ({
    id: String(r.id),
    name: String(r.name || "Machine"),
    online: !!(r.lastSeenAt && now - new Date(r.lastSeenAt).getTime() < RUNNER_ONLINE_WINDOW_MS),
    wifiDetail: String(r.wifiDetail ?? ""),
    wifi: String(r.wifi ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  }));

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
        defaultTab="setup"
        tabs={[
          { id: "setup", label: "⚙ Setup" },
          { id: "camera", label: "📷 WiFi Camera (2D)" },
          { id: "map", label: "🗺 Auto Map" },
          { id: "observatory", label: "🛰 3D Observatory" },
          { id: "home", label: "🏠 Home Plan" },
        ]}
      >
        <TabPanel id="setup">
          <p className="mb-3 text-sm text-gray-400">
            <b>AirSight</b> · passive WiFi sensing + recon. Pick your capture machine and adapter —
            the options below adapt to exactly what that hardware supports (monitor / injection / CSI /
            bands). Capture stays on the Linux node; this Mac/host runs the dashboard.
          </p>
          <AirsightSetup machines={airsightMachines} hostDevice="Apple M2 Pro (host)" />

          <div className="mt-6">
            <h2 className="text-sm font-semibold text-white">Live console — unified event stream</h2>
            <p className="mb-3 mt-1 text-xs text-gray-500">
              A passive monitor-mode listen, rendered through AirSight&apos;s one event model
              (networks + clients + presence). The Auto Map and live monitor feed the same stream.
            </p>
            <AirsightConsole machines={machines} defaultIface={interfaces[0]} />
          </div>
        </TabPanel>

        <TabPanel id="camera">
          <p className="mb-3 text-sm text-gray-400">
            A top-down occupancy view built from a <b>real RSSI capture</b> on a connected machine —
            motion is detected, ranged, and placed on the floor plan. Precise readouts (speed,
            direction, breathing, presence, confidence) are computed from the live signal; switch to{" "}
            <b>Demo</b> to preview without hardware.
          </p>
          <WifiCamera machines={machines} defaultIface={interfaces[0]} />
          <WifiDevices machines={machines.map((m) => ({ id: m.id, name: m.name }))} />
        </TabPanel>

        <TabPanel id="map">
          <p className="mb-3 text-sm text-gray-400">
            Build a <b>real 2D map of your home</b> from a monitor-mode survey. Walk your
            monitor adapter (TL-WN721N) to a few spots — every access point and client device it
            hears is captured with real RSSI, vendor and channel, then positioned by trilaterating
            across the spots. The coverage outline shows how far signal reaches.
          </p>
          <WifiHomemap machines={machines} defaultIface={interfaces[0]} plan={homePlan} />
        </TabPanel>

        <TabPanel id="observatory">
          <SensingObservatory interfaces={interfaces} defaultIface={interfaces[0]} machines={machines} />
          <CsiCapability />
        </TabPanel>

        <TabPanel id="home">
          <p className="mb-3 text-sm text-gray-400">
            Lay out your home once — rooms, walls and where your WiFi router / CSI node sit. The 3D
            Observatory renders it as <b>transparent glass walls</b> and places sensed people inside
            it at real coordinates. WiFi can localize people within a known plan (and see through
            walls); it can&apos;t reliably draw the plan for you, so you set it here.
          </p>
          <FloorPlanEditor initial={homePlan} />
          <WifiAutomap />
        </TabPanel>
      </Tabs>
    </div>
  );
}
