// CSI imaging engine — the real "WiFi camera" path when Channel State
// Information hardware is present (ESP32-CSI, nexmon, Intel 5300, Atheros,
// PicoScenes). CSI gives per-subcarrier amplitude + phase across RX antennas, so
// unlike RSSI we can recover Doppler VELOCITY, ANGLE-OF-ARRIVAL (a real bearing),
// 2D position, multiple targets, and breathing/heart from phase. Pure (no
// DB/IO), unit tested. For use only in spaces you own or are authorized to
// monitor.
//
// Standard ingestion contract (a device/collector POSTs an array of these):
//   CsiFrame = { t, rssi?, nsub, nrx, amp:number[nrx][nsub], phase?:number[nrx][nsub] }
//   amp   = subcarrier amplitude (linear or dB), phase = radians.

import type { Grid, SpatialFrame, Marker } from "@/lib/wifi-fusion-core";

const TAU = Math.PI * 2;
const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export type CsiFrame = {
  t: number;
  rssi?: number;
  nsub: number;
  nrx: number;
  amp: number[][]; // [antenna][subcarrier]
  phase?: number[][]; // [antenna][subcarrier], radians
};

export type CsiTarget = {
  /** Bearing from the array boresight, degrees (−90..+90). */
  azimuthDeg: number;
  rangeMeters: number;
  velocityMps: number; // + = approaching
  intensity: number; // 0..1 motion energy
  x: number; // normalised 0..1 in the occupancy grid
  y: number;
};

export type CsiAnalysis = {
  frames: number;
  fs: number; // frame rate, Hz
  nsub: number;
  nrx: number;
  present: boolean;
  motion: number; // 0..1 overall
  /** Dominant Doppler velocity of the strongest mover (m/s, signed). */
  velocityMps: number;
  /** Angle of arrival of the strongest mover (deg), or null if <2 antennas. */
  azimuthDeg: number | null;
  rangeMeters: number | null;
  breathingBpm: number | null;
  heartBpm: number | null;
  occupancy: number; // people detected
  targets: CsiTarget[];
  spatial: SpatialFrame; // top-down occupancy grid + markers (real 2D)
  quality: number; // 0..1 confidence
  error?: string;
};

// ── small DSP ───────────────────────────────────────────────────────────────
function meanStd(x: number[]): { mean: number; std: number } {
  if (!x.length) return { mean: 0, std: 0 };
  const mean = x.reduce((a, b) => a + b, 0) / x.length;
  let v = 0;
  for (const n of x) v += (n - mean) ** 2;
  return { mean, std: Math.sqrt(v / x.length) };
}
function goertzel(x: number[], f: number, fs: number): number {
  if (x.length < 4 || f <= 0 || f >= fs / 2) return 0;
  const w = (TAU * f) / fs, coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / x.length;
}
function dominantFreq(x: number[], fs: number, lo: number, hi: number, steps = 24): { f: number; power: number; total: number } {
  let bestF = 0, bestP = 0, total = 0;
  const top = Math.min(hi, fs / 2 - 1e-3);
  for (let i = 0; i <= steps; i++) {
    const f = lo + ((top - lo) * i) / steps;
    const p = goertzel(x, f, fs);
    total += p;
    if (p > bestP) { bestP = p; bestF = f; }
  }
  return { f: bestF, power: bestP, total };
}
/** Unwrap a phase series to remove ±2π jumps. */
function unwrap(p: number[]): number[] {
  const out = p.slice();
  for (let i = 1; i < out.length; i++) {
    let d = out[i] - out[i - 1];
    while (d > Math.PI) { out[i] -= TAU; d -= TAU; }
    while (d < -Math.PI) { out[i] += TAU; d += TAU; }
  }
  return out;
}
/** Least-squares slope of y over evenly-spaced samples (per sample). */
function slope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  let my = 0;
  for (const v of y) my += v;
  my /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - mx) * (y[i] - my); den += (i - mx) ** 2; }
  return den ? num / den : 0;
}

