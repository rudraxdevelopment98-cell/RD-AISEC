// AirSight rolling history — aggregates the canonical event stream over time into
// a per-device sighting history (first/last seen, count, signal) and a presence
// timeline, and produces the `export` payload. Pure (no DB/IO), unit tested. The
// storage layer persists a History blob per owner; the UI renders it.

import type { AirsightEvent } from "@/lib/airsight-core";

export type Sighting = {
  id: string; // bssid (network) or clientMac (client)
  kind: "network" | "client";
  label: string; // ssid, or vendor for a client
  vendor: string;
  firstSeen: number; // epoch ms
  lastSeen: number;
  count: number; // times seen across merges
  lastSignal: number; // dBm
  associatedBssid: string | null;
};

export type TimelineSample = { t: number; networks: number; clients: number };

export type History = {
  devices: Sighting[];
  samples: TimelineSample[];
  updatedAt: number;
};

export const EMPTY_HISTORY: History = { devices: [], samples: [], updatedAt: 0 };

const MAX_DEVICES = 1000;
const MAX_SAMPLES = 500;

/**
 * Fold a batch of canonical events into the rolling history: upsert each device
 * by id, refresh last-seen/count/signal, and append one timeline sample. A
 * `retentionMs` prunes devices not seen within the window (0 = keep all).
 */
export function mergeSightings(prev: History, events: AirsightEvent[], now: number, retentionMs = 0): History {
  const byId = new Map<string, Sighting>(prev.devices.map((d) => [d.id, { ...d }]));
  let nNet = 0, nClient = 0;

  for (const e of events) {
    if (e.type === "network_discovered") {
      nNet++;
      upsert(byId, e.bssid, "network", e.ssid, e.vendor, e.signalDbm, null, now);
    } else if (e.type === "client_seen") {
      nClient++;
      upsert(byId, e.clientMac, "client", e.vendor, e.vendor, e.signalDbm, e.associatedBssid, now);
    }
    // presence_event history is folded by the caller into samples if desired.
  }

  let devices = Array.from(byId.values());
  if (retentionMs > 0) devices = devices.filter((d) => now - d.lastSeen <= retentionMs);
  devices.sort((a, b) => b.lastSeen - a.lastSeen);
  if (devices.length > MAX_DEVICES) devices = devices.slice(0, MAX_DEVICES);

  const samples = [...prev.samples, { t: now, networks: nNet, clients: nClient }].slice(-MAX_SAMPLES);
  return { devices, samples, updatedAt: now };
}

function upsert(
  map: Map<string, Sighting>,
  id: string,
  kind: "network" | "client",
  label: string,
  vendor: string,
  signal: number,
  assoc: string | null,
  now: number,
): void {
  if (!id) return;
  const cur = map.get(id);
  if (cur) {
    cur.lastSeen = now;
    cur.count += 1;
    cur.lastSignal = signal || cur.lastSignal;
    if (label && label !== "(hidden)") cur.label = label;
    if (assoc) cur.associatedBssid = assoc;
  } else {
    map.set(id, { id, kind, label, vendor, firstSeen: now, lastSeen: now, count: 1, lastSignal: signal, associatedBssid: assoc });
  }
}

/** Devices seen within `windowMs` of now — the "currently present" set. */
export function activeDevices(history: History, now: number, windowMs = 60_000): Sighting[] {
  return history.devices.filter((d) => now - d.lastSeen <= windowMs);
}

/** Roll the history up for the dashboard. */
export function historySummary(history: History, now: number): {
  total: number;
  networks: number;
  clients: number;
  activeClients: number;
  newLastHour: number;
} {
  const active = activeDevices(history, now, 60_000);
  return {
    total: history.devices.length,
    networks: history.devices.filter((d) => d.kind === "network").length,
    clients: history.devices.filter((d) => d.kind === "client").length,
    activeClients: active.filter((d) => d.kind === "client").length,
    newLastHour: history.devices.filter((d) => now - d.firstSeen <= 3_600_000).length,
  };
}

/** The `export` payload — schema-stable JSON for external analysis. */
export function toExport(history: History, sinceMs = 0): string {
  const cutoff = sinceMs > 0 ? Date.now() - sinceMs : 0;
  const devices = history.devices.filter((d) => d.lastSeen >= cutoff);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      schema: "airsight/history/1",
      devices: devices.map((d) => ({
        id: d.id,
        kind: d.kind,
        label: d.label,
        vendor: d.vendor,
        firstSeen: new Date(d.firstSeen).toISOString(),
        lastSeen: new Date(d.lastSeen).toISOString(),
        count: d.count,
        lastSignalDbm: d.lastSignal,
        associatedBssid: d.associatedBssid,
      })),
      timeline: history.samples,
    },
    null,
    2,
  );
}

/** Defensive parse of a stored history blob. */
export function parseHistory(raw: unknown): History {
  const o = (raw ?? {}) as Partial<History>;
  return {
    devices: Array.isArray(o.devices) ? (o.devices as Sighting[]).slice(0, MAX_DEVICES) : [],
    samples: Array.isArray(o.samples) ? (o.samples as TimelineSample[]).slice(-MAX_SAMPLES) : [],
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
  };
}
