// AirSight core — the passive WiFi sensing + recon model.
//
// One structured event stream shared by SENSING (RSSI presence/motion) and RECON
// (passive network/client discovery). Device-aware: capture options are derived
// from what the selected adapter can actually do (lib/wifi-adapter). Passive by
// default — capture + analyze, never transmit/inject unless an explicitly gated
// active module is enabled. Pure (no DB/IO), unit tested. Authorized use only.

import { adapterCapability, type Band } from "@/lib/wifi-adapter";

// ── Resource tiers (minimal → full) ─────────────────────────────────────────
export type Tier = "minimal" | "standard" | "full";
export type TierConfig = {
  tier: Tier;
  dashboard: boolean;
  liveStream: boolean;
  history: boolean;
  mlModel: boolean; // lightweight statistical model (not deep learning)
  retentionDays: number;
  note: string;
};
export const TIERS: Record<Tier, TierConfig> = {
  minimal: { tier: "minimal", dashboard: false, liveStream: false, history: true, mlModel: false, retentionDays: 3, note: "CLI / low-RAM: capture + detect + recon snapshots only. <80 MB." },
  standard: { tier: "standard", dashboard: true, liveStream: true, history: true, mlModel: false, retentionDays: 7, note: "Live dashboard + rolling history. <200 MB. The Kali-VM default." },
  full: { tier: "full", dashboard: true, liveStream: true, history: true, mlModel: true, retentionDays: 30, note: "Cross-node dashboard + a lightweight statistical presence model + export." },
};

// ── Event schemas (the shared bus) ──────────────────────────────────────────
export type PresenceState = "idle" | "motion" | "present";
export type PresenceEvent = {
  type: "presence_event";
  timestamp: string; // ISO8601
  bssid: string;
  zoneLabel: string;
  state: PresenceState;
  confidence: number; // 0..1
  source: "rssi" | "csi";
};
export type NetworkEvent = {
  type: "network_discovered";
  timestamp: string;
  bssid: string;
  ssid: string;
  channel: number;
  encryption: string;
  vendor: string;
  signalDbm: number;
};
export type ClientEvent = {
  type: "client_seen";
  timestamp: string;
  clientMac: string;
  associatedBssid: string | null;
  vendor: string;
  signalDbm: number;
};
export type AirsightEvent = PresenceEvent | NetworkEvent | ClientEvent;

// ── Capture modes ───────────────────────────────────────────────────────────
// Passive-by-default. "monitor" = passive frame capture (listen-only). Active
// modes (injection) are intentionally NOT offered here; they belong to a
// separate, gated module per the ethical constraints.
export type CaptureMode = "listen_managed" | "monitor";

export type ChannelPlan = { mode: "fixed"; channel: number } | { mode: "hop"; dwellMs: number; channels: number[] };

export type CaptureOptions = {
  /** Modes the adapter actually supports (managed listen always; monitor if capable). */
  modes: CaptureMode[];
  recommendedMode: CaptureMode;
  bands: Band[];
  /** Suggested channel plan given a single adapter (one channel at a time). */
  suggestedPlan: ChannelPlan;
  /** Whether this adapter can be the capture node at all. */
  canCapture: boolean;
  /** Whether a CSI upgrade path exists on this adapter. */
  csiUpgrade: { available: boolean; tool: string };
  /** Human guidance for this specific device. */
  note: string;
};

const CH_24 = [1, 6, 11]; // non-overlapping 2.4 GHz
const CH_5 = [36, 40, 44, 48, 149, 153, 157, 161];

/**
 * Device-aware capture options. Given the capture adapter's chipset/driver, the
 * UI shows only what the hardware supports — the heart of "detect the device,
 * then give custom options".
 */