function emptyGrid(w: number, h: number, roomM: number): Grid {
  return { w, h, meters: { w: roomM, h: roomM }, cells: new Array(w * h).fill(0) };
}

/**
 * Analyse a batch of CSI frames into motion, Doppler velocity, angle-of-arrival,
 * range, vitals, multiple targets, and a real 2D occupancy grid.
 *
 * opts.band picks the wavelength (2.4/5 GHz); opts.antSpacing is the RX antenna
 * spacing in wavelengths (0.5 = λ/2, the usual array) for the AoA math.
 */
export function analyzeCsi(
  frames: CsiFrame[],
  opts: { band?: "2.4" | "5"; antSpacing?: number; roomM?: number; txPowerDbm?: number; pathLossN?: number } = {},
): CsiAnalysis {
  const w = 44, h = 32;
  const roomM = opts.roomM ?? 8;
  const blank: CsiAnalysis = {
    frames: frames.length, fs: 0, nsub: 0, nrx: 0, present: false, motion: 0,
    velocityMps: 0, azimuthDeg: null, rangeMeters: null, breathingBpm: null, heartBpm: null,
    occupancy: 0, targets: [], spatial: { grid: emptyGrid(w, h, roomM), markers: [], anchors: [{ x: 0.5, y: 0.02, label: "RX" }], occupancy: 0, mode: "radial" },
    quality: 0,
  };
  if (!Array.isArray(frames) || frames.length < 16) return { ...blank, error: "need ≥16 CSI frames" };

  const nsub = frames[0].nsub || (frames[0].amp?.[0]?.length ?? 0);
  const nrx = Math.max(1, frames[0].nrx || frames[0].amp?.length || 1);
  if (!nsub) return { ...blank, error: "empty CSI frames" };

  // Frame rate from timestamps.
  const t0 = frames[0].t, tN = frames[frames.length - 1].t;
  const fs = tN > t0 ? (frames.length - 1) / (tN - t0) : 20;

  const lambda = opts.band === "5" ? 0.06 : 0.125;
  const d = (opts.antSpacing ?? 0.5) * lambda; // antenna spacing (m)

  // Per-subcarrier amplitude time-series (antenna 0) → motion via variance.
  const ampTS: number[][] = []; // [subcarrier][time]
  for (let k = 0; k < nsub; k++) {
    const series: number[] = [];
    for (const f of frames) series.push(f.amp?.[0]?.[k] ?? 0);
    ampTS.push(series);
  }
  // Normalised per-subcarrier motion (std / mean), robust-averaged.
  const subMotion = ampTS.map((s) => {
    const { mean, std } = meanStd(s);
    return mean > 1e-6 ? std / Math.abs(mean) : std;
  });
  const motionSorted = [...subMotion].sort((a, b) => a - b);
  const medMotion = motionSorted[Math.floor(nsub / 2)] || 0;
  const motion = clamp(medMotion * 6); // scale to 0..1 (empirical)
  const present = motion > 0.06;

  // Pick the most-active subcarrier for vitals + Doppler.
  let bestK = 0, bestV = -1;
  subMotion.forEach((m, k) => { if (m > bestV) { bestV = m; bestK = k; } });
  const active = ampTS[bestK].map((v, i) => v - meanStd(ampTS[bestK]).mean);

  // Doppler velocity: dominant fluctuation freq of the active subcarrier → speed;
  // sign from the phase slope (rising unwrapped phase = approaching).
  const move = dominantFreq(active, fs, 0.3, Math.min(6, fs / 2 - 0.1));
  let sign = 1;
  if (frames[0].phase) {
    const ph = unwrap(frames.map((f) => f.phase?.[0]?.[bestK] ?? 0));
    sign = slope(ph) >= 0 ? 1 : -1;
  }
  const velocityMps = present ? sign * Math.round(((move.f * lambda) / 2) * 100) / 100 : 0;

  // Angle of arrival: phase difference between antennas 0 and 1 for the active
  // subcarrier, averaged over time (moving component). θ = asin(Δφ·λ / (2π d)).
  let azimuthDeg: number | null = null;
  if (nrx >= 2 && frames[0].phase) {
    let acc = 0, cnt = 0;
    for (const f of frames) {
      const p0 = f.phase?.[0]?.[bestK], p1 = f.phase?.[1]?.[bestK];
      if (p0 == null || p1 == null) continue;
      let dphi = p1 - p0;
      while (dphi > Math.PI) dphi -= TAU;
      while (dphi < -Math.PI) dphi += TAU;
      acc += dphi; cnt++;
    }
    if (cnt) {
      const dphi = acc / cnt;
      const s = (dphi * lambda) / (TAU * d);
      azimuthDeg = Math.round(Math.asin(clamp(s, -1, 1)) * (180 / Math.PI) * 10) / 10;
    }
  }

  // Range from RSSI path loss (if present) else amplitude proxy.
  const rssiAvg = frames.reduce((a, f) => a + (f.rssi ?? NaN), 0) / frames.length;
  const txPower = opts.txPowerDbm ?? -40, nExp = opts.pathLossN ?? 2.6;
  const rangeMeters = Number.isFinite(rssiAvg)
    ? Math.round(Math.pow(10, (txPower - rssiAvg) / (10 * nExp)) * 10) / 10
    : present ? Math.round(clamp(1 - motion) * roomM * 10) / 10 : null;

  // Vitals from the active subcarrier: breathing 0.15–0.5 Hz, heart 0.9–2.0 Hz.
  // Detect each band's peak and accept only when it stands well above a noise
  // floor sampled BETWEEN the bands (robust to spectral leakage from the other
  // rhythm). Gross walking motion masks vitals — that's expected.
  let breathingBpm: number | null = null, heartBpm: number | null = null;
  if (present && fs > 2) {
    const noise = goertzel(active, 0.7, fs) + 1e-9; // between breathing & heart
    const br = dominantFreq(active, fs, 0.15, 0.5, 18);
    if (br.power > noise * 2 && br.f > 0) breathingBpm = Math.round(br.f * 60);
    if (fs > 4.5) {
      const noiseH = goertzel(active, 2.6, fs) + 1e-9; // above the heart band
      const hr = dominantFreq(active, fs, 0.9, 2.0, 18);
      if (hr.power > noiseH * 2 && hr.f > 0) heartBpm = Math.round(hr.f * 60);
    }
  }

  // Multi-target: histogram per-subcarrier instantaneous AoA (needs ≥2 ant),
  // weighted by that subcarrier's motion; count separated peaks. Fallback: 0/1
  // from motion when AoA isn't available.
  const targets: CsiTarget[] = [];
  const grid = emptyGrid(w, h, roomM);
  const rxAnchor = { x: 0.5, y: 0.02, label: "RX" };

  if (present) {
    const detections: { az: number; intensity: number }[] = [];
    if (nrx >= 2 && frames[0].phase) {
      // AoA per subcarrier from mean phase diff, weighted by subcarrier motion.
      const bins = new Array(37).fill(0); // −90..+90 in 5° bins
      for (let k = 0; k < nsub; k++) {
        if (subMotion[k] < medMotion * 0.8) continue;
        let acc = 0, cnt = 0;
        for (const f of frames) {
          const p0 = f.phase?.[0]?.[k], p1 = f.phase?.[1]?.[k];
          if (p0 == null || p1 == null) continue;
          let dphi = p1 - p0;
          while (dphi > Math.PI) dphi -= TAU;
          while (dphi < -Math.PI) dphi += TAU;
          acc += dphi; cnt++;
        }
        if (!cnt) continue;
        const s = ((acc / cnt) * lambda) / (TAU * d);
        const az = Math.asin(clamp(s, -1, 1)) * (180 / Math.PI);
        const bin = clamp(Math.round((az + 90) / 5), 0, 36);
        bins[bin] += subMotion[k];
      }
      // Peaks = local maxima above a fraction of the max bin.
      const maxBin = Math.max(...bins);
      for (let b = 1; b < 36; b++) {
        if (bins[b] > maxBin * 0.45 && bins[b] >= bins[b - 1] && bins[b] >= bins[b + 1]) {
          detections.push({ az: b * 5 - 90, intensity: clamp(bins[b] / (maxBin || 1)) });
        }
      }
    }
    if (!detections.length) {
      detections.push({ az: azimuthDeg ?? 0, intensity: clamp(0.4 + motion) });
    }

    const rng = rangeMeters ?? roomM * 0.5;
    for (const det of detections.slice(0, 4)) {
      const rad = (det.az * Math.PI) / 180;
      // RX at top-centre looking "down" into the room; +az → right.
      const nx = clamp(0.5 + (Math.sin(rad) * rng) / roomM, 0.02, 0.98);
      const ny = clamp(0.02 + (Math.cos(rad) * rng) / roomM, 0.02, 0.98);
      targets.push({
        azimuthDeg: Math.round(det.az * 10) / 10,
        rangeMeters: Math.round(rng * 10) / 10,
        velocityMps,
        intensity: det.intensity,
        x: nx, y: ny,
      });
    }

    // Paint the occupancy grid with a Gaussian per target.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (const tg of targets) {
          const dx = x - tg.x * w, dy = y - tg.y * h;
          v += tg.intensity * Math.exp(-(dx * dx + dy * dy) / (2 * 5 * 5));
        }
        grid.cells[y * w + x] = clamp(v);
      }
  }

  const markers: Marker[] = targets.map((t) => ({
    x: t.x, y: t.y, intensity: t.intensity, meters: { x: t.x * roomM, y: t.y * roomM },
  }));
  const spatial: SpatialFrame = {
    grid, markers, anchors: [rxAnchor],
    occupancy: targets.length,
    mode: nrx >= 2 ? "multilateration" : "radial",
  };

  // Quality: subcarrier count, antennas, frames, motion SNR.
  const quality =
    clamp(nsub / 56) * 0.3 + clamp(nrx / 3) * 0.25 + clamp(frames.length / (fs * 6)) * 0.25 +
    (present ? clamp(motion) : clamp(1 - motion)) * 0.2;

  return {
    frames: frames.length, fs: Math.round(fs * 10) / 10, nsub, nrx,
    present, motion: Math.round(motion * 100) / 100,
    velocityMps, azimuthDeg, rangeMeters, breathingBpm, heartBpm,
    occupancy: targets.length, targets, spatial,
    quality: Math.round(clamp(quality) * 100) / 100,
  };
}

/** Validate + coerce an incoming CSI payload into frames (defensive parsing). */
export function parseCsiFrames(body: unknown): CsiFrame[] {
  const raw = (body as { frames?: unknown })?.frames ?? body;
  if (!Array.isArray(raw)) return [];
  const out: CsiFrame[] = [];
  for (const f of raw as Record<string, unknown>[]) {
    if (!f || !Array.isArray(f.amp)) continue;
    const amp = (f.amp as unknown[]).map((row) => (Array.isArray(row) ? row.map(Number) : [])).filter((r) => r.length);
    if (!amp.length) continue;
    const phase = Array.isArray(f.phase)
      ? (f.phase as unknown[]).map((row) => (Array.isArray(row) ? row.map(Number) : []))
      : undefined;
    out.push({
      t: Number(f.t) || out.length,
      rssi: f.rssi != null ? Number(f.rssi) : undefined,
      nsub: Number(f.nsub) || amp[0].length,
      nrx: Number(f.nrx) || amp.length,
      amp,
      phase,
    });
    if (out.length >= 2000) break; // sane cap
  }
  return out;
}
