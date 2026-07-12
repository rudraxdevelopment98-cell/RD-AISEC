"use client";

import { useEffect, useMemo, useRef } from "react";
import { freeSpaceRssi as freeSpace, type RtiNode, type RtiLink } from "@/lib/rti-core";

// A synthetic 8-node room with an interior obstruction (a wall from (3,1.5) to
// (3,4.5)). Links that cross it are attenuated — the honest "signal flow" the
// method relies on. No hardware needed to see the concept.
function demoScenario(): { nodes: RtiNode[]; links: (RtiLink & { excess: number })[] } {
  const nodes: RtiNode[] = [
    { id: "0", x: 0, y: 0 }, { id: "1", x: 3, y: 0 }, { id: "2", x: 6, y: 0 },
    { id: "3", x: 6, y: 3 }, { id: "4", x: 6, y: 6 }, { id: "5", x: 3, y: 6 },
    { id: "6", x: 0, y: 6 }, { id: "7", x: 0, y: 3 },
  ];
  const txp = -30, n = 2.0;
  const seg = { x: 3, y1: 1.5, y2: 4.5 };
  const crosses = (a: RtiNode, b: RtiNode) => {
    if ((a.x - seg.x) * (b.x - seg.x) >= 0) return false;
    const t = (seg.x - a.x) / (b.x - a.x);
    const y = a.y + t * (b.y - a.y);
    return y >= seg.y1 && y <= seg.y2;
  };
  const links: (RtiLink & { excess: number })[] = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const base = freeSpace(d, txp, n);
      let rssi = base;
      if (crosses(a, b)) rssi -= 9;
      links.push({ tx: a.id, rx: b.id, rssi, excess: Math.max(0, base - rssi) });
    }
  return { nodes, links };
}

/**
 * Auto-map from signal flow — honest link-graph view. Draws every node→node link
 * coloured by how ATTENUATED it is; blocked links (red) reveal where walls sit.
 * This is what commodity RTI can actually show; full image reconstruction needs
 * a dense node mesh. The wall is inferred where the red links cross.
 */
export function WifiAutomap() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { nodes, links } = useMemo(() => demoScenario(), []);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.width, H = cv.height, pad = 26;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(8,12,16,0.6)";
    ctx.fillRect(0, 0, W, H);

    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
    const sy = (y: number) => pad + ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);

    const maxExcess = Math.max(1, ...links.map((l) => l.excess));
    for (const l of links) {
      const a = nodes.find((n) => n.id === l.tx)!, b = nodes.find((n) => n.id === l.rx)!;
      const t = Math.min(1, l.excess / maxExcess);
      // Clear links faint green; attenuated links bright red + thicker.
      ctx.strokeStyle = t > 0.2
        ? `rgba(${240},${80 - t * 40},${80 - t * 40},${0.35 + t * 0.5})`
        : "rgba(52,211,153,0.12)";
      ctx.lineWidth = 0.6 + t * 2.2;
      ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); ctx.stroke();
    }
    for (const n of nodes) {
      ctx.fillStyle = "rgba(96,165,250,0.95)";
      ctx.beginPath(); ctx.arc(sx(n.x), sy(n.y), 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1; ctx.stroke();
    }
  }, [nodes, links]);

  return (
    <div className="card mt-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white">Auto-map from signal flow</span>
        <span className="tag border-sev-med/40 text-sev-med">beta · needs a multi-node mesh</span>
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <canvas ref={canvasRef} width={340} height={300} className="w-full rounded-xl border border-surface-border" />
          <p className="mt-2 text-[11px] text-gray-500">
            Blue = WiFi nodes · <span className="text-emerald-400">green</span> links are clear ·{" "}
            <span className="text-sev-crit">red</span> links are attenuated (cross an obstruction). The
            wall is where the red links intersect.
          </p>
        </div>
        <div className="space-y-2 text-xs text-gray-400">
          <p>
            <b className="text-gray-200">How it works.</b> With several WiFi nodes around the space,
            the system measures the signal on every node→node link. A wall adds extra loss to the
            links crossing it — those are the red lines. Where many red links intersect is where the
            wall is (Radio Tomographic Imaging).
          </p>
          <p>
            <b className="text-gray-200">What it gives.</b> A truthful map of which paths are blocked,
            plus the outer <b>footprint</b> auto-fit to your nodes (button in the editor). It&apos;s an{" "}
            <b>assist</b> for tracing walls — full image reconstruction needs a dense node grid, so we
            don&apos;t pretend to draw perfect rooms.
          </p>
          <p className="text-gray-500">
            <b>Hardware.</b> Needs ≈4+ nodes measuring mutual RSSI (an ESP32/ESP8266 mesh is ideal). A
            single USB adapter sees only one vantage point and can&apos;t triangulate.
          </p>
        </div>
      </div>
    </div>
  );
}
