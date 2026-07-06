// Multi-vantage fusion → a real 2D home map from a single moving adapter.
//
// The honest trick for mapping with ONE single-antenna adapter (e.g. TL-WN721N):
// you can't triangulate from one spot (distance only, no bearing). But if you
// WALK the adapter to several marked spots and record RSSI→distance to each fixed
// transmitter at each spot, the transmitters become solvable anchors:
// trilaterating a device's distances from ≥3 known vantage positions fixes its
// 2D location (least squares). Fixed APs (routers + neighbors) and client
// stations both get placed. The coverage footprint = the area you walked and
// heard signal in = "wherever signal reaches."
//
// Limits (kept honest in the UI): positions are ESTIMATES (indoor RSSI is noisy),
// need ≥3 vantages that heard the device, and walls are NOT auto-drawn from this
// alone — the footprint + your sketched floor plan are the blueprint.
// Pure (no DB/IO), unit-testable. Authorized spaces only.

import { rssiToMeters, vendorForMac, deviceKind, type Survey, type DeviceKind, type PathLossOpts } from "@/lib/survey-core";

/** A capture taken at a known spot (user taps where they stood, in metres). */
export type Vantage = {
  id: string;
  x: number; // metres
  y: number; // metres
  survey: Survey;
};

export type PositionedDevice = {
  id: string; // BSSID (AP) or MAC (station)
  isAp: boolean;
  essid: string;
  vendor: string;
  kind: DeviceKind;
  channel: number | null;
  privacy: string;
  bestRssi: number; // strongest RSSI heard across vantages
  pos: { x: number; y: number } | null; // metres; null if not trilaterable
  positioned: boolean;
  vantagesHeard: number;
  /** trilateration residual (m) — lower = better geometric agreement. */
  residual: number | null;
  /** nearest single-vantage distance estimate (m), always available if heard. */
  nearestMeters: number | null;
};

export type HomeMap = {
  devices: PositionedDevice[];
  aps: PositionedDevice[];
  stations: PositionedDevice[];
  footprint: { x: number; y: number }[]; // convex hull of the walked vantages (m)
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  vantageCount: number;
  positionedCount: number;
  /** True once ≥3 vantages exist — the point at which trilateration is possible. */
  canPosition: boolean;
};

/**
 * Least-squares trilateration: given anchors at known (x,y) with measured range
 * r, solve for the point. Linearizes by subtracting the first anchor's equation,
 * then solves the 2×2 normal equations. Returns null with <3 anchors or a
 * degenerate (collinear) geometry. `residual` is the RMS range error (m).
 */
export function trilaterate(
  anchors: { x: number; y: number; r: number }[],
): { x: number; y: number; residual: number } | null {
  const pts = anchors.filter((a) => Number.isFinite(a.r) && a.r > 0);
  if (pts.length < 3) return null;

  const x0 = pts[0].x, y0 = pts[0].y, r0 = pts[0].r;
  // Rows: 2(xi-x0) X + 2(yi-y0) Y = r0^2 - ri^2 - x0^2 + xi^2 - y0^2 + yi^2
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = 2 * (pts[i].x - x0);
    const ay = 2 * (pts[i].y - y0);
    const bb =
      r0 * r0 - pts[i].r * pts[i].r -
      x0 * x0 + pts[i].x * pts[i].x -
      y0 * y0 + pts[i].y * pts[i].y;
    a11 += ax * ax; a12 += ax * ay; a22 += ay * ay;
    b1 += ax * bb; b2 += ay * bb;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-6) return null; // collinear anchors → no unique solution
  const x = (b1 * a22 - b2 * a12) / det;
  const y = (a11 * b2 - a12 * b1) / det;

  // RMS residual: how far the solved point's distances sit from the measured r.
  let sq = 0;
  for (const p of pts) {
    const d = Math.hypot(x - p.x, y - p.y);
    sq += (d - p.r) ** 2;
  }
  const residual = Math.round(Math.sqrt(sq / pts.length) * 10) / 10;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, residual };
}

/** Andrew's monotone-chain convex hull. Returns hull points CCW. */
export function convexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (pts.length < 3) return pts;
  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof pts = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof pts = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

type Agg = {
  isAp: boolean;
  essid: string;
  channel: number | null;
  privacy: string;
  bestRssi: number;
  anchors: { x: number; y: number; r: number }[];
  nearestMeters: number | null;
  nearestRssi: number;
};

/**
 * Fuse the vantages into a positioned device map. Every AP and station heard at
 * ≥3 vantages is trilaterated; others keep a nearest-vantage distance estimate.
 */
export function buildHomeMap(vantages: Vantage[], opts: PathLossOpts = {}): HomeMap {
  const byId = new Map<string, Agg>();

  const note = (
    id: string,
    isAp: boolean,
    power: number,
    v: Vantage,
    meta: { essid?: string; channel?: number | null; privacy?: string },
  ) => {
    if (!id || power >= 0) return;
    const r = rssiToMeters(power, opts);
    let a = byId.get(id);
    if (!a) {
      a = {
        isAp, essid: meta.essid ?? "", channel: meta.channel ?? null,
        privacy: meta.privacy ?? "", bestRssi: power, anchors: [],
        nearestMeters: r, nearestRssi: power,
      };
      byId.set(id, a);
    }
    if (meta.essid && !a.essid) a.essid = meta.essid;
    if (meta.channel != null && a.channel == null) a.channel = meta.channel;
    if (meta.privacy && !a.privacy) a.privacy = meta.privacy;
    if (power > a.bestRssi) a.bestRssi = power;
    if (power > a.nearestRssi && r != null) { a.nearestRssi = power; a.nearestMeters = r; }
    if (r != null) a.anchors.push({ x: v.x, y: v.y, r });
  };

  for (const v of vantages) {
    for (const ap of v.survey.aps ?? [])
      note(ap.bssid, true, ap.power, v, { essid: ap.essid, channel: ap.channel, privacy: ap.privacy });
    for (const st of v.survey.stations ?? [])
      note(st.mac, false, st.power, v, {});
  }

  const devices: PositionedDevice[] = [];
  for (const [id, a] of byId) {
    const sol = trilaterate(a.anchors);
    const vendor = vendorForMac(id);
    devices.push({
      id,
      isAp: a.isAp,
      essid: a.essid,
      vendor,
      kind: deviceKind(vendor, a.isAp),
      channel: a.channel,
      privacy: a.privacy,
      bestRssi: a.bestRssi,
      pos: sol ? { x: sol.x, y: sol.y } : null,
      positioned: !!sol,
      vantagesHeard: a.anchors.length,
      residual: sol ? sol.residual : null,
      nearestMeters: a.nearestMeters,
    });
  }
  // Strongest first — the devices closest / most reliably placed lead.
  devices.sort((x, y) => y.bestRssi - x.bestRssi);

  const vpts = vantages.map((v) => ({ x: v.x, y: v.y }));
  const footprint = convexHull(vpts);
  const xs = vpts.map((p) => p.x), ys = vpts.map((p) => p.y);
  const bounds = {
    minX: xs.length ? Math.min(...xs) : 0,
    minY: ys.length ? Math.min(...ys) : 0,
    maxX: xs.length ? Math.max(...xs) : 0,
    maxY: ys.length ? Math.max(...ys) : 0,
  };

  return {
    devices,
    aps: devices.filter((d) => d.isAp),
    stations: devices.filter((d) => !d.isAp),
    footprint,
    bounds,
    vantageCount: vantages.length,
    positionedCount: devices.filter((d) => d.positioned).length,
    canPosition: vantages.length >= 3,
  };
}
