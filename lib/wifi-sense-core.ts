// Turn a runner's real WiFi RSSI sample (the `wifisense` job output) into a
// motion/presence timeline. Physics: people moving in the space change the
// multipath, so the connected AP's RSSI jitters — rolling variance of RSSI is a
// real, hardware-free motion signal (managed mode, any adapter). It does NOT
// give pose/vitals/position — those need CSI hardware. Pure + testable.

export type RssiSample = { t: number; rssi: number; q: number };

export type WifiSense = {
  iface: string;
  ssid?: string;
  bssid?: string;
  rate?: number;
  samples?: RssiSample[];
  error?: string;
  message?: string;
};

export type MotionPoint = { t: number; rssi: number; motion: number; present: boolean };

export type SenseTimeline = {
  iface: string;
  ssid?: string;
  bssid?: string;
  points: MotionPoint[];
  durationSec: number;
  avgRssi: number | null;
  rssiMin: number | null;
  rssiMax: number | null;
  presentPct: number; // % of the window something was moving
  movement: number; // overall movement intensity 0..1
  error?: string;
  message?: string;
};

export function parseWifiSense(output: string): WifiSense | null {
  try {
    const o = JSON.parse(output);
    if (o && (Array.isArray(o.samples) || o.error)) return o as WifiSense;
  } catch {
    /* not JSON / partial */
  }
  return null;
}

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Rolling-variance motion timeline. `motionThresh` (dB of std-dev) tunes how
 * much jitter counts as "someone moving"; `scale` maps std-dev → 0..1 motion.
 */
export function motionTimeline(
  s: WifiSense,
  opts: { motionThresh?: number; scale?: number } = {},
): SenseTimeline {
  const iface = s.iface ?? "";
  if (s.error || !s.samples || s.samples.length < 4) {
    return {
      iface,
      ssid: s.ssid,
      bssid: s.bssid,
      points: [],
      durationSec: 0,
      avgRssi: null,
      rssiMin: null,
      rssiMax: null,
      presentPct: 0,
      movement: 0,
      error: s.error,
      message: s.message,
    };
  }
  const rate = s.rate && s.rate > 0 ? s.rate : 10;
  const win = Math.max(3, Math.round(rate)); // ~1s window
  const half = Math.floor(win / 2);
  const thresh = opts.motionThresh ?? 1.2; // dB std-dev = movement
  const scale = opts.scale ?? 3.5; // dB std-dev that maps to full motion

  const rssis = s.samples.map((x) => x.rssi);
  const avgRssi = Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length);
  const rssiMin = Math.min(...rssis);
  const rssiMax = Math.max(...rssis);

  const points: MotionPoint[] = s.samples.map((smp, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(rssis.length, i + half + 1);
    const slice = rssis.slice(lo, hi);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const std = Math.sqrt(variance);
    const motion = clamp(std / scale);
    return { t: smp.t, rssi: smp.rssi, motion, present: std >= thresh };
  });

  const durationSec = points.length ? points[points.length - 1].t : 0;
  const presentPct = Math.round((points.filter((p) => p.present).length / points.length) * 100);
  const movement = clamp(points.reduce((a, p) => a + p.motion, 0) / points.length);

  return {
    iface,
    ssid: s.ssid,
    bssid: s.bssid,
    points,
    durationSec,
    avgRssi,
    rssiMin,
    rssiMax,
    presentPct,
    movement,
  };
}

/** Sample the timeline at a wall-clock time (loops), for playback in the 3D view. */
export function sampleAt(tl: SenseTimeline, tSec: number): { motion: number; present: boolean; rssi: number } {
  if (!tl.points.length) return { motion: 0, present: false, rssi: tl.avgRssi ?? -60 };
  const dur = tl.durationSec || 1;
  const t = tSec % dur;
  // points are ~evenly spaced; find nearest.
  let lo = 0;
  let hi = tl.points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tl.points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const p = tl.points[lo];
  return { motion: p.motion, present: p.present, rssi: p.rssi };
}
