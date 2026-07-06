// Radio Tomographic Imaging (RTI) — automatic floor mapping from "signal flow".
//
// Physics (Wilson & Patwari): place several WiFi nodes around a space and measure
// the RSSI of every node→node link. A wall (or any obstruction) crossing a link
// adds EXTRA attenuation beyond free-space. Many overlapping links form a
// tomographic system: back-projecting each link's excess attenuation over the
// cells near its line, then summing, reconstructs a 2D attenuation image where
// walls light up. From that we derive a candidate footprint the user refines.
//
// Honest limits: needs several nodes (≈4+), positions must be known, and the
// result is COARSE — good for "where are the walls roughly", not survey-grade.
// Pure (no DB/IO), unit tested. Authorized spaces only.

export type RtiNode = { id: string; x: number; y: number }; // metres
export type RtiLink = { tx: string; rx: string; rssi: number; baseline?: number };

export type RtiGrid = {
  w: number;
  h: number;
  meters: { w: number; h: number };
  origin: { x: number; y: number }; // metres of cell (0,0)
  cells: number[]; // row-major attenuation, normalised 0..1
};

const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);

/** Free-space expected RSSI (dBm) at distance d (m) — the no-wall baseline. */
export function freeSpaceRssi(distM: number, txPowerDbm: number, n: number): number {
  const d = Math.max(0.3, distM);
  return txPowerDbm - 10 * n * Math.log10(d);
}

/** Bounding box of the nodes, padded by `margin` metres. */
export function nodeBounds(nodes: RtiNode[], margin = 1): { x: number; y: number; w: number; h: number } {
  if (!nodes.length) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
  }
  return { x: minX - margin, y: minY - margin, w: maxX - minX + 2 * margin, h: maxY - minY + 2 * margin };
}

/**
 * Reconstruct the attenuation image from link measurements. Each link's excess
 * attenuation (baseline − measured, in dB) is spread over the grid cells that
 * fall inside an ellipse around the tx→rx line (foci = the two nodes, width set
 * by `ellipseM`). Cells crossed by many attenuated links accumulate high values.
 */
export function reconstruct(
  nodes: RtiNode[],
  links: RtiLink[],
  opts: { cell?: number; margin?: number; txPowerDbm?: number; pathLossN?: number; ellipseM?: number } = {},
): RtiGrid {
  const cell = opts.cell ?? 0.3; // metres per cell
  const margin = opts.margin ?? 1;
  const txp = opts.txPowerDbm ?? -30;
  const nExp = opts.pathLossN ?? 2.0; // free-space reference
  const ellipseM = opts.ellipseM ?? 0.5; // ellipse excess-path width (m)

  const b = nodeBounds(nodes, margin);
  const w = Math.max(1, Math.round(b.w / cell));
  const h = Math.max(1, Math.round(b.h / cell));
  const N = w * h;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cells = new Array(N).fill(0);
  const weight = new Array(N).fill(0);

  // Weighted back-projection: spread each link's excess attenuation over the
  // cells inside its Wilson ellipse, down-weighting cells near the endpoints
  // (a node's own vicinity shouldn't hog the mass). Cells crossed by many
  // attenuated links accumulate — that's where walls are. With few nodes this
  // is deliberately a BLURRY field, honest about RTI's low resolution.
  for (const lk of links) {
    const a = byId.get(lk.tx), c = byId.get(lk.rx);
    if (!a || !c) continue;
    const dist = Math.hypot(a.x - c.x, a.y - c.y);
    if (dist < 0.3) continue;
    const base = lk.baseline ?? freeSpaceRssi(dist, txp, nExp);
    const excess = Math.max(0, base - lk.rssi);
    if (excess <= 0) continue;
    const linkW = 1 / Math.sqrt(dist);
    for (let gy = 0; gy < h; gy++) {
      for (let gx = 0; gx < w; gx++) {
        const px = b.x + (gx + 0.5) * cell;
        const py = b.y + (gy + 0.5) * cell;
        const da = Math.hypot(px - a.x, py - a.y);
        const dc = Math.hypot(px - c.x, py - c.y);
        if (da + dc >= dist + ellipseM) continue;
        // Endpoint-suppression: fade cells within 0.6 m of either node.
        const endFade = Math.min(1, Math.min(da, dc) / 0.6);
        const i = gy * w + gx;
        cells[i] += excess * linkW * endFade;
        weight[i] += linkW;
      }
    }
  }

  // Coverage-normalise each cell by how many links could see it.
  for (let i = 0; i < N; i++) if (weight[i] > 0) cells[i] /= weight[i];

  // De-bias: subtract the background level (median of covered cells) so only
  // ABOVE-baseline attenuation — the actual obstructions — survives. Without
  // this the whole interior saturates (every cell is crossed by many links) and
  // no structure is visible.
  const covered = cells.filter((_, i) => weight[i] > 0).sort((a, b) => a - b);
  const median = covered.length ? covered[Math.floor(covered.length / 2)] : 0;
  let max = 0;
  for (let i = 0; i < N; i++) {
    cells[i] = Math.max(0, cells[i] - 0.5 * median); // partial de-bias keeps signal
    if (cells[i] > max) max = cells[i];
  }
  if (max > 0) for (let i = 0; i < N; i++) cells[i] = clamp(Math.pow(cells[i] / max, 1.3));

  return { w, h, meters: { w: b.w, h: b.h }, origin: { x: b.x, y: b.y }, cells };
}

/**
 * A candidate footprint room from the node bounds — the one thing RTI can always
 * give automatically (the outer extent). Interior walls come from the operator
 * tracing the attenuation heatmap. Returns metres relative to a (0,0) origin.
 */
export function candidateFootprint(nodes: RtiNode[], margin = 0.5): { w: number; h: number; room: { x: number; y: number; w: number; h: number } } {
  const b = nodeBounds(nodes, margin);
  const w = Math.max(1, Math.round(b.w * 10) / 10);
  const h = Math.max(1, Math.round(b.h * 10) / 10);
  return { w, h, room: { x: 0, y: 0, w, h } };
}

/** Cells above `thresh` (0..1) as metre points — the likely-wall ridge, for hints. */
export function hotCells(grid: RtiGrid, thresh = 0.55): { x: number; y: number; v: number }[] {
  const out: { x: number; y: number; v: number }[] = [];
  const cw = grid.meters.w / grid.w, ch = grid.meters.h / grid.h;
  for (let gy = 0; gy < grid.h; gy++) {
    for (let gx = 0; gx < grid.w; gx++) {
      const v = grid.cells[gy * grid.w + gx];
      if (v >= thresh) out.push({ x: (gx + 0.5) * cw, y: (gy + 0.5) * ch, v });
    }
  }
  return out;
}
