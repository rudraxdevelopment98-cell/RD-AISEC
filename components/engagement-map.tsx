"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import type { EngagementGraph, GNode } from "@/lib/engagement-graph";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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
  critical: "#ef4444", high: "#f97316", medium: "#f59e0b", low: "#38bdf8", info: "#64748b",
};
const SEV_RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const TYPE_ICON: Record<string, string> = {
  engagement: "briefcase", host: "server", subdomain: "globe", finding: "alert", program: "target", person: "bot",
};
const TYPE_LABEL: Record<string, string> = {
  engagement: "Engagement", host: "Host / server", subdomain: "Subdomain", finding: "Finding", program: "Program", person: "Collaborator",
};
const COL_LABEL: Record<string, string> = {
  engagement: "Engagement", host: "Hosts", subdomain: "Subdomains", finding: "Findings", program: "Programs", person: "Team",
};
const TYPE_ORDER = ["engagement", "host", "subdomain", "finding", "program", "person"];

function nodeColor(n: GNode): string {
  if ((n.type === "host" || n.type === "subdomain") && n.severity) return SEV_COLOR[n.severity] ?? TYPE_COLOR[n.type];
  if (n.type === "finding" && n.severity) return SEV_COLOR[n.severity] ?? TYPE_COLOR.finding;
  return TYPE_COLOR[n.type] ?? "#94a3b8";
}
function microStat(n: GNode): string {
  if (n.type === "host" || n.type === "subdomain") {
    const f = Number(n.meta?.findings ?? 0), s = Number(n.meta?.services ?? 0);
    return `${f} finding${f === 1 ? "" : "s"} · ${s} svc${n.severity ? ` · ${n.severity}` : ""}`;
  }
  if (n.type === "finding") return String(n.severity ?? "finding");
  if (n.type === "engagement") return String(n.meta?.status ?? "engagement");
  return n.sub ?? "";
}

type Box = { x: number; y: number; w: number; h: number };
type View = { x: number; y: number; k: number };
type Cols = { col: number; x: number; label: string; type: string }[];

// Small inline SVG "device" glyphs per node type, drawn inside each card.
function NodeGlyph({ type, color }: { type: string; color: string }) {
  const s = { fill: "none", stroke: color, strokeWidth: 1.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "host":
      return (<g {...s}><rect x={-6} y={-6} width={12} height={5} rx={1} /><rect x={-6} y={1} width={12} height={5} rx={1} /><circle cx={-3} cy={-3.5} r={0.7} fill={color} stroke="none" /><circle cx={-3} cy={3.5} r={0.7} fill={color} stroke="none" /></g>);
    case "subdomain":
      return (<g {...s}><circle r={6} /><ellipse rx={2.6} ry={6} /><line x1={-6} y1={0} x2={6} y2={0} /></g>);
    case "finding":
      return (<g {...s}><path d="M0 -6 L6 5 H-6 Z" /><line x1={0} y1={-2} x2={0} y2={2} /><circle cx={0} cy={3.6} r={0.7} fill={color} stroke="none" /></g>);
    case "program":
      return (<g {...s}><circle r={6} /><circle r={3} /><circle r={0.9} fill={color} stroke="none" /></g>);
    case "person":
      return (<g {...s}><circle cx={0} cy={-2.5} r={2.6} /><path d="M-5 6 A5 5 0 0 1 5 6" /></g>);
    default: // engagement / briefcase
      return (<g {...s}><rect x={-6} y={-3} width={12} height={8} rx={1} /><path d="M-2 -3 V-5 H2 V-3" /></g>);
  }
}

const H = 40, X_GAP = 250, Y_STEP = 56, PAD = 70;

function nodeWidth(n: GNode): number {
  return clamp(Math.max(n.label.length, microStat(n).length) * 6.6 + 44, 120, 230);
}

