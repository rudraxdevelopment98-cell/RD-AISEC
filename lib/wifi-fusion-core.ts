// "WiFi camera" spatial layer — turns RSSI/motion analysis into a top-down
// occupancy heatmap and, when several access points are heard, into real 2D
// zones + person markers by multilateration. Pure (no DB/IO), unit tested.
//
// Honesty about physics:
//   • ONE access point + RSSI gives motion, range and a bearing-agnostic RADIAL
//     field (a ring at the estimated distance) — not a true x/y point.
//   • SEVERAL access points (the runner hears many BSSIDs) each give a distance;
//     intersecting their range rings over a grid localizes movement into real
//     zones — commodity multilateration, no special hardware.
//   • True imaging (pose/skeleton) needs CSI — see wifi-csi-core.
//
// For use only in spaces you own or are authorized to monitor.

import type { SenseAnalysis } from "@/lib/wifi-sense-core";

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

export type Grid = {
  w: number;
  h: number;
  /** Room extent in metres (width, height) the grid maps onto. */
  meters: { w: number; h: number };
  /** Row-major intensity 0..1, length w*h. */
  cells: number[];
};

export type Marker = {
  /** Normalised 0..1 position in the grid (x right, y down). */
  x: number;
  y: number;
  intensity: number; // 0..1
  /** Approx metres from grid origin (top-left). */
  meters: { x: number; y: number };
};

export type SpatialFrame = {
  grid: Grid;
  markers: Marker[];
  /** Access-point anchor positions used, normalised 0..1 (for drawing). */
  anchors: { x: number; y: number; label: string }[];
  /** Estimated number of distinct movers in the scene. */
  occupancy: number;
  mode: "radial" | "multilateration";
};

function emptyGrid(w: number, h: number, meters: { w: number; h: number }): Grid {
  return { w, h, meters, cells: new Array(w * h).fill(0) };
}

/** Place N access-point anchors evenly around the room perimeter. */
function perimeterAnchors(count: number): { x: number; y: number; label: string }[] {
  const pts: { x: number; y: number; label: string }[] = [];
  const c = Math.max(1, count);
  for (let i = 0; i < c; i++) {
    const frac = i / c;
    // Walk the unit-square perimeter.
    let x: number, y: number;
    const p = frac * 4;
    if (p < 1) { x = p; y = 0; }
    else if (p < 2) { x = 1; y = p - 1; }
    else if (p < 3) { x = 3 - p; y = 1; }
    else { x = 0; y = 4 - p; }
    pts.push({ x, y, label: `AP${i + 1}` });
  }
  return pts;
}

/**
 * Single-AP radial field: motion energy is spread over a ring at the estimated
 * range from one anchor (top-centre). Represents "something is moving ~this far
 * away" without inventing a bearing.
 */
export function occupancyField(
  a: SenseAnalysis,
  opts: { w?: number; h?: number; roomM?: number } = {},
): SpatialFrame {
  const w = opts.w ?? 40;
  const h = opts.h ?? 30;
  const roomM = opts.roomM ?? 8; // assume an ~8 m room span
  const grid = emptyGrid(w, h, { w: roomM, h: roomM * (h / w) });
  const anchor = { x: 0.5, y: 0.04, label: "AP" };

  const present = a.presentPct > 12 && a.movement > 0.03;
  if (!present) {
    return { grid, markers: [], anchors: [anchor], occupancy: 0, mode: "radial" };
  }

  // Ring radius (normalised) from the range estimate, clamped into the room.
  const rNorm = a.rangeMeters != null ? clamp(a.rangeMeters / roomM, 0.12, 0.95) : 0.5;
  const ax = anchor.x * w, ay = anchor.y * h;
  const ringPx = rNorm * Math.min(w, h);
  const sigma = Math.max(1.5, ringPx * 0.22 + a.movement * 3);
  const amp = clamp(0.25 + a.movement * 0.9);

  let best = 0, bx = 0, by = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - ax, y - ay);
      const val = amp * Math.exp(-((d - ringPx) ** 2) / (2 * sigma * sigma));
      grid.cells[y * w + x] = clamp(val);
      if (val > best) { best = val; bx = x; by = y; }
    }
  }
  const markers: Marker[] =
    best > 0.35
      ? [{ x: bx / w, y: by / h, intensity: best, meters: { x: (bx / w) * roomM, y: (by / h) * grid.meters.h } }]
      : [];
  return { grid, markers, anchors: [anchor], occupancy: markers.length ? Math.max(1, a.personEstimate) : 0, mode: "radial" };
}

