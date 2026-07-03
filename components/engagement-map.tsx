"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import type { EngagementGraph, GNode } from "@/lib/engagement-graph";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Logical viewport (SVG viewBox). Content lives in a pan/zoom world layer.
const VW = 1100;
const VH = 720;

const TYPE_COLOR: Record<string, string> = {
  engagement: "#34d399",
  host: "#38bdf8",
  subdomain: "#818cf8",
  finding: "#f87171",
  program: "#f59e0b",
  person: "#a78bfa",
};
const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#38bdf8",
  info: "#64748b",
};
const TYPE_ICON: Record<string, string> = {
  engagement: "briefcase",
  host: "server",
  subdomain: "globe",
  finding: "alert",
  program: "target",
  person: "bot",
};
const TYPE_LABEL: Record<string, string> = {
  engagement: "Engagement",
  host: "Host / server",
  subdomain: "Subdomain",
  finding: "Finding",
  program: "Program",
  person: "Collaborator",
};

function nodeColor(n: GNode): string {
  if ((n.type === "host" || n.type === "subdomain") && n.severity) return SEV_COLOR[n.severity] ?? TYPE_COLOR[n.type];
  if (n.type === "finding" && n.severity) return SEV_COLOR[n.severity] ?? TYPE_COLOR.finding;
  return TYPE_COLOR[n.type] ?? "#94a3b8";
}
function microStat(n: GNode): string {
  if (n.type === "host" || n.type === "subdomain") {
    const f = Number(n.meta?.findings ?? 0);
    const s = Number(n.meta?.services ?? 0);
    return `${f} finding${f === 1 ? "" : "s"} · ${s} svc${n.severity ? ` · ${n.severity}` : ""}`;
  }
  if (n.type === "finding") return String(n.severity ?? "finding");
  if (n.type === "engagement") return String(n.meta?.status ?? "engagement");
  return n.sub ?? "";
}

type Box = { x: number; y: number; w: number; h: number }; // x,y = top-left
type View = { x: number; y: number; k: number };

const H = 40; // node card height
const X_GAP = 250; // column spacing
const Y_STEP = 56; // row spacing between leaves
const PAD = 60;

function nodeWidth(n: GNode): number {
  const len = Math.max(n.label.length, microStat(n).length);
  return clamp(len * 6.6 + 44, 120, 230);
}

/**
 * Tidy layered tree layout (Reingold-Tilford style): depth → column, children
 * stacked and each parent centered on its children. Produces a readable network
 * topology instead of an overlapping cluster.
 */
function layout(graph: EngagementGraph): Record<string, Box> {
  const childrenOf: Record<string, string[]> = {};
  const parentOf: Record<string, string> = {};
  for (const e of graph.edges) {
    (childrenOf[e.to] ??= []).push(e.from);
    parentOf[e.from] = e.to;
  }
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const root = graph.nodes.find((n) => n.type === "engagement")?.id ?? graph.nodes[0]?.id;

  const rowOf: Record<string, number> = {};
  const colOf: Record<string, number> = {};
  let cursor = 0;
  const visited = new Set<string>();
  const place = (id: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    colOf[id] = depth;
    const kids = (childrenOf[id] ?? []).filter((k) => byId[k] && !visited.has(k));
    if (kids.length === 0) {
      rowOf[id] = cursor++;
    } else {
      kids.forEach((k) => place(k, depth + 1));
      rowOf[id] = (rowOf[kids[0]] + rowOf[kids[kids.length - 1]]) / 2;
    }
  };
  if (root) place(root, 0);
  // Orphans (no path to root) stack below.
  for (const n of graph.nodes) if (!(n.id in rowOf)) { colOf[n.id] = 0; rowOf[n.id] = cursor++; }

  const pos: Record<string, Box> = {};
  for (const n of graph.nodes) {
    pos[n.id] = {
      x: PAD + (colOf[n.id] ?? 0) * X_GAP,
      y: PAD + (rowOf[n.id] ?? 0) * Y_STEP,
      w: nodeWidth(n),
      h: H,
    };
  }
  return pos;
}