export function captureOptions(chipsetOrDriver: string): CaptureOptions {
  const cap = adapterCapability(chipsetOrDriver);
  const modes: CaptureMode[] = ["listen_managed"];
  if (cap.monitor) modes.push("monitor");
  const bands = cap.bands;
  // One adapter captures one channel at a time → hop the common channels for the
  // supported bands, or fix to a target's channel.
  const hopChannels = [...CH_24, ...(bands.includes("5") ? CH_5.slice(0, 4) : [])];
  return {
    modes,
    recommendedMode: cap.monitor ? "monitor" : "listen_managed",
    bands,
    suggestedPlan: cap.monitor ? { mode: "hop", dwellMs: 250, channels: hopChannels } : { mode: "fixed", channel: 1 },
    canCapture: cap.monitor,
    csiUpgrade: { available: cap.csi, tool: cap.csiTool },
    note: cap.monitor
      ? `${cap.family}: passive monitor-mode capture on ${bands.join("/")} GHz. Single adapter = one channel at a time, so ${cap.monitor ? "channel-hop or pin a target channel" : ""}.`
      : `${cap.family}: no monitor mode — can't be a capture node. ${cap.note}`,
  };
}

// ── Two-machine role model ──────────────────────────────────────────────────
export type NodeRole = "capture" | "host" | "both";
export type DevicePlan = {
  captureAdapter: string; // chipset/driver
  hostDevice: string; // e.g. "Apple M2 Pro"
  captureRole: NodeRole;
  ok: boolean;
  warnings: string[];
  recommendation: string;
};

/**
 * Validate a two-machine plan (host + capture adapter) and advise. Encodes the
 * "minimum equipment, maximum result" split: macOS/host does UI + storage; a
 * cheap monitor-mode adapter on a Linux node does capture.
 */
export function planDevices(hostDevice: string, captureAdapter: string): DevicePlan {
  const host = adapterCapability(hostDevice);
  const cap = adapterCapability(captureAdapter);
  const warnings: string[] = [];
  if (!cap.monitor) warnings.push(`${cap.family} can't do monitor mode — it can't capture. Use an Atheros/Realtek/MediaTek USB adapter on the Linux node.`);
  if (host.monitor && host.role === "capture") warnings.push("The host adapter could also capture, but keeping capture on the dedicated node is cleaner.");
  const ok = cap.monitor;
  return {
    captureAdapter,
    hostDevice,
    captureRole: "capture",
    ok,
    warnings,
    recommendation: ok
      ? `Capture on ${cap.family} (Linux/Kali node); run the dashboard + storage on ${host.family}. ${cap.csi ? `CSI upgrade available via ${cap.csiTool}.` : "Add an ESP32-CSI node later for fine pose/vitals."}`
      : `Add a monitor-capable USB adapter (e.g. AR9271 / RTL8812AU) to the capture node — ${cap.family} alone can't capture.`,
  };
}

// ── Presence classification (RSSI tier) ─────────────────────────────────────
// Maps a motion level (0..1) + calibrated quiet baseline into a presence state
// + confidence. Shared contract so a future CSI source produces the same events.
export function classifyPresence(
  motion: number,
  opts: { baseline?: number | null; presentPct?: number } = {},
): { state: PresenceState; confidence: number } {
  const base = opts.baseline ?? 0;
  const thresh = base > 0 ? base * 1.5 + 0.04 : 0.12;
  if (motion >= thresh * 1.8) return { state: "motion", confidence: Math.min(1, motion) };
  if (motion >= thresh) return { state: "present", confidence: Math.min(0.9, 0.4 + motion) };
  return { state: "idle", confidence: Math.min(1, 1 - motion) };
}

/** Build a presence_event from a sensing sample (implementation-agnostic). */
export function presenceEvent(input: {
  bssid: string;
  zoneLabel?: string;
  motion: number;
  baseline?: number | null;
  source?: "rssi" | "csi";
  timestamp?: string;
}): PresenceEvent {
  const { state, confidence } = classifyPresence(input.motion, { baseline: input.baseline });
  return {
    type: "presence_event",
    timestamp: input.timestamp ?? new Date().toISOString(),
    bssid: input.bssid,
    zoneLabel: input.zoneLabel ?? "",
    state,
    confidence: Math.round(confidence * 100) / 100,
    source: input.source ?? "rssi",
  };
}