/** Tidy layered tree over a VISIBLE subset; also returns per-column headers. */
function layout(nodes: GNode[], edges: EngagementGraph["edges"], depthAll: Record<string, number>):
  { pos: Record<string, Box>; cols: Cols } {
  const visible = new Set(nodes.map((n) => n.id));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const childrenOf: Record<string, string[]> = {};
  const parentOf: Record<string, string> = {};
  for (const e of edges) {
    if (!visible.has(e.from) || !visible.has(e.to)) continue;
    (childrenOf[e.to] ??= []).push(e.from);
    parentOf[e.from] = e.to;
  }
  const root = nodes.find((n) => n.type === "engagement")?.id ?? nodes[0]?.id;
  const rowOf: Record<string, number> = {}, colOf: Record<string, number> = {};
  let cursor = 0; const seen = new Set<string>();
  const place = (id: string, depth: number) => {
    if (seen.has(id)) return; seen.add(id);
    colOf[id] = depth;
    const kids = (childrenOf[id] ?? []).filter((k) => byId[k] && !seen.has(k));
    if (!kids.length) rowOf[id] = cursor++;
    else { kids.forEach((k) => place(k, depth + 1)); rowOf[id] = (rowOf[kids[0]] + rowOf[kids[kids.length - 1]]) / 2; }
  };
  if (root) place(root, 0);
  for (const n of nodes) if (!(n.id in rowOf)) { colOf[n.id] = depthAll[n.id] ?? 0; rowOf[n.id] = cursor++; }

  const pos: Record<string, Box> = {};
  for (const n of nodes) pos[n.id] = { x: PAD + (colOf[n.id] ?? 0) * X_GAP, y: PAD + (rowOf[n.id] ?? 0) * Y_STEP, w: nodeWidth(n), h: H };

  // Column headers: dominant type per column → label.
  const colTypes: Record<number, Record<string, number>> = {};
  for (const n of nodes) { const c = colOf[n.id] ?? 0; (colTypes[c] ??= {})[n.type] = ((colTypes[c] ??= {})[n.type] ?? 0) + 1; }
  const cols: Cols = Object.keys(colTypes).map((cs) => {
    const c = Number(cs);
    const dom = Object.entries(colTypes[c]).sort((a, b) => b[1] - a[1])[0][0];
    return { col: c, x: PAD + c * X_GAP, label: COL_LABEL[dom] ?? dom, type: dom };
  }).sort((a, b) => a.col - b.col);
  return { pos, cols };
}

