"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import type { EngagementGraph, GNode } from "@/lib/engagement-graph";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// Logical canvas viewport (the SVG viewBox). Content lives in an inner <g> that
// we pan/zoom, so the world is effectively infinite.
const VW = 1000;
const VH = 680;

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

function nodeColor(n: GNode): string {
  if ((n.type === "host" || n.type === "subdomain") && n.severity) return SEV_COLOR[n.severity] ?? TYPE_COLOR[n.type];
  if (n.type === "finding" && n.severity) return SEV_COLOR[n.severity] ?? TYPE_COLOR.finding;
  return TYPE_COLOR[n.type] ?? "#94a3b8";
}
function baseRadius(n: GNode): number {
  if (n.type === "engagement") return 32;
  if (n.type === "host") return 18;
  if (n.type === "subdomain") return 14;
  return 12;
}
// One-line micro-stat shown under every node so "every small detail" is visible.
function microStat(n: GNode): string {
  if (n.type === "host" || n.type === "subdomain") {
    const f = Number(n.meta?.findings ?? 0);
    const s = Number(n.meta?.services ?? 0);
    const worst = n.severity ? ` · ${n.severity}` : "";
    return `${f} find · ${s} svc${worst}`;
  }
  if (n.type === "finding") return String(n.severity ?? "");
  if (n.type === "engagement") return String(n.meta?.status ?? "");
  return n.sub ?? "";
}

type P = { x: number; y: number; z: number };
type View = { x: number; y: number; k: number };