export function EngagementMap({ graph }: { graph: EngagementGraph }) {
  const initial = useMemo(() => layout(graph), [graph]);
  const [pos, setPos] = useState(initial);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const svgRef = useRef<SVGSVGElement>(null);
  const act = useRef<{ mode: "node" | "pan"; id?: string; moved: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  const sel = selected ? byId[selected] : null;
  const usedTypes = useMemo(() => {
    const order = ["engagement", "host", "subdomain", "finding", "program", "person"];
    const present = new Set(graph.nodes.map((n) => n.type));
    return order.filter((t) => present.has(t as GNode["type"]));
  }, [graph]);

  const toSvg = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VW, y: ((cy - r.top) / r.height) * VH };
  }, []);
  const toWorld = useCallback((sx: number, sy: number, v: View) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k }), []);

  const fit = useCallback((p = pos) => {
    const boxes = Object.values(p);
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((b) => b.x)) - 40;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 40;
    const minY = Math.min(...boxes.map((b) => b.y)) - 40;
    const maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 40;
    const k = clamp(Math.min(VW / (maxX - minX), VH / (maxY - minY)), 0.25, 1.6);
    setView({ k, x: VW / 2 - ((minX + maxX) / 2) * k, y: VH / 2 - ((minY + maxY) / 2) * k });
  }, [pos]);

  useEffect(() => { setPos(initial); setSelected(null); }, [initial]);
  useEffect(() => { fit(initial); }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: sx, y: sy } = toSvg(e.clientX, e.clientY);
      setView((v) => {
        const k = clamp(v.k * (e.deltaY < 0 ? 1.12 : 0.89), 0.2, 3);
        const w = toWorld(sx, sy, v);
        return { k, x: sx - w.x * k, y: sy - w.y * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSvg, toWorld]);

  // No setPointerCapture — it throws on SVG in iOS Safari. svg-level handlers
  // receive the events; leaving the svg ends the gesture.
  function startNode(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    const s = toSvg(e.clientX, e.clientY);
    act.current = { mode: "node", id, moved: false, sx: s.x, sy: s.y, ox: 0, oy: 0 };
  }
  function startPan(e: React.PointerEvent) {
    const s = toSvg(e.clientX, e.clientY);
    act.current = { mode: "pan", moved: false, sx: s.x, sy: s.y, ox: view.x, oy: view.y };
  }
  function onMove(e: React.PointerEvent) {
    if (!act.current) return;
    const s = toSvg(e.clientX, e.clientY);
    if (Math.abs(s.x - act.current.sx) + Math.abs(s.y - act.current.sy) > 2) act.current.moved = true;
    if (act.current.mode === "pan") {
      setView((v) => ({ ...v, x: act.current!.ox + (s.x - act.current!.sx), y: act.current!.oy + (s.y - act.current!.sy) }));
    } else {
      const w = toWorld(s.x, s.y, view);
      const id = act.current.id!;
      setPos((cur) => ({ ...cur, [id]: { ...cur[id], x: w.x - cur[id].w / 2, y: w.y - cur[id].h / 2 } }));
    }
  }
  function endInteract() {
    const a = act.current;
    if (a && a.mode === "node" && !a.moved) { setSelected((s) => (s === a.id ? null : a.id!)); setTab("overview"); }
    if (a && a.mode === "pan" && !a.moved) setSelected(null);
    act.current = null;
  }
  const zoomBy = (f: number) =>
    setView((v) => {
      const k = clamp(v.k * f, 0.2, 3);
      const cx = VW / 2, cy = VH / 2;
      const w = toWorld(cx, cy, v);
      return { k, x: cx - w.x * k, y: cy - w.y * k };
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[2.4fr_1fr]">
      <div className="card overflow-hidden p-2">
        {/* Toolbar */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-gray-400">
          <button onClick={() => fit()} className="btn-ghost px-2 py-1 text-[11px]">Fit</button>
          <button onClick={() => zoomBy(1.25)} className="btn-ghost px-2 py-1 text-[11px]">＋</button>
          <button onClick={() => zoomBy(0.8)} className="btn-ghost px-2 py-1 text-[11px]">－</button>
          <button onClick={() => { const p = layout(graph); setPos(p); setSelected(null); fit(p); }} className="btn-ghost px-2 py-1 text-[11px]">Reset</button>
          <span className="ml-1 font-mono text-[10px] text-gray-600">{Math.round(view.k * 100)}%</span>
        </div>

        <div className="relative rounded-lg" style={{ background: "radial-gradient(120% 90% at 50% 30%, #0a1524 0%, #060c16 60%, #03060d 100%)" }}>
          {/* Legend overlay */}
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-lg border border-cyan-500/20 bg-black/50 px-2.5 py-2 text-[10px] backdrop-blur">
            <p className="mb-1 font-semibold uppercase tracking-widest text-cyan-300/80">Legend</p>
            {usedTypes.map((t) => (
              <p key={t} className="flex items-center gap-1.5 text-gray-300">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: TYPE_COLOR[t] }} />
                {TYPE_LABEL[t]}
              </p>
            ))}
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${VW} ${VH}`}
            className="h-auto w-full touch-none select-none"
            style={{ cursor: act.current?.mode === "pan" ? "grabbing" : "grab" }}
            onPointerDown={startPan}
            onPointerMove={onMove}
            onPointerUp={endInteract}
            onPointerLeave={endInteract}
          >
            <defs>
              <pattern id="gxGrid" width="44" height="44" patternUnits="userSpaceOnUse">
                <path d="M44 0 H0 V44" fill="none" stroke="rgba(56,189,248,0.06)" strokeWidth="1" />
              </pattern>
            </defs>

            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              <rect x={-3000} y={-3000} width={7000} height={7000} fill="url(#gxGrid)" />

              {/* Orthogonal elbow links: parent right edge → child left edge */}
              {graph.edges.map((e, i) => {
                const parent = pos[e.to], child = pos[e.from];
                if (!parent || !child) return null;
                const active = selected === e.from || selected === e.to || hover === e.from || hover === e.to;
                const x1 = parent.x + parent.w, y1 = parent.y + parent.h / 2;
                const x2 = child.x, y2 = child.y + child.h / 2;
                const midX = (x1 + x2) / 2;
                return (
                  <path key={i} d={`M${x1} ${y1} H${midX} V${y2} H${x2}`} fill="none"
                    stroke={active ? "#34d399" : "rgba(120,150,190,0.28)"} strokeWidth={active ? 1.8 : 1} />
                );
              })}

              {/* Node cards */}
              {graph.nodes.map((n) => {
                const b = pos[n.id];
                if (!b) return null;
                const col = nodeColor(n);
                const isSel = selected === n.id;
                const isHover = hover === n.id;
                const isCore = n.type === "engagement";
                return (
                  <g key={n.id} transform={`translate(${b.x},${b.y})`} className="cursor-pointer"
                    onPointerDown={(ev) => startNode(ev, n.id)}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}>
                    <rect width={b.w} height={b.h} rx={9}
                      fill={isCore ? "rgba(16,52,42,0.92)" : "rgba(13,20,34,0.92)"}
                      stroke={col} strokeOpacity={isSel ? 1 : isHover ? 0.8 : 0.45} strokeWidth={isSel ? 2 : 1.2} />
                    {/* colored left stripe */}
                    <rect width={4} height={b.h} rx={2} fill={col} />
                    {/* status dot */}
                    <circle cx={18} cy={b.h / 2} r={isCore ? 7 : 5} fill={col} />
                    {isCore && <circle cx={18} cy={b.h / 2} r={10} fill="none" stroke={col} strokeOpacity={0.5} strokeWidth={1} />}
                    <text x={32} y={b.h / 2 - 3} fontSize={isCore ? 12 : 11} fontWeight={600} fill="#f1f5f9">
                      {n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label}
                    </text>
                    <text x={32} y={b.h / 2 + 11} fontSize={8.5} fontFamily="ui-monospace, monospace" fill={col} opacity={0.85}>
                      {microStat(n).length > 32 ? microStat(n).slice(0, 31) + "…" : microStat(n)}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Fixed HUD corner brackets */}
            {[[8, 8, 1, 1], [VW - 8, 8, -1, 1], [8, VH - 8, 1, -1], [VW - 8, VH - 8, -1, -1]].map(([x, y, sx, sy], i) => (
              <path key={i} d={`M${x} ${y + sy * 20} V${y} H${x + sx * 20}`} fill="none" stroke="rgba(45,212,191,0.4)" strokeWidth={1.5} />
            ))}
            <text x={16} y={VH - 14} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgba(148,163,184,0.55)">
              {graph.nodes.length} nodes · {graph.edges.length} links · drag background to pan · scroll to zoom · drag a card to move
            </text>
          </svg>
        </div>
      </div>

      <div className="card min-h-[10rem]">
        {!sel ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-sm text-gray-500">
            <Icon name="globe" className="mb-2 h-6 w-6 text-gray-600" />
            Tap any card to open its details.
            <span className="mt-1 text-xs text-gray-600">Pan · zoom · drag · fit.</span>
          </div>
        ) : (
          <NodeDetail node={sel} tab={tab} setTab={setTab} />
        )}
      </div>
    </div>
  );
}

function NodeDetail({ node, tab, setTab }: { node: GNode; tab: string; setTab: (t: string) => void }) {
  const tabs = detailTabs(node);
  const active = tabs.includes(tab) ? tab : tabs[0];
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${nodeColor(node)}22`, color: nodeColor(node) }}>
          <Icon name={TYPE_ICON[node.type] ?? "globe"} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{node.label}</p>
          <p className="text-[11px] uppercase tracking-wide text-gray-500">{TYPE_LABEL[node.type] ?? node.type}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 border-b border-surface-border">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-2.5 py-1.5 text-xs capitalize ${active === t ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3 text-sm">
        {active === "overview" && (
          <dl className="space-y-1.5 text-xs">
            {Object.entries(node.meta ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="capitalize text-gray-500">{k}</dt>
                <dd className="min-w-0 truncate text-right text-gray-300">{String(v)}</dd>
              </div>
            ))}
            {!node.meta && <p className="text-gray-500">No extra details.</p>}
          </dl>
        )}
        {active === "findings" && (
          <ul className="space-y-1.5">
            {(node.findings ?? []).length === 0 && <li className="text-xs text-gray-500">No findings on this host.</li>}
            {(node.findings ?? []).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 rounded-md border border-surface-border bg-black/20 px-2 py-1.5 text-xs">
                <span className="min-w-0">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: SEV_COLOR[f.severity] ?? "#64748b" }} />
                  <span className="ml-1.5 text-gray-300">{f.title.length > 40 ? f.title.slice(0, 39) + "…" : f.title}</span>
                </span>
                <Link href={`/dashboard/findings/${f.id}/exploit`} className="shrink-0 text-red-300 hover:text-red-200">⚔</Link>
              </li>
            ))}
          </ul>
        )}
        {active === "services" && (
          <div className="flex flex-wrap gap-1.5">
            {(node.services ?? []).length === 0 && <p className="text-xs text-gray-500">No open ports recorded.</p>}
            {(node.services ?? []).map((s) => (
              <span key={s} className="tag font-mono text-[11px]">{s}</span>
            ))}
          </div>
        )}
        {active === "finding" && node.type === "finding" && (
          <Link href={`/dashboard/findings/${node.id.replace(/^f:/, "")}/exploit`} className="btn-ghost inline-flex text-sm">
            ⚔ Open this finding →
          </Link>
        )}
      </div>
    </div>
  );
}

function detailTabs(node: GNode): string[] {
  if (node.type === "host" || node.type === "subdomain") return ["overview", "findings", "services"];
  if (node.type === "finding") return ["overview", "finding"];
  return ["overview"];
}
