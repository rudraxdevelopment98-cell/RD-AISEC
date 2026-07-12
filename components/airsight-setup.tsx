"use client";

import { useMemo, useState } from "react";
import { adapterCapability } from "@/lib/wifi-adapter";
import { captureOptions, planDevices, TIERS, type Tier, type CaptureMode } from "@/lib/airsight-core";

export type AirsightMachine = {
  id: string;
  name: string;
  online: boolean;
  /** "iface:driver" comma-joined, from the runner. */
  wifiDetail: string;
  /** fallback iface names when detail is absent */
  wifi: string[];
};

type Adapter = { iface: string; driver: string };

function parseAdapters(m: AirsightMachine): Adapter[] {
  const fromDetail = (m.wifiDetail || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .map((pair) => {
      const [iface, driver = "unknown"] = pair.split(":");
      return { iface, driver };
    });
  if (fromDetail.length) return fromDetail;
  return m.wifi.map((iface) => ({ iface, driver: "unknown" }));
}

const MODE_LABEL: Record<CaptureMode, string> = {
  listen_managed: "Managed listen (limited)",
  monitor: "Monitor (passive capture)",
};

/**
 * AirSight Setup — "detect the device, then give custom options". Pick the
 * capture machine and adapter; the UI shows exactly what that hardware supports
 * (monitor / injection / CSI / bands) and the recommended passive-capture plan.
 * Nothing here transmits — it's configuration only.
 */
export function AirsightSetup({ machines, hostDevice = "" }: { machines: AirsightMachine[]; hostDevice?: string }) {
  const [machineId, setMachineId] = useState(machines.find((m) => m.online)?.id ?? machines[0]?.id ?? "");
  const machine = machines.find((m) => m.id === machineId);
  const adapters = useMemo(() => (machine ? parseAdapters(machine) : []), [machine]);
  const [iface, setIface] = useState(adapters[0]?.iface ?? "");
  const adapter = adapters.find((a) => a.iface === iface) ?? adapters[0];

  const cap = adapter ? adapterCapability(adapter.driver) : null;
  const opts = adapter ? captureOptions(adapter.driver) : null;
  const [mode, setMode] = useState<CaptureMode>("monitor");
  const [tier, setTier] = useState<Tier>("standard");
  const plan = adapter ? planDevices(hostDevice || "host", adapter.driver) : null;

  // Keep iface valid when machine changes.
  const validIface = adapters.some((a) => a.iface === iface);
  if (!validIface && adapters[0]) setIface(adapters[0].iface);

  return (
    <div className="space-y-4">
      {machines.length === 0 && (
        <div className="rounded-xl border border-sev-med/40 bg-sev-med/10 px-4 py-2.5 text-sm text-sev-med">
          No capture machine connected. Run the engine on a Linux/Kali box with a monitor-capable USB
          adapter (e.g. AR9271 / TL-WN721N), then it appears here.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Device selection */}
        <div className="card">
          <p className="text-sm font-semibold text-white">1 · Capture device</p>
          <p className="mt-1 text-xs text-gray-500">The machine + adapter that will listen. Capture stays on this node.</p>

          <label className="mt-3 block text-xs text-gray-400">Parent machine
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand">
              {machines.map((m) => <option key={m.id} value={m.id}>{m.name}{m.online ? "" : " (offline)"}</option>)}
            </select>
          </label>

          <label className="mt-3 block text-xs text-gray-400">WiFi adapter
            <select value={iface} onChange={(e) => setIface(e.target.value)} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm font-mono outline-none focus:border-brand">
              {adapters.length === 0 && <option value="">no adapters detected</option>}
              {adapters.map((a) => <option key={a.iface} value={a.iface}>{a.iface} · {a.driver}</option>)}
            </select>
          </label>
        </div>

        {/* Detected capabilities */}
        <div className="card">
          <p className="text-sm font-semibold text-white">2 · Detected capabilities</p>
          {cap ? (
            <>
              <p className="mt-2 text-sm text-gray-200">{cap.family}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <Cap on={cap.monitor} label="monitor" />
                <Cap on={cap.injection} label="injection" />
                <Cap on={cap.csi} label={cap.csi ? `CSI (${cap.csiTool})` : "CSI"} />
                <span className="tag">{cap.bands.join("/")} GHz</span>
                <span className="tag">{cap.antennas} antenna{cap.antennas > 1 ? "s" : ""}</span>
                <span className="tag capitalize">role: {cap.role}</span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{cap.note}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Select an adapter to see what it can do.</p>
          )}
        </div>
      </div>

      {/* Options — device-aware */}
      {opts && (
        <div className="card">
          <p className="text-sm font-semibold text-white">3 · Capture options</p>
          {!opts.canCapture ? (
            <p className="mt-2 rounded-lg border border-sev-med/40 bg-sev-med/10 px-3 py-2 text-xs text-sev-med">
              This adapter can&apos;t do monitor mode, so it can&apos;t be a capture node. {opts.note}
            </p>
          ) : (
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <label className="block text-xs text-gray-400">Mode (passive)
                <select value={mode} onChange={(e) => setMode(e.target.value as CaptureMode)} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand">
                  {opts.modes.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
                </select>
              </label>
              <div className="text-xs text-gray-400">Channel plan
                <div className="mt-1 rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm text-gray-200">
                  {opts.suggestedPlan.mode === "hop"
                    ? `Hop ${opts.suggestedPlan.channels.join(", ")} · ${opts.suggestedPlan.dwellMs}ms dwell`
                    : `Fixed ch ${opts.suggestedPlan.channel}`}
                </div>
                <p className="mt-1 text-[10px] text-gray-500">One adapter = one channel at a time.</p>
              </div>
              <label className="block text-xs text-gray-400">Resource tier
                <select value={tier} onChange={(e) => setTier(e.target.value as Tier)} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1.5 text-sm capitalize outline-none focus:border-brand">
                  {(Object.keys(TIERS) as Tier[]).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
          )}

          <p className="mt-3 text-[11px] text-gray-500">{TIERS[tier].note}</p>
          {opts.csiUpgrade.available && (
            <p className="mt-1 text-[11px] text-emerald-300">↑ CSI upgrade available on this adapter via {opts.csiUpgrade.tool} — unlocks pose / breathing / heart-rate.</p>
          )}
        </div>
      )}

      {/* Recommendation */}
      {plan && (
        <div className="card">
          <p className="text-sm font-semibold text-white">4 · Recommended setup</p>
          <p className="mt-2 text-sm text-gray-300">{plan.recommendation}</p>
          {plan.warnings.map((w, i) => (
            <p key={i} className="mt-1 text-xs text-sev-med">⚠ {w}</p>
          ))}
          <p className="mt-2 text-[11px] text-gray-500">
            Passive by default — AirSight captures and analyses, it never transmits or injects. Active
            testing (deauth/handshakes) stays in the separate, authorization-gated WiFi tools section.
          </p>
        </div>
      )}
    </div>
  );
}

function Cap({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`tag ${on ? "border-emerald-500/40 text-emerald-300" : "border-surface-border text-gray-600 line-through"}`}>
      {on ? "✓" : "✗"} {label}
    </span>
  );
}
