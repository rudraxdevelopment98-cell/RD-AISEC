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
  const shortWin = Math.max(3, Math.round(rate)); // ~1s: movement energy
  const longWin = Math.max(shortWin * 3, Math.round(rate * 3)); // ~3s: slow baseline
  const halfS = Math.floor(shortWin / 2);
  const halfL = Math.floor(longWin / 2);
  const highT = opts.motionThresh ?? 1.2; // dB std-dev to turn presence ON
  const lowT = highT * 0.5; // hysteresis: turn OFF below this
  const scale = opts.scale ?? 3.5; // dB std-dev that maps to full motion

  const rssis = s.samples.map((x) => x.rssi);
  const avgRssi = Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length);
  const rssiMin = Math.min(...rssis);
  const rssiMax = Math.max(...rssis);

  // Detrend: subtract a slow (~3s) baseline so gradual AP-power drift / distance
  // changes don't read as "motion" — only the fast fluctuation that movement in
  // the multipath actually causes survives.
  const detr = rssis.map((v, i) => {
    const lo = Math.max(0, i - halfL);
    const hi = Math.min(rssis.length, i + halfL + 1);
    let sum = 0;
    for (let k = lo; k < hi; k++) sum += rssis[k];
    return v - sum / (hi - lo);
  });

  // Short-window std of the detrended signal → motion. Presence uses hysteresis
  // (on above highT, off below lowT) so it doesn't flicker at the boundary.
  let present = false;
  const points: MotionPoint[] = s.samples.map((smp, i) => {
    const lo = Math.max(0, i - halfS);
    const hi = Math.min(detr.length, i + halfS + 1);
    let mean = 0;
    for (let k = lo; k < hi; k++) mean += detr[k];
    mean /= hi - lo;
    let variance = 0;
    for (let k = lo; k < hi; k++) variance += (detr[k] - mean) ** 2;
    variance /= hi - lo;
    const std = Math.sqrt(variance);
    if (std >= highT) present = true;
    else if (std <= lowT) present = false;
    return { t: smp.t, rssi: smp.rssi, motion: clamp(std / scale), present };
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

// ── Precise real-signal analysis ────────────────────────────────────────────
// A small DSP layer that pulls far more than a single motion number out of the
// same RSSI stream: a Doppler-based SPEED estimate, movement DIRECTION (toward /
// away from the AP), a coarse RANGE, a BREATHING rate when the subject is still,
// a PERSON-count estimate, an ACTIVITY class, and a CONFIDENCE. Everything here
// is derived from real hardware samples — no simulation. Honest about limits:
// one AP + RSSI gives motion/vitals/coarse range, not true x/y position (that
// needs multi-AP fusion or CSI — see wifi-fusion-core / wifi-csi-core).

/** Goertzel single-bin power at frequency f (Hz) over an evenly-sampled series. */
function goertzelPower(x: number[], f: number, fs: number): number {
  if (x.length < 4 || f <= 0 || f >= fs / 2) return 0;
  const w = (2 * Math.PI * f) / fs;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return power / x.length;
}

/** Dominant frequency (Hz) of a detrended series by scanning a band with Goertzel. */
function dominantFreq(x: number[], fs: number, loHz: number, hiHz: number, steps = 24): { f: number; power: number; total: number } {
  let bestF = 0, bestP = 0, total = 0;
  const hi = Math.min(hiHz, fs / 2 - 0.01);
  for (let i = 0; i <= steps; i++) {
    const f = loHz + ((hi - loHz) * i) / steps;
    const p = goertzelPower(x, f, fs);
    total += p;
    if (p > bestP) { bestP = p; bestF = f; }
  }
  return { f: bestF, power: bestP, total };
}

/** Mean + population std of a series. */
function meanStd(x: number[]): { mean: number; std: number } {
  if (!x.length) return { mean: 0, std: 0 };
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  let v = 0;
  for (const n of x) v += (n - mean) ** 2;
  return { mean, std: Math.sqrt(v / x.length) };
}

export type Direction = "approaching" | "receding" | "lateral" | "none";
export type Activity = "empty" | "still" | "breathing" | "walking" | "running" | "fall";

export type SenseAnalysis = SenseTimeline & {
  /** Sample rate actually used (Hz). */
  fs: number;
  /** Approximate speed of the moving reflector (m/s) — coarse, band-limited. */
  speedMps: number;
  /** Qualitative speed bucket that doesn't over-claim precision. */
  speedLabel: "still" | "slow" | "walking" | "fast";
  /** Movement direction relative to the AP, from the slow RSSI trend. */
  direction: Direction;
  /** Coarse distance to the link (m) from log-distance path loss. */
  rangeMeters: number | null;
  /** Estimated breaths/min when a still subject is present (else null). */
  breathingBpm: number | null;
  /** 0 / 1 / 2 (2 = "two or more"), a heuristic — low confidence by nature. */
  personEstimate: number;
  /** Dominant activity across the window. */
  activity: Activity;
  /** 0..1 confidence in the analysis (samples, link quality, motion SNR). */
  confidence: number;
  /** Peak instantaneous motion in the window (0..1). */
  peakMotion: number;
};

/**
 * Full precision analysis of one real RSSI capture. Builds on motionTimeline and
 * adds Doppler speed, direction, range, breathing, a person estimate, an activity
 * class, and a confidence. `band` picks the wavelength for the speed estimate.
 */
export function analyzeMotion(
  s: WifiSense,
  opts: { motionThresh?: number; scale?: number; band?: "2.4" | "5"; txPowerDbm?: number; pathLossN?: number } = {},
): SenseAnalysis {
  const tl = motionTimeline(s, opts);
  const fs = s.rate && s.rate > 0 ? s.rate : 10;
  const base: SenseAnalysis = {
    ...tl,
    fs,
    speedMps: 0,
    speedLabel: "still",
    direction: "none",
    rangeMeters: null,
    breathingBpm: null,
    personEstimate: 0,
    activity: tl.error ? "empty" : "empty",
    confidence: 0,
    peakMotion: 0,
  };
  if (tl.error || tl.points.length < 8) return base;

  const rssis = tl.points.map((p) => p.rssi);
  const n = rssis.length;

  // Detrend against a ~3s baseline (same idea as the timeline) so only movement
  // fluctuation feeds the frequency analysis.
  const halfL = Math.max(3, Math.floor(fs * 1.5));
  const detr = rssis.map((v, i) => {
    const lo = Math.max(0, i - halfL), hi = Math.min(n, i + halfL + 1);
    let sum = 0;
    for (let k = lo; k < hi; k++) sum += rssis[k];
    return v - sum / (hi - lo);
  });
  const { std: fluct } = meanStd(detr);

  // Speed via Doppler: the dominant fluctuation frequency f_d of the movement
  // band maps to reflector speed v = f_d * λ / 2. RSSI is band-limited (~fs/2),
  // so this is a COARSE lower-bound speed, reported qualitatively too.
  const lambda = opts.band === "5" ? 0.06 : 0.125; // m, 5 GHz vs 2.4 GHz
  const move = dominantFreq(detr, fs, 0.6, Math.min(4.5, fs / 2 - 0.1));
  const speedMps = Math.max(0, (move.f * lambda) / 2);
  const peakMotion = tl.points.reduce((m, p) => (p.motion > m ? p.motion : m), 0);

  // Direction from the slow trend: compare the first vs last third of RSSI.
  const third = Math.max(2, Math.floor(n / 3));
  const startAvg = rssis.slice(0, third).reduce((a, b) => a + b, 0) / third;
  const endAvg = rssis.slice(n - third).reduce((a, b) => a + b, 0) / third;
  const drift = endAvg - startAvg; // + = RSSI rose = closer
  let direction: Direction = "none";
  if (tl.presentPct > 15) {
    if (drift > 2) direction = "approaching";
    else if (drift < -2) direction = "receding";
    else direction = "lateral";
  }

  // Range from log-distance path loss: d = 10^((Tx - RSSI)/(10n)).
  const txPower = opts.txPowerDbm ?? -40; // dBm at 1 m (typical indoor AP)
  const nExp = opts.pathLossN ?? 2.6;
  const rangeMeters =
    tl.avgRssi != null ? Math.round(Math.pow(10, (txPower - tl.avgRssi) / (10 * nExp)) * 10) / 10 : null;

  // Breathing: chest motion is a tiny (sub-dB), periodic 0.15–0.5 Hz signal, well
  // BELOW the gross-motion presence threshold — so it gets its own sensitive
  // gate. It's only meaningful when the subject is fairly still (not walking):
  // require low overall fluctuation, a real fluctuation floor (not dead-silent),
  // and a dominant, clean spectral peak in the breathing band.
  let breathingBpm: number | null = null;
  const stillEnough = fluct < 1.6 && fluct > 0.12 && tl.movement < 0.25;
  if (stillEnough && fs > 1.2) {
    const br = dominantFreq(detr, fs, 0.15, 0.6, 18);
    const bandDom = br.total > 0 ? br.power / br.total : 0;
    // Compare the breathing band to the walking band to reject gait leakage.
    const gait = dominantFreq(detr, fs, 0.8, Math.min(3, fs / 2 - 0.1), 12);
    if (bandDom > 0.22 && br.power >= gait.power * 0.8) {
      breathingBpm = Math.round(br.f * 60);
    }
  }

  // Person estimate (heuristic, low confidence): none / one / two+.
  let personEstimate = 0;
  if (tl.presentPct > 12) {
    personEstimate = 1;
    // Sustained high motion with broad-band fluctuation hints at >1 mover.
    if (tl.movement > 0.45 && fluct > 2.6 && peakMotion > 0.8) personEstimate = 2;
  }

  // Activity classification.
  let activity: Activity = "empty";
  if (tl.presentPct <= 12) activity = "empty";
  else if (speedMps > 1.2 || tl.movement > 0.6) activity = "running";
  else if (speedMps > 0.35 || tl.movement > 0.28) activity = "walking";
  else if (breathingBpm != null) activity = "breathing";
  else activity = "still";
  // Fall: a burst of strong motion followed by sudden stillness.
  const q = Math.max(4, Math.floor(n / 4));
  const early = tl.points.slice(0, n - q).reduce((m, p) => (p.motion > m ? p.motion : m), 0);
  const lateAvg = tl.points.slice(n - q).reduce((a, p) => a + p.motion, 0) / q;
  if (early > 0.7 && lateAvg < 0.12 && tl.presentPct > 20) activity = "fall";

  // Speed label without over-claiming the m/s figure.
  const speedLabel =
    activity === "empty" || activity === "still" || activity === "breathing"
      ? "still"
      : speedMps > 1.2
        ? "fast"
        : speedMps > 0.35
          ? "walking"
          : "slow";

  // Confidence: link quality + sample count + motion SNR.
  const qualAvg = s.samples && s.samples.length ? s.samples.reduce((a, x) => a + (x.q || 0), 0) / s.samples.length : 0;
  const snr = clamp(fluct / 4); // more clean fluctuation → more confident
  const conf =
    0.4 * clamp(qualAvg / 70) + 0.3 * clamp(n / (fs * 15)) + 0.3 * (tl.presentPct > 8 ? snr : clamp(1 - snr));
  const confidence = Math.round(clamp(conf) * 100) / 100;

  return {
    ...tl,
    fs,
    speedMps: Math.round(speedMps * 100) / 100,
    speedLabel,
    direction,
    rangeMeters,
    breathingBpm,
    personEstimate,
    activity,
    confidence,
    peakMotion: Math.round(peakMotion * 100) / 100,
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
