// Pure helpers for the live monitor loop: accumulate repeated monitor-mode
// captures into per-device RSSI histories and derive a motion state. With ONE
// adapter at a fixed spot you get honest 1D motion (RSSI variance = moving,
// trend = approaching/receding) — not a 2D path. If a device already has a known
// position from a prior walk, the approach/recede trend animates along the line
// to it. No DB/IO — unit-testable.

import { rssiToMeters, vendorForMac, type PathLossOpts } from "@/lib/survey-core";

export type RssiSample = { t: number; rssi: number };

export type Track = {
  id: string; // MAC / BSSID
  isAp: boolean;
  essid: string;
  vendor: string;
  samples: RssiSample[]; // rolling, newest last
  lastSeen: number; // ms epoch
};

export type MotionState = "still" | "moving" | "approaching" | "receding" | "gone";

export type MotionRead = {
  state: MotionState;
  variance: number; // dB stdev over the recent window
  trend: number; // dB/sample slope (+ = RSSI rising = closer)
  meters: number | null; // latest distance estimate
};

const WINDOW = 8; // samples kept per device
const MAX_AGE_MS = 20_000; // drop a device unseen this long

type SurveyLite = {
  aps?: { bssid: string; power: number; essid?: string }[];
  stations?: { mac: string; power: number }[];
};

/** Merge one capture into the track map (mutates + returns a new Map). */
export function updateTracks(prev: Map<string, Track>, survey: SurveyLite, now: number): Map<string, Track> {
  const next = new Map(prev);
  const bump = (id: string, isAp: boolean, power: number, essid?: string) => {
    if (!id || power >= 0) return;
    const cur = next.get(id) ?? { id, isAp, essid: essid ?? "", vendor: vendorForMac(id), samples: [], lastSeen: now };
    const samples = [...cur.samples, { t: now, rssi: power }].slice(-WINDOW);
    next.set(id, { ...cur, isAp, essid: essid || cur.essid, samples, lastSeen: now });
  };
  for (const a of survey.aps ?? []) bump(a.bssid, true, a.power, a.essid);
  for (const s of survey.stations ?? []) bump(s.mac, false, s.power);
  // Evict stale tracks.
  for (const [id, t] of next) if (now - t.lastSeen > MAX_AGE_MS) next.delete(id);
  return next;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Derive a motion read from a device's RSSI history. */
export function deviceMotion(t: Track, now: number, opts: PathLossOpts = {}): MotionRead {
  const s = t.samples;
  const latest = s.length ? s[s.length - 1].rssi : NaN;
  const meters = Number.isFinite(latest) ? rssiToMeters(latest, opts) : null;
  if (now - t.lastSeen > 6000) return { state: "gone", variance: 0, trend: 0, meters };
  if (s.length < 3) return { state: "still", variance: 0, trend: 0, meters };

  const win = s.slice(-6);
  const rssis = win.map((x) => x.rssi);
  const m = mean(rssis);
  const variance = Math.sqrt(mean(rssis.map((r) => (r - m) ** 2)));

  // Least-squares slope over sample index (dB per capture).
  const n = win.length;
  const xs = win.map((_, i) => i);
  const mx = mean(xs), my = m;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (rssis[i] - my); den += (xs[i] - mx) ** 2; }
  const trend = den ? num / den : 0;

  let state: MotionState = "still";
  if (variance > 2.2) {
    if (trend > 1.2) state = "approaching";
    else if (trend < -1.2) state = "receding";
    else state = "moving";
  }
  return { state, variance: Math.round(variance * 10) / 10, trend: Math.round(trend * 10) / 10, meters };
}

export const MOTION_COLOR: Record<MotionState, string> = {
  still: "#64748b",
  moving: "#fbbf24",
  approaching: "#34d399",
  receding: "#f87171",
  gone: "#3f3f46",
};

export const MOTION_LABEL: Record<MotionState, string> = {
  still: "still",
  moving: "moving",
  approaching: "approaching",
  receding: "moving away",
  gone: "gone",
};