/**
 * Multi-AP fusion: each analysis is a distance ring from its own perimeter
 * anchor; overlaps localise movers into 2D zones. Produces a real occupancy
 * heatmap + person markers at the intersections. Needs ≥2 senses with a range.
 */
export function fuseSenses(
  senses: SenseAnalysis[],
  opts: { w?: number; h?: number; roomM?: number } = {},
): SpatialFrame {
  const active = senses.filter((s) => s.rangeMeters != null);
  if (active.length < 2) {
    // Fall back to the single-AP radial field.
    const first = senses[0];
    if (!first) {
      const w = opts.w ?? 40, h = opts.h ?? 30, roomM = opts.roomM ?? 8;
      return { grid: emptyGrid(w, h, { w: roomM, h: roomM }), markers: [], anchors: [], occupancy: 0, mode: "radial" };
    }
    return occupancyField(first, opts);
  }

  const w = opts.w ?? 44;
  const h = opts.h ?? 32;
  const roomM = opts.roomM ?? 10;
  const grid = emptyGrid(w, h, { w: roomM, h: roomM * (h / w) });
  const anchors = perimeterAnchors(active.length);
  const diagPx = Math.hypot(w, h);

  // Each AP contributes a ring at its normalised range; the product across APs
  // (soft-AND) lights only cells consistent with ALL distances → an intersection.
  const rings = active.map((a, i) => {
    const rNorm = clamp((a.rangeMeters as number) / roomM, 0.08, 1.1);
    const motion = clamp(0.12 + a.movement);
    const anchor = anchors[i];
    return { ax: anchor.x * w, ay: anchor.y * h, ringPx: rNorm * Math.min(w, h) * 1.15, motion };
  });

  let best = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 1;
      let motionSum = 0;
      for (const r of rings) {
        const d = Math.hypot(x - r.ax, y - r.ay);
        const sigma = Math.max(2, diagPx * 0.09);
        const ring = Math.exp(-((d - r.ringPx) ** 2) / (2 * sigma * sigma));
        acc *= 0.15 + 0.85 * ring; // soft-AND: all rings must roughly agree
        motionSum += r.motion;
      }
      const val = clamp(Math.pow(acc, 0.7) * (motionSum / rings.length) * 1.6);
      grid.cells[y * w + x] = val;
      if (val > best) best = val;
    }
  }

  // Extract person markers as local maxima above a fraction of the peak.
  const markers = localMaxima(grid, Math.max(0.28, best * 0.55), roomM);
  const occupancy = Math.min(markers.length, 4);
  return { grid, markers, anchors, occupancy, mode: "multilateration" };
}

/** Non-maximum suppression: peaks above `thresh`, spaced apart. */
function localMaxima(grid: Grid, thresh: number, roomM: number): Marker[] {
  const { w, h, cells } = grid;
  const found: Marker[] = [];
  const minGap = Math.max(3, Math.floor(Math.min(w, h) * 0.18));
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = cells[y * w + x];
      if (v < thresh) continue;
      let isMax = true;
      for (let dy = -1; dy <= 1 && isMax; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (cells[(y + dy) * w + (x + dx)] > v) { isMax = false; break; }
        }
      if (!isMax) continue;
      if (found.some((m) => Math.hypot(m.x * w - x, m.y * h - y) < minGap)) continue;
      found.push({ x: x / w, y: y / h, intensity: v, meters: { x: (x / w) * roomM, y: (y / h) * grid.meters.h } });
    }
  }
  return found.sort((a, b) => b.intensity - a.intensity).slice(0, 4);
}
