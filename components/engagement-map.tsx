"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import type { EngagementGraph, GNode } from "@/lib/engagement-graph";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const W = 900;
const H = 640;

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
  if (n.type === "engagement") return 30;
  if (n.type === "host") return 17;
  if (n.type === "subdomain") return 14;
  return 12;
}

type P = { x: number; y: number; z: number };

/**
 * Galaxy layout — the engagement is the core "sun"; everything orbits it on a
 * tilted disk (radial-tree angle by relationship, ring by depth). We project the
 * disk in pseudo-3D: vertical squash for perspective, and a per-node depth `z`
 * (back → front) that drives size, brightness and draw order. Not WebGL — pure
 * SVG/CSS, so it stays dependency-free.
 */
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
  const ring = (Math.min(W, H) / 2 - 70) / maxDepth;
  const pos: Record<string, P> = {};
  const place = (id: string, a0: number, a1: number, depth: number) => {
    const mid = (a0 + a1) / 2;
    if (depth === 0) {
      pos[id] = { x: W / 2, y: H / 2, z: 0.6 };
    } else {
      const rx = ring * depth;
      const dx = rx * Math.cos(mid);
      const dy = rx * Math.sin(mid); // disk-plane vertical
      pos[id] = {
        x: W / 2 + dx,
        y: H / 2 + dy * 0.5, // squash for perspective
        z: dy, // raw depth; normalized below
      };
    }
    const kids = childrenOf[id] ?? [];
    const span = a1 - a0;
    kids.forEach((k, i) => place(k, a0 + span * (i / kids.length), a0 + span * ((i + 1) / kids.length), depth + 1));
  };
  if (root) place(root, -Math.PI / 2, Math.PI * 1.5, 0);
  let ox = 40;
  for (const n of graph.nodes) if (!pos[n.id]) { pos[n.id] = { x: ox, y: H - 24, z: 0 }; ox += 60; }
  // Normalize z to 0..1 for depth styling.
  const zs = Object.values(pos).map((p) => p.z);
  const lo = Math.min(...zs), hi = Math.max(...zs), span = hi - lo || 1;
  for (const id of Object.keys(pos)) pos[id].z = (pos[id].z - lo) / span;
  return pos;
}

