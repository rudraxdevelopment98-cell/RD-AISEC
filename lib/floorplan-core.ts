// Floor-plan model for the WiFi-sensing "3D home" — rooms, walls, and WiFi node
// (anchor) positions in METRES. The 3D Observatory renders these as transparent
// glass walls and places sensed people inside the plan at real coordinates.
// Pure (no DB/IO), unit tested. For spaces you own or are authorized to monitor.

export type Vec2 = { x: number; y: number };

/** A rectangular room (top-left origin + size), metres. Its 4 edges are walls. */
export type Room = { id: string; name: string; x: number; y: number; w: number; h: number };

/** A WiFi node position — an access point ("ap") or a CSI receiver ("rx"). */
export type Anchor = { id: string; name: string; x: number; y: number; kind: "ap" | "rx" };

export type FloorPlan = {
  name: string;
  meters: { w: number; h: number }; // overall footprint
  height: number; // wall height, metres
  rooms: Room[];
  anchors: Anchor[];
};

export type WallSeg = { x1: number; y1: number; x2: number; y2: number };

const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

let idc = 0;
const uid = (p: string) => `${p}${(idc++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A sensible 2-bed apartment template so the user starts from something real. */
export function defaultPlan(): FloorPlan {
  return {
    name: "My home",
    meters: { w: 10, h: 8 },
    height: 2.6,
    rooms: [
      { id: uid("r"), name: "Living room", x: 0, y: 0, w: 5, h: 5 },
      { id: uid("r"), name: "Kitchen", x: 5, y: 0, w: 5, h: 3 },
      { id: uid("r"), name: "Bedroom", x: 5, y: 3, w: 5, h: 5 },
      { id: uid("r"), name: "Bathroom", x: 0, y: 5, w: 2.5, h: 3 },
      { id: uid("r"), name: "Hall", x: 2.5, y: 5, w: 2.5, h: 3 },
    ],
    anchors: [
      { id: uid("a"), name: "Router", x: 1, y: 1, kind: "ap" },
      { id: uid("a"), name: "CSI node", x: 8, y: 6, kind: "rx" },
    ],
  };
}

/** Bounding box of everything in the plan (metres). */
export function planBounds(plan: FloorPlan): { w: number; h: number } {
  let w = plan.meters.w, h = plan.meters.h;
  for (const r of plan.rooms) { w = Math.max(w, r.x + r.w); h = Math.max(h, r.y + r.h); }
  for (const a of plan.anchors) { w = Math.max(w, a.x); h = Math.max(h, a.y); }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** Derive de-duplicated wall segments from the room rectangles (each edge once). */
export function wallSegments(plan: FloorPlan): WallSeg[] {
  const seen = new Set<string>();
  const out: WallSeg[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    // Canonical key regardless of direction.
    const a = `${round(x1)},${round(y1)}`, b = `${round(x2)},${round(y2)}`;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2) });
  };
  for (const r of plan.rooms) {
    add(r.x, r.y, r.x + r.w, r.y);           // top
    add(r.x + r.w, r.y, r.x + r.w, r.y + r.h); // right
    add(r.x, r.y + r.h, r.x + r.w, r.y + r.h); // bottom
    add(r.x, r.y, r.x, r.y + r.h);           // left
  }
  return out;
}

/**
 * Place a sensed point in plan coordinates from an anchor + range + bearing.
 * `boresightDeg` is the direction (0 = +x, 90 = +y) the anchor's 0° faces; by
 * default it faces the plan centre. Returns metres, clamped to the footprint.
 */
export function placeInPlan(
  plan: FloorPlan,
  anchor: Anchor,
  rangeM: number,
  azimuthDeg: number,
  boresightDeg?: number,
): Vec2 {
  const b = planBounds(plan);
  const bore =
    boresightDeg != null
      ? (boresightDeg * Math.PI) / 180
      : Math.atan2(b.h / 2 - anchor.y, b.w / 2 - anchor.x);
  const ang = bore + (azimuthDeg * Math.PI) / 180;
  const x = anchor.x + Math.cos(ang) * rangeM;
  const y = anchor.y + Math.sin(ang) * rangeM;
  return { x: Math.max(0, Math.min(b.w, x)), y: Math.max(0, Math.min(b.h, y)) };
}

/** Normalise a metre point to 0..1 over the plan footprint (for 2D rendering). */
export function toNorm(plan: FloorPlan, p: Vec2): Vec2 {
  const b = planBounds(plan);
  return { x: p.x / b.w, y: p.y / b.h };
}

/** Which room (if any) contains a metre point — for "person is in the Kitchen". */
export function roomAt(plan: FloorPlan, p: Vec2): Room | null {
  for (const r of plan.rooms) {
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r;
  }
  return null;
}

/** Defensive parse of a stored/posted plan into a safe, clamped FloorPlan. */
export function normalizePlan(raw: unknown): FloorPlan {
  const o = (raw ?? {}) as Record<string, unknown>;
  const rooms = Array.isArray(o.rooms) ? (o.rooms as Record<string, unknown>[]) : [];
  const anchors = Array.isArray(o.anchors) ? (o.anchors as Record<string, unknown>[]) : [];
  const plan: FloorPlan = {
    name: String(o.name ?? "My home").slice(0, 60),
    meters: {
      w: clampNum((o.meters as Record<string, unknown>)?.w, 1, 60, 10),
      h: clampNum((o.meters as Record<string, unknown>)?.h, 1, 60, 8),
    },
    height: clampNum(o.height, 1.8, 6, 2.6),
    rooms: rooms.slice(0, 40).map((r) => ({
      id: String(r.id ?? uid("r")),
      name: String(r.name ?? "Room").slice(0, 40),
      x: clampNum(r.x, 0, 60, 0),
      y: clampNum(r.y, 0, 60, 0),
      w: clampNum(r.w, 0.3, 60, 3),
      h: clampNum(r.h, 0.3, 60, 3),
    })),
    anchors: anchors.slice(0, 16).map((a) => ({
      id: String(a.id ?? uid("a")),
      name: String(a.name ?? "Node").slice(0, 30),
      x: clampNum(a.x, 0, 60, 0),
      y: clampNum(a.y, 0, 60, 0),
      kind: a.kind === "rx" ? "rx" : "ap",
    })),
  };
  if (!plan.rooms.length) return defaultPlan();
  return plan;
}