/** Radial-tree galaxy layout in world coordinates (centered on the core). */
function layout(graph: EngagementGraph): Record<string, P> {
  const childrenOf: Record<string, string[]> = {};
  const parentOf: Record<string, string> = {};
  for (const e of graph.edges) {
    (childrenOf[e.to] ??= []).push(e.from);
    parentOf[e.from] = e.to;
  }
  const root = graph.nodes.find((n) => n.type === "engagement")?.id ?? graph.nodes[0]?.id;
  const depthOf = (id: string) => {
    let d = 0, cur = id; const seen = new Set<string>();
    while (parentOf[cur] != null && !seen.has(cur)) { seen.add(cur); cur = parentOf[cur]; d++; }
    return d;
  };
  const maxDepth = Math.max(1, ...graph.nodes.map((n) => depthOf(n.id)));
  const ring = 150;
  const pos: Record<string, P> = {};
  const place = (id: string, a0: number, a1: number, depth: number) => {
    const mid = (a0 + a1) / 2;
    if (depth === 0) pos[id] = { x: VW / 2, y: VH / 2, z: 0.6 };
    else {
      const rx = ring * depth;
      const dx = rx * Math.cos(mid);
      const dy = rx * Math.sin(mid);
      pos[id] = { x: VW / 2 + dx, y: VH / 2 + dy * 0.62, z: dy };
    }
    const kids = childrenOf[id] ?? [];
    const span = a1 - a0;
    kids.forEach((k, i) => place(k, a0 + span * (i / kids.length), a0 + span * ((i + 1) / kids.length), depth + 1));
  };
  if (root) place(root, -Math.PI / 2, Math.PI * 1.5, 0);
  let ox = 60;
  for (const n of graph.nodes) if (!pos[n.id]) { pos[n.id] = { x: ox, y: VH - 30, z: 0 }; ox += 70; }
  const zs = Object.values(pos).map((p) => p.z);
  const lo = Math.min(...zs), hi = Math.max(...zs), span = hi - lo || 1;
  for (const id of Object.keys(pos)) pos[id].z = (pos[id].z - lo) / span;
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
  // Interaction state: dragging a node, or panning the background.
  const act = useRef<{ mode: "node" | "pan"; id?: string; moved: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  const sel = selected ? byId[selected] : null;
  const colors = useMemo(() => Array.from(new Set(graph.nodes.map(nodeColor))), [graph]);
  const core = graph.nodes.find((n) => n.type === "engagement");

  const drawOrder = useMemo(
    () => [...graph.nodes].sort((a, b) => (pos[a.id]?.z ?? 0) - (pos[b.id]?.z ?? 0)),
    [graph, pos],
  );

  // Convert a pointer event to SVG-viewport coords (0..VW / 0..VH).
  const toSvg = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VW, y: ((cy - r.top) / r.height) * VH };
  }, []);
  // SVG-viewport → world coords (undo the pan/zoom).
  const toWorld = useCallback((sx: number, sy: number, v: View) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k }), []);

  // Fit all nodes into view with padding.
  const fit = useCallback((p = pos) => {
    const pts = Object.values(p);
    if (!pts.length) return;
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
    const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
    const k = clamp(Math.min(VW / (maxX - minX), VH / (maxY - minY)), 0.2, 2.5);
    setView({ k, x: VW / 2 - ((minX + maxX) / 2) * k, y: VH / 2 - ((minY + maxY) / 2) * k });
  }, [pos]);

  useEffect(() => { setPos(initial); setSelected(null); }, [initial]);
  useEffect(() => { fit(initial); /* fit on new graph */ }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  // Native wheel listener (passive:false) so we can zoom-to-cursor.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: sx, y: sy } = toSvg(e.clientX, e.clientY);
      setView((v) => {
        const k = clamp(v.k * (e.deltaY < 0 ? 1.12 : 0.89), 0.2, 4);
        const w = toWorld(sx, sy, v);
        return { k, x: sx - w.x * k, y: sy - w.y * k };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSvg, toWorld]);

  function startNode(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    const s = toSvg(e.clientX, e.clientY);
    act.current = { mode: "node", id, moved: false, sx: s.x, sy: s.y, ox: 0, oy: 0 };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function startPan(e: React.PointerEvent) {
    const s = toSvg(e.clientX, e.clientY);
    act.current = { mode: "pan", moved: false, sx: s.x, sy: s.y, ox: view.x, oy: view.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!act.current) return;
    const s = toSvg(e.clientX, e.clientY);
    if (Math.abs(s.x - act.current.sx) + Math.abs(s.y - act.current.sy) > 2) act.current.moved = true;
    if (act.current.mode === "pan") {
      setView((v) => ({ ...v, x: act.current!.ox + (s.x - act.current!.sx), y: act.current!.oy + (s.y - act.current!.sy) }));
    } else if (act.current.mode === "node") {
      const w = toWorld(s.x, s.y, view);
      const id = act.current.id!;
      setPos((cur) => ({ ...cur, [id]: { ...cur[id], x: w.x, y: w.y } }));
    }
  }
  function endInteract() {
    const a = act.current;
    if (a && a.mode === "node" && !a.moved) {
      setSelected((s) => (s === a.id ? null : a.id!));
      setTab("overview");
    }
    if (a && a.mode === "pan" && !a.moved) setSelected(null);
    act.current = null;
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of graph.nodes) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [graph]);

  const zoomBy = (f: number) =>
    setView((v) => {
      const k = clamp(v.k * f, 0.2, 4);
      const cx = VW / 2, cy = VH / 2;
      const w = toWorld(cx, cy, v);
      return { k, x: cx - w.x * k, y: cy - w.y * k };
    });

  const corePos = core ? pos[core.id] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[2.4fr_1fr]">
      <div className="card overflow-hidden p-2">
        <style>{`
          @keyframes gxFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
          @keyframes gxTwinkle { 0%,100%{opacity:.2} 50%{opacity:.65} }
          .gx-float { animation: gxFloat 6s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce){ .gx-float{animation:none} }
        `}</style>

        {/* Toolbar */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-gray-400">
          <button onClick={() => fit()} className="btn-ghost px-2 py-1 text-[11px]">Fit</button>
          <button onClick={() => zoomBy(1.25)} className="btn-ghost px-2 py-1 text-[11px]">＋</button>
          <button onClick={() => zoomBy(0.8)} className="btn-ghost px-2 py-1 text-[11px]">－</button>
          <button onClick={() => { const p = layout(graph); setPos(p); setSelected(null); fit(p); }} className="btn-ghost px-2 py-1 text-[11px]">Reset</button>
          <span className="ml-1 font-mono text-[10px] text-gray-600">{Math.round(view.k * 100)}%</span>
          <span className="ml-auto flex flex-wrap gap-2 text-[10px]">
            {(["host", "subdomain", "finding", "program", "person"] as const).map((t) =>
              counts[t] ? (
                <span key={t} className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />
                  {counts[t]} {t}
                </span>
              ) : null,
            )}
          </span>
        </div>

        <div className="relative rounded-lg" style={{ background: "radial-gradient(120% 90% at 50% 42%, #0a1628 0%, #060d18 55%, #02040a 100%)" }}>
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
              <pattern id="gxGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0 H0 V40" fill="none" stroke="rgba(56,189,248,0.08)" strokeWidth="1" />
              </pattern>
              {colors.map((c, i) => (
                <radialGradient key={i} id={`gx-${i}`} cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
                  <stop offset="35%" stopColor={c} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.6} />
                </radialGradient>
              ))}
              <radialGradient id="gx-core" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
                <stop offset="30%" stopColor="#34d399" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0.55} />
              </radialGradient>
              <radialGradient id="gxSweep" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
              </radialGradient>
            </defs>

            {/* World layer (pan + zoom) */}
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* Grid backdrop */}
              <rect x={-2000} y={-2000} width={5000} height={5000} fill="url(#gxGrid)" />

              {/* HUD radar centered on the engagement core */}
              {corePos && (
                <g transform={`translate(${corePos.x},${corePos.y})`}>
                  {[90, 150, 220, 300].map((r, i) => (
                    <circle key={i} r={r} fill="none" stroke="rgba(45,212,191,0.14)" strokeWidth={1} strokeDasharray={i % 2 ? "4 6" : undefined} />
                  ))}
                  {[0, 45, 90, 135].map((a) => (
                    <line key={a} x1={-300} y1={0} x2={300} y2={0} transform={`rotate(${a})`} stroke="rgba(45,212,191,0.08)" strokeWidth={1} />
                  ))}
                  {/* rotating sweep */}
                  <g>
                    <path d="M0 0 L300 0 A300 300 0 0 1 212 212 Z" fill="url(#gxSweep)" opacity={0.5} />
                    <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur="8s" repeatCount="indefinite" />
                  </g>
                </g>
              )}

              {/* Edges */}
              {graph.edges.map((e, i) => {
                const a = pos[e.from], b = pos[e.to];
                if (!a || !b) return null;
                const active = selected === e.from || selected === e.to || hover === e.from || hover === e.to;
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={active ? "#34d399" : "rgba(120,150,190,0.2)"} strokeWidth={active ? 1.8 : 0.9} />
                );
              })}

              {/* Nodes */}
              {drawOrder.map((n, idx) => {
                const p = pos[n.id];
                if (!p) return null;
                const depth = 0.72 + 0.5 * p.z;
                const r = baseRadius(n) * depth;
                const col = nodeColor(n);
                const gi = colors.indexOf(col);
                const isSel = selected === n.id;
                const isHover = hover === n.id;
                const isCore = n.type === "engagement";
                const op = 0.6 + 0.4 * p.z;
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer"
                    onPointerDown={(ev) => startNode(ev, n.id)}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}>
                    <g className="gx-float" style={{ animationDelay: `${(idx % 10) * 0.5}s` }}>
                      <circle r={r + (isSel || isHover ? 10 : 6)} fill={col} opacity={isSel ? 0.3 : isHover ? 0.22 : 0.13} />
                      {(isSel || (n.type === "finding" && (n.severity === "critical" || n.severity === "high"))) && (
                        <circle r={r + 8} fill="none" stroke={col} strokeWidth={1} strokeOpacity={0.6} />
                      )}
                      <circle r={r} fill={`url(#${isCore ? "gx-core" : `gx-${gi}`})`} opacity={op} stroke={col} strokeOpacity={0.55} strokeWidth={isSel ? 2 : 1} />
                      <circle cx={-r * 0.3} cy={-r * 0.35} r={r * 0.26} fill="#fff" opacity={0.45 * op} />
                      {/* Labels — always shown so every detail is visible. */}
                      <text textAnchor="middle" y={r + 11} fontSize={isCore ? 13 : 10} fontFamily="ui-monospace, monospace" fill="#e2e8f0" opacity={0.85}>
                        {n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}
                      </text>
                      <text textAnchor="middle" y={r + 22} fontSize={8} fontFamily="ui-monospace, monospace" fill={col} opacity={0.75}>
                        {microStat(n)}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>

            {/* Fixed HUD frame (screen space) */}
            {[[8, 8, 1, 1], [VW - 8, 8, -1, 1], [8, VH - 8, 1, -1], [VW - 8, VH - 8, -1, -1]].map(([x, y, sx, sy], i) => (
              <path key={i} d={`M${x} ${y + sy * 22} V${y} H${x + sx * 22}`} fill="none" stroke="rgba(45,212,191,0.5)" strokeWidth={1.5} />
            ))}
            <text x={16} y={VH - 16} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgba(148,163,184,0.6)">
              {graph.nodes.length} NODES · {graph.edges.length} LINKS · drag bg to pan · scroll to zoom · drag node to move
            </text>
          </svg>
        </div>
      </div>

      <div className="card min-h-[10rem]">
        {!sel ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-sm text-gray-500">
            <Icon name="globe" className="mb-2 h-6 w-6 text-gray-600" />
            Tap any node to open its details.
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
          <p className="text-[11px] uppercase tracking-wide text-gray-500">{node.sub ?? node.type}</p>
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