export function EngagementMap({ graph }: { graph: EngagementGraph }) {
  const initial = useMemo(() => layout(graph), [graph]);
  const [pos, setPos] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<string>("overview");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);

  useEffect(() => { setPos(initial); setSelected(null); }, [initial]);

  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  const sel = selected ? byId[selected] : null;
  const colors = useMemo(() => Array.from(new Set(graph.nodes.map(nodeColor))), [graph]);

  // Draw order: farther (small z) first so nearer bubbles sit on top.
  const drawOrder = useMemo(
    () => [...graph.nodes].sort((a, b) => (pos[a.id]?.z ?? 0) - (pos[b.id]?.z ?? 0)),
    [graph, pos],
  );

  function toSvg(e: React.PointerEvent) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  }
  function startDrag(e: React.PointerEvent, id: string) {
    e.preventDefault();
    drag.current = { id, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = toSvg(e);
    if (!p) return;
    drag.current.moved = true;
    const id = drag.current.id;
    setPos((cur) => ({ ...cur, [id]: { ...cur[id], x: clamp(p.x, 16, W - 16), y: clamp(p.y, 16, H - 16) } }));
  }
  function endDrag() {
    if (drag.current && !drag.current.moved) {
      setSelected((s) => (s === drag.current!.id ? null : drag.current!.id));
      setTab("overview");
    }
    drag.current = null;
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of graph.nodes) c[n.type] = (c[n.type] ?? 0) + 1;
    return c;
  }, [graph]);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="card overflow-hidden p-2">
        <style>{`
          @keyframes gxFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
          @keyframes gxTwinkle { 0%,100%{opacity:.25} 50%{opacity:.7} }
          .gx-float { animation: gxFloat 6s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce){ .gx-float{animation:none} }
        `}</style>
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[11px] text-gray-500">
          <button onClick={() => { setPos(layout(graph)); setSelected(null); }} className="btn-ghost px-2 py-1 text-[11px]">
            Reset galaxy
          </button>
          <span className="flex items-center gap-1">
            <Icon name="search" className="h-3 w-3" /> Zoom
            <input type="range" min={0.6} max={2} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="accent-emerald-500" />
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
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
        <div className="overflow-auto rounded-lg" style={{ background: "radial-gradient(120% 90% at 50% 40%, #0b1220 0%, #060912 60%, #03050b 100%)" }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center", minWidth: zoom > 1 ? `${zoom * 100}%` : undefined }}
            onPointerMove={onMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <defs>
              {/* Glassy-sphere gradient per color — light highlight top-left → color. */}
              {colors.map((c, i) => (
                <radialGradient key={i} id={`gx-${i}`} cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
                  <stop offset="35%" stopColor={c} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.65} />
                </radialGradient>
              ))}
              <radialGradient id="gx-core" cx="35%" cy="30%" r="75%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
                <stop offset="30%" stopColor="#34d399" stopOpacity={0.95} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0.6} />
              </radialGradient>
            </defs>

            {/* Starfield */}
            {STARS.map((s, i) => (
              <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill="#cbd5e1" opacity={0.4} style={{ animation: `gxTwinkle ${3 + (i % 5)}s ease-in-out ${i % 7}s infinite` }} />
            ))}

            {/* Edges (orbital links) */}
            {graph.edges.map((e, i) => {
              const a = pos[e.from], b = pos[e.to];
              if (!a || !b) return null;
              const active = selected === e.from || selected === e.to;
              return (
                <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? "#34d399" : "rgba(120,140,180,0.18)"} strokeWidth={active ? 1.6 : 0.8} />
              );
            })}

            {/* Bubbles, depth-sorted */}
            {drawOrder.map((n, idx) => {
              const p = pos[n.id];
              if (!p) return null;
              const depth = 0.7 + 0.55 * p.z; // nearer = bigger
              const r = baseRadius(n) * depth;
              const col = nodeColor(n);
              const gi = colors.indexOf(col);
              const isSel = selected === n.id;
              const isCore = n.type === "engagement";
              const opacity = 0.55 + 0.45 * p.z;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onPointerDown={(ev) => startDrag(ev, n.id)}>
                  <g className="gx-float" style={{ animationDelay: `${(idx % 12) * 0.4}s` }}>
                    {/* glow halo */}
                    <circle r={r + (isSel ? 10 : 6)} fill={col} opacity={isSel ? 0.28 : 0.14} />
                    {(isSel || (n.type === "finding" && (n.severity === "critical" || n.severity === "high"))) && (
                      <circle r={r + 8} fill="none" stroke={col} strokeWidth={1} strokeOpacity={0.6} />
                    )}
                    {/* sphere */}
                    <circle r={r} fill={`url(#${isCore ? "gx-core" : `gx-${gi}`})`} opacity={opacity}
                      stroke={col} strokeOpacity={0.5} strokeWidth={isSel ? 2 : 1} />
                    {/* specular highlight */}
                    <circle cx={-r * 0.3} cy={-r * 0.35} r={r * 0.28} fill="#ffffff" opacity={0.5 * opacity} />
                    {(isCore || r > 12) && (
                      <text textAnchor="middle" y={r + 12} fontSize={isCore ? 12 : 10} fill="#e2e8f0" opacity={0.6 + 0.4 * p.z}>
                        {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="card min-h-[10rem]">
        {!sel ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-sm text-gray-500">
            <Icon name="globe" className="mb-2 h-6 w-6 text-gray-600" />
            Tap any bubble to open its details.
            <span className="mt-1 text-xs text-gray-600">Drag to rearrange · zoom · reset galaxy.</span>
          </div>
        ) : (
          <NodeDetail node={sel} tab={tab} setTab={setTab} />
        )}
      </div>
    </div>
  );
}

// Deterministic starfield (no Math.random at module scope for SSR stability).
const STARS = Array.from({ length: 70 }, (_, i) => {
  const a = (i * 137.5) % 360;
  const rad = (a * Math.PI) / 180;
  const dist = ((i * 53) % 400) + 30;
  return {
    x: clamp(W / 2 + dist * Math.cos(rad) * 1.1, 4, W - 4),
    y: clamp(H / 2 + dist * Math.sin(rad) * 0.7, 4, H - 4),
    r: (i % 3) * 0.5 + 0.6,
  };
});

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