export function EngagementMap({ graph, engagementId }: { graph: EngagementGraph; engagementId?: string }) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [minSev, setMinSev] = useState("info");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [dragPos, setDragPos] = useState<Record<string, Box>>({});
  const [maximized, setMaximized] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const act = useRef<{ mode: "node" | "pan"; id?: string; moved: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null);

  // Per-engagement saved layout (drag positions) in localStorage.
  const storageKey = `rdaisec.map.${engagementId ?? "default"}`;
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (loadedKey.current === storageKey) return;
    loadedKey.current = storageKey;
    try {
      const raw = localStorage.getItem(storageKey);
      setDragPos(raw ? JSON.parse(raw) : {});
    } catch { setDragPos({}); }
  }, [storageKey]);
  useEffect(() => {
    if (loadedKey.current !== storageKey) return; // don't save before load
    try {
      if (Object.keys(dragPos).length) localStorage.setItem(storageKey, JSON.stringify(dragPos));
      else localStorage.removeItem(storageKey);
    } catch { /* ignore quota/private mode */ }
  }, [dragPos, storageKey]);

  const byId = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);

  // Relationship maps over the FULL graph.
  const { childrenOf, parentOf, depthAll } = useMemo(() => {
    const c: Record<string, string[]> = {}, p: Record<string, string> = {};
    for (const e of graph.edges) { (c[e.to] ??= []).push(e.from); p[e.from] = e.to; }
    const d: Record<string, number> = {};
    for (const n of graph.nodes) { let k = 0, cur = n.id; const s = new Set<string>(); while (p[cur] != null && !s.has(cur)) { s.add(cur); cur = p[cur]; k++; } d[n.id] = k; }
    return { childrenOf: c, parentOf: p, depthAll: d };
  }, [graph]);

  const descendants = useCallback((id: string) => {
    const out = new Set<string>(); const stack = [...(childrenOf[id] ?? [])];
    while (stack.length) { const x = stack.pop()!; if (out.has(x)) continue; out.add(x); stack.push(...(childrenOf[x] ?? [])); }
    return out;
  }, [childrenOf]);

  // Visible nodes after type / severity / collapse filters.
  const visibleNodes = useMemo(() => {
    const hiddenByCollapse = new Set<string>();
    for (const id of collapsed) for (const d of descendants(id)) hiddenByCollapse.add(d);
    const minR = SEV_RANK[minSev] ?? 0;
    return graph.nodes.filter((n) => {
      if (n.type === "engagement") return true;
      if (hiddenTypes.has(n.type)) return false;
      if (hiddenByCollapse.has(n.id)) return false;
      if (n.type === "finding" && (SEV_RANK[n.severity ?? "info"] ?? 0) < minR) return false;
      return true;
    });
  }, [graph, hiddenTypes, minSev, collapsed, descendants]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => graph.edges.filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to)), [graph, visibleIds]);

  const { pos: basePos, cols } = useMemo(() => layout(visibleNodes, visibleEdges, depthAll), [visibleNodes, visibleEdges, depthAll]);
  // Merge in any user drags (dragPos overrides computed positions).
  const pos = useMemo(() => {
    const m: Record<string, Box> = { ...basePos };
    for (const id of Object.keys(dragPos)) if (m[id]) m[id] = { ...m[id], x: dragPos[id].x, y: dragPos[id].y };
    return m;
  }, [basePos, dragPos]);

  // Content bounding box (for tier bands + minimap).
  const bounds = useMemo(() => {
    const bs = Object.values(pos);
    if (!bs.length) return { x0: 0, y0: 0, x1: VW, y1: VH };
    return {
      x0: Math.min(...bs.map((b) => b.x)), y0: Math.min(...bs.map((b) => b.y)),
      x1: Math.max(...bs.map((b) => b.x + b.w)), y1: Math.max(...bs.map((b) => b.y + b.h)),
    };
  }, [pos]);

  const sel = selected && visibleIds.has(selected) ? byId[selected] : null;

  // Focus set (selected node's ancestors + descendants) for dimming.
  const focusSet = useMemo(() => {
    if (!selected) return null;
    const s = new Set<string>([selected]);
    for (const d of descendants(selected)) s.add(d);
    let cur = parentOf[selected]; const guard = new Set<string>();
    while (cur != null && !guard.has(cur)) { guard.add(cur); s.add(cur); cur = parentOf[cur]; }
    return s;
  }, [selected, descendants, parentOf]);

  const q = query.trim().toLowerCase();
  const matchSet = useMemo(() => {
    if (!q) return null;
    return new Set(visibleNodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
  }, [q, visibleNodes]);

  // Severity tally across all findings (dedup by id) + confirmed count.
  const stats = useMemo<Record<string, number>>(() => {
    const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0, confirmed: 0 };
    const seen = new Set<string>();
    for (const n of graph.nodes) for (const f of n.findings ?? []) {
      if (seen.has(f.id)) continue; seen.add(f.id);
      c[f.severity] = (c[f.severity] ?? 0) + 1; if (f.confirmed) c.confirmed++;
    }
    return c;
  }, [graph]);

  const toSvg = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VW, y: ((cy - r.top) / r.height) * VH };
  }, []);
  const toWorld = useCallback((sx: number, sy: number, v: View) => ({ x: (sx - v.x) / v.k, y: (sy - v.y) / v.k }), []);

  const fitBoxes = useCallback((boxes: Box[]) => {
    if (!boxes.length) return;
    const minX = Math.min(...boxes.map((b) => b.x)) - 50, maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 50;
    const minY = Math.min(...boxes.map((b) => b.y)) - 50, maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 50;
    const k = clamp(Math.min(VW / (maxX - minX), VH / (maxY - minY)), 0.25, 1.6);
    setView({ k, x: VW / 2 - ((minX + maxX) / 2) * k, y: VH / 2 - ((minY + maxY) / 2) * k });
  }, []);
  const fit = useCallback(() => fitBoxes(Object.values(pos)), [pos, fitBoxes]);

  useEffect(() => { fitBoxes(Object.values(basePos)); }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x: sx, y: sy } = toSvg(e.clientX, e.clientY);
      setView((v) => { const k = clamp(v.k * (e.deltaY < 0 ? 1.12 : 0.89), 0.2, 3); const w = toWorld(sx, sy, v); return { k, x: sx - w.x * k, y: sy - w.y * k }; });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSvg, toWorld]);

  function startNode(e: React.PointerEvent, id: string) { e.stopPropagation(); const s = toSvg(e.clientX, e.clientY); act.current = { mode: "node", id, moved: false, sx: s.x, sy: s.y, ox: 0, oy: 0 }; }
  function startPan(e: React.PointerEvent) { const s = toSvg(e.clientX, e.clientY); act.current = { mode: "pan", moved: false, sx: s.x, sy: s.y, ox: view.x, oy: view.y }; }
  function onMove(e: React.PointerEvent) {
    // Capture the gesture into a local — the state updaters below run async, and
    // act.current can be nulled by pointer-up before they execute (was crashing
    // with "Cannot read properties of null (reading 'ox')").
    const a = act.current;
    if (!a) return;
    const s = toSvg(e.clientX, e.clientY);
    if (Math.abs(s.x - a.sx) + Math.abs(s.y - a.sy) > 2) a.moved = true;
    if (a.mode === "pan") {
      setView((v) => ({ ...v, x: a.ox + (s.x - a.sx), y: a.oy + (s.y - a.sy) }));
    } else {
      const w = toWorld(s.x, s.y, view);
      const id = a.id!;
      const b = pos[id];
      if (b) setDragPos((d) => ({ ...d, [id]: { ...b, x: w.x - b.w / 2, y: w.y - b.h / 2 } }));
    }
  }
  function endInteract() {
    const a = act.current;
    if (a && a.mode === "node" && !a.moved) { setSelected((s) => (s === a.id ? null : a.id!)); setTab("overview"); }
    if (a && a.mode === "pan" && !a.moved) setSelected(null);
    act.current = null;
  }
  const zoomBy = (f: number) => setView((v) => { const k = clamp(v.k * f, 0.2, 3); const cx = VW / 2, cy = VH / 2; const w = toWorld(cx, cy, v); return { k, x: cx - w.x * k, y: cy - w.y * k }; });

  function toggleType(t: string) { setHiddenTypes((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; }); }
  function toggleCollapse(id: string) { setCollapsed((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function resetAll() { setHiddenTypes(new Set()); setMinSev("info"); setCollapsed(new Set()); setQuery(""); setSelected(null); setDragPos({}); setTimeout(() => fitBoxes(Object.values(layout(graph.nodes, graph.edges, depthAll).pos)), 0); }

  function serializeSvg(): string {
    const clone = svgRef.current!.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
    bg.setAttribute("width", String(VW)); bg.setAttribute("height", String(VH));
    bg.setAttribute("fill", "#03060d");
    clone.insertBefore(bg, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  }
  function download(url: string, name: string) {
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  }
  function downloadSvg() {
    if (!svgRef.current) return;
    const blob = new Blob([serializeSvg()], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    download(url, "engagement-map.svg");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadPng() {
    if (!svgRef.current) return;
    const data = serializeSvg();
    const src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(data)));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = VW * scale; canvas.height = VH * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#03060d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        download(url, "engagement-map.png");
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    };
    img.src = src;
  }
  function toggleMaximize() {
    const el = wrapRef.current;
    // Native fullscreen where supported; CSS maximize otherwise (iOS Safari).
    if (el?.requestFullscreen && !maximized) { el.requestFullscreen().catch(() => setMaximized(true)); }
    else if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); setMaximized(false); }
    else setMaximized((m) => !m);
  }

  const usedTypes = useMemo(() => TYPE_ORDER.filter((t) => graph.nodes.some((n) => n.type === t)), [graph]);
  const isBright = (id: string) => (matchSet ? matchSet.has(id) : focusSet ? focusSet.has(id) : true);

  return (
    <div
      ref={wrapRef}
      className={`grid gap-4 lg:grid-cols-[2.4fr_1fr] ${maximized ? "fixed inset-0 z-[120] overflow-auto bg-[#03060d] p-3" : ""}`}
    >
      <div className="card overflow-hidden p-2">
        {/* Toolbar */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1 text-[11px]">
          <button onClick={fit} className="btn-ghost px-2 py-1 text-[11px]">Fit</button>
          <button onClick={() => zoomBy(1.25)} className="btn-ghost px-2 py-1 text-[11px]">＋</button>
          <button onClick={() => zoomBy(0.8)} className="btn-ghost px-2 py-1 text-[11px]">－</button>
          <button onClick={resetAll} className="btn-ghost px-2 py-1 text-[11px]">Reset</button>
          <button onClick={downloadPng} className="btn-ghost px-2 py-1 text-[11px]">⬇ PNG</button>
          <button onClick={downloadSvg} className="btn-ghost px-2 py-1 text-[11px]">SVG</button>
          <button onClick={toggleMaximize} className="btn-ghost px-2 py-1 text-[11px]" title="Fullscreen">{maximized ? "⤢ Exit" : "⛶ Full"}</button>
          <span className="font-mono text-[10px] text-gray-600">{Math.round(view.k * 100)}%</span>
          {Object.keys(dragPos).length > 0 && <span className="text-[10px] text-emerald-400/70" title="Your layout is saved for this engagement">↺ layout saved</span>}
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            className="ml-1 w-32 rounded-md border border-surface-border bg-surface px-2 py-1 text-[11px] outline-none focus:border-brand"
          />
          {matchSet && (
            <button onClick={() => fitBoxes(visibleNodes.filter((n) => matchSet.has(n.id)).map((n) => pos[n.id]).filter(Boolean))}
              className="text-[10px] text-brand hover:underline">{matchSet.size} match{matchSet.size === 1 ? "" : "es"} · focus</button>
          )}
          <select value={minSev} onChange={(e) => setMinSev(e.target.value)}
            className="rounded-md border border-surface-border bg-surface px-1.5 py-1 text-[10px] outline-none focus:border-brand">
            <option value="info">all severities</option>
            <option value="low">≥ low</option>
            <option value="medium">≥ medium</option>
            <option value="high">≥ high</option>
            <option value="critical">critical</option>
          </select>
        </div>

        {/* Filter legend (click to toggle a type) */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          {usedTypes.filter((t) => t !== "engagement").map((t) => {
            const off = hiddenTypes.has(t);
            return (
              <button key={t} onClick={() => toggleType(t)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${off ? "border-surface-border text-gray-600 line-through" : "border-transparent text-gray-300"}`}
                style={off ? {} : { background: `${TYPE_COLOR[t]}18` }}>
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: off ? "#475569" : TYPE_COLOR[t] }} />
                {COL_LABEL[t]}
              </button>
            );
          })}
        </div>

        <div className="relative rounded-lg" style={{ background: "radial-gradient(120% 90% at 50% 25%, #0a1524 0%, #060c16 60%, #03060d 100%)" }}>
          <svg
            ref={svgRef} viewBox={`0 0 ${VW} ${VH}`}
            className="h-auto w-full touch-none select-none"
            style={{ cursor: act.current?.mode === "pan" ? "grabbing" : "grab" }}
            onPointerDown={startPan} onPointerMove={onMove} onPointerUp={endInteract} onPointerLeave={endInteract}
          >
            <defs>
              <pattern id="gxGrid" width="44" height="44" patternUnits="userSpaceOnUse">
                <path d="M44 0 H0 V44" fill="none" stroke="rgba(56,189,248,0.06)" strokeWidth="1" />
              </pattern>
            </defs>

            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              <rect x={-3000} y={-3000} width={7000} height={7000} fill="url(#gxGrid)" />

              {/* Shaded tier bands (one per column, tinted by its type) */}
              {cols.map((c) => {
                const col = TYPE_COLOR[c.type] ?? "#38bdf8";
                const bandY = bounds.y0 - 44, bandH = bounds.y1 - bounds.y0 + 70;
                return (
                  <g key={`band-${c.col}`}>
                    <rect x={c.x - 26} y={bandY} width={X_GAP - 10} height={bandH} rx={12}
                      fill={col} fillOpacity={0.04} stroke={col} strokeOpacity={0.12} />
                    <text x={c.x - 8} y={bandY + 20} fontSize={11} fontWeight={700} letterSpacing={2}
                      fill={col} fillOpacity={0.7} style={{ textTransform: "uppercase" }}>{c.label}</text>
                  </g>
                );
              })}

              {/* Links */}
              {visibleEdges.map((e, i) => {
                const parent = pos[e.to], child = pos[e.from]; if (!parent || !child) return null;
                const active = selected === e.from || selected === e.to || hover === e.from || hover === e.to;
                const bright = isBright(e.from) && isBright(e.to);
                const x1 = parent.x + parent.w, y1 = parent.y + parent.h / 2, x2 = child.x, y2 = child.y + child.h / 2, midX = (x1 + x2) / 2;
                return (
                  <path key={i} d={`M${x1} ${y1} H${midX} V${y2} H${x2}`} fill="none"
                    stroke={active ? "#34d399" : "rgba(120,150,190,0.3)"} strokeWidth={active ? 1.8 : 1} opacity={bright ? 1 : 0.15} />
                );
              })}

              {/* Node cards */}
              {visibleNodes.map((n) => {
                const b = pos[n.id]; if (!b) return null;
                const col = nodeColor(n);
                const isSel = selected === n.id, isHover = hover === n.id, isCore = n.type === "engagement";
                const kids = childrenOf[n.id]?.filter((k) => byId[k]) ?? [];
                const hasKids = kids.length > 0;
                const isCollapsed = collapsed.has(n.id);
                const bright = isBright(n.id);
                const isMatch = matchSet?.has(n.id);
                return (
                  <g key={n.id} transform={`translate(${b.x},${b.y})`} className="cursor-pointer" opacity={bright ? 1 : 0.2}
                    onPointerDown={(ev) => startNode(ev, n.id)}
                    onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}>
                    <rect width={b.w} height={b.h} rx={9}
                      fill={isCore ? "rgba(16,52,42,0.94)" : "rgba(13,20,34,0.94)"}
                      stroke={isMatch ? "#facc15" : col} strokeOpacity={isSel || isMatch ? 1 : isHover ? 0.85 : 0.5} strokeWidth={isSel || isMatch ? 2 : 1.2} />
                    <rect width={4} height={b.h} rx={2} fill={col} />
                    {/* device-style glyph */}
                    <circle cx={19} cy={b.h / 2} r={11} fill={col} fillOpacity={0.14} />
                    <g transform={`translate(19,${b.h / 2})`}><NodeGlyph type={n.type} color={col} /></g>
                    <text x={36} y={b.h / 2 - 3} fontSize={isCore ? 12 : 11} fontWeight={600} fill="#f1f5f9">
                      {n.label.length > 28 ? n.label.slice(0, 27) + "…" : n.label}
                    </text>
                    <text x={36} y={b.h / 2 + 11} fontSize={8.5} fontFamily="ui-monospace, monospace" fill={col} opacity={0.85}>
                      {microStat(n).length > 32 ? microStat(n).slice(0, 31) + "…" : microStat(n)}
                    </text>
                    {/* collapse/expand toggle */}
                    {hasKids && (
                      <g onPointerDown={(ev) => { ev.stopPropagation(); toggleCollapse(n.id); }}>
                        <circle cx={b.w - 12} cy={b.h / 2} r={8} fill="rgba(2,6,13,0.9)" stroke={col} strokeOpacity={0.7} />
                        <text x={b.w - 12} y={b.h / 2 + 3.5} textAnchor="middle" fontSize={11} fontWeight={700} fill={col}>
                          {isCollapsed ? "+" : "−"}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Fixed HUD corner brackets + hint */}
            {[[8, 8, 1, 1], [VW - 8, 8, -1, 1], [8, VH - 8, 1, -1], [VW - 8, VH - 8, -1, -1]].map(([x, y, sx, sy], i) => (
              <path key={i} d={`M${x} ${y + sy * 20} V${y} H${x + sx * 20}`} fill="none" stroke="rgba(45,212,191,0.4)" strokeWidth={1.5} />
            ))}
            <text x={16} y={VH - 14} fontSize={9} fontFamily="ui-monospace, monospace" fill="rgba(148,163,184,0.55)">
              {visibleNodes.length}/{graph.nodes.length} nodes · pan · scroll-zoom · drag card · +/− collapse
            </text>
          </svg>

          <Minimap
            nodes={visibleNodes} pos={pos} bounds={bounds} view={view}
            onNavigate={(wx, wy) => setView((v) => ({ ...v, x: VW / 2 - wx * v.k, y: VH / 2 - wy * v.k }))}
          />
        </div>

        {/* Severity stat row */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[10px]">
          {(["critical", "high", "medium", "low", "info"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1 rounded-md border border-surface-border px-1.5 py-0.5 text-gray-300">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: SEV_COLOR[s] }} />
              {stats[s]} {s}
            </span>
          ))}
          {stats.confirmed > 0 && <span className="rounded-md border border-sev-crit/40 px-1.5 py-0.5 text-sev-crit">✓ {stats.confirmed} confirmed</span>}
        </div>
      </div>

      <div className="card min-h-[10rem]">
        {!sel ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-sm text-gray-500">
            <Icon name="globe" className="mb-2 h-6 w-6 text-gray-600" />
            Tap any card to open its details.
            <span className="mt-1 text-xs text-gray-600">Filter · search · collapse · pan · zoom · drag.</span>
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
            className={`px-2.5 py-1.5 text-xs capitalize ${active === t ? "border-b-2 border-brand text-white" : "text-gray-500 hover:text-gray-300"}`}>{t}</button>
        ))}
      </div>

      <div className="mt-3 text-sm">
        {active === "overview" && (
          <dl className="space-y-1.5 text-xs">
            {Object.entries(node.meta ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="capitalize text-gray-500">{k}</dt><dd className="min-w-0 truncate text-right text-gray-300">{String(v)}</dd></div>
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
                <Link href={`/dashboard/findings/${f.id}/exploit`} className="shrink-0 text-sev-crit hover:text-sev-crit">⚔</Link>
              </li>
            ))}
          </ul>
        )}
        {active === "services" && (
          <div className="flex flex-wrap gap-1.5">
            {(node.services ?? []).length === 0 && <p className="text-xs text-gray-500">No open ports recorded.</p>}
            {(node.services ?? []).map((s) => (<span key={s} className="tag font-mono text-[11px]">{s}</span>))}
          </div>
        )}
        {active === "finding" && node.type === "finding" && (
          <Link href={`/dashboard/findings/${node.id.replace(/^f:/, "")}/exploit`} className="btn-ghost inline-flex text-sm">⚔ Open this finding →</Link>
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

/** Bottom-right minimap: all nodes + the current viewport rect; click to recenter. */
function Minimap({
  nodes, pos, bounds, view, onNavigate,
}: {
  nodes: GNode[];
  pos: Record<string, Box>;
  bounds: { x0: number; y0: number; x1: number; y1: number };
  view: View;
  onNavigate: (wx: number, wy: number) => void;
}) {
  const MW = 168, MH = 112, P = 5;
  const wW = Math.max(1, bounds.x1 - bounds.x0), wH = Math.max(1, bounds.y1 - bounds.y0);
  const s = Math.min((MW - P * 2) / wW, (MH - P * 2) / wH);
  const mx = (wx: number) => P + (wx - bounds.x0) * s;
  const my = (wy: number) => P + (wy - bounds.y0) * s;
  // Visible world region from the current view transform.
  const vx0 = (0 - view.x) / view.k, vy0 = (0 - view.y) / view.k;
  const vx1 = (VW - view.x) / view.k, vy1 = (VH - view.y) / view.k;

  function click(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const lx = ((e.clientX - r.left) / r.width) * MW, ly = ((e.clientY - r.top) / r.height) * MH;
    onNavigate(bounds.x0 + (lx - P) / s, bounds.y0 + (ly - P) / s);
  }
  return (
    <div className="pointer-events-auto absolute bottom-2 right-2 z-10 rounded-md border border-cyan-500/20 bg-black/60 p-0.5 backdrop-blur">
      <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`} className="cursor-pointer" onPointerDown={click}>
        {nodes.map((n) => {
          const b = pos[n.id]; if (!b) return null;
          return <circle key={n.id} cx={mx(b.x + b.w / 2)} cy={my(b.y + b.h / 2)} r={1.6} fill={nodeColor(n)} opacity={0.85} />;
        })}
        <rect x={mx(vx0)} y={my(vy0)} width={(vx1 - vx0) * s} height={(vy1 - vy0) * s}
          fill="rgba(52,211,153,0.12)" stroke="#34d399" strokeWidth={1} />
      </svg>
    </div>
  );
}
