"use client";

import { useRef, useState } from "react";
import {
  type FloorPlan,
  type Room,
  type Anchor,
  planBounds,
  defaultPlan,
} from "@/lib/floorplan-core";
import { candidateFootprint } from "@/lib/rti-core";

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const snap = (v: number) => Math.round(v * 4) / 4; // 0.25 m grid

/**
 * Top-down floor-plan editor: drag rooms and WiFi nodes, edit dimensions, and
 * save. The saved plan drives the 3D Observatory's transparent walls and the
 * in-plan placement of sensed people.
 */
export function FloorPlanEditor({
  initial,
  onSaved,
}: {
  initial: FloorPlan;
  onSaved?: (plan: FloorPlan) => void;
}) {
  const [plan, setPlan] = useState<FloorPlan>(initial);
  const [sel, setSel] = useState<{ kind: "room" | "anchor"; id: string } | null>(null);
  const [status, setStatus] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ kind: "room" | "anchor"; id: string; dx: number; dy: number } | null>(null);

  const b = planBounds(plan);
  const selRoom = sel?.kind === "room" ? plan.rooms.find((r) => r.id === sel.id) ?? null : null;
  const selAnchor = sel?.kind === "anchor" ? plan.anchors.find((a) => a.id === sel.id) ?? null : null;

  // Pointer → metres in plan space (viewBox is in metres).
  const toMeters = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * b.w, y: ((clientY - r.top) / r.height) * b.h };
  };

  function startDrag(e: React.PointerEvent, kind: "room" | "anchor", id: string) {
    e.stopPropagation();
    setSel({ kind, id });
    const m = toMeters(e.clientX, e.clientY);
    const item = kind === "room" ? plan.rooms.find((r) => r.id === id) : plan.anchors.find((a) => a.id === id);
    if (!item) return;
    drag.current = { kind, id, dx: m.x - item.x, dy: m.y - item.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const m = toMeters(e.clientX, e.clientY);
    const nx = snap(Math.max(0, Math.min(b.w, m.x - drag.current.dx)));
    const ny = snap(Math.max(0, Math.min(b.h, m.y - drag.current.dy)));
    const d = drag.current;
    setPlan((p) => ({
      ...p,
      rooms: d.kind === "room" ? p.rooms.map((r) => (r.id === d.id ? { ...r, x: nx, y: ny } : r)) : p.rooms,
      anchors: d.kind === "anchor" ? p.anchors.map((a) => (a.id === d.id ? { ...a, x: nx, y: ny } : a)) : p.anchors,
    }));
  }
  function endDrag() { drag.current = null; }

  const patchRoom = (id: string, patch: Partial<Room>) =>
    setPlan((p) => ({ ...p, rooms: p.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const patchAnchor = (id: string, patch: Partial<Anchor>) =>
    setPlan((p) => ({ ...p, anchors: p.anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));

  function addRoom() {
    const r: Room = { id: uid("r"), name: "Room", x: 1, y: 1, w: 3, h: 3 };
    setPlan((p) => ({ ...p, rooms: [...p.rooms, r] }));
    setSel({ kind: "room", id: r.id });
  }
  function addAnchor(kind: "ap" | "rx") {
    const a: Anchor = { id: uid("a"), name: kind === "ap" ? "AP" : "CSI node", x: snap(b.w / 2), y: snap(b.h / 2), kind };
    setPlan((p) => ({ ...p, anchors: [...p.anchors, a] }));
    setSel({ kind: "anchor", id: a.id });
  }
  function del() {
    if (!sel) return;
    setPlan((p) => ({
      ...p,
      rooms: sel.kind === "room" ? p.rooms.filter((r) => r.id !== sel.id) : p.rooms,
      anchors: sel.kind === "anchor" ? p.anchors.filter((a) => a.id !== sel.id) : p.anchors,
    }));
    setSel(null);
  }

  // Auto-helper: size the outer footprint to the WiFi nodes the user placed
  // (the one thing signal geometry gives reliably — the covered extent).
  function fitToNodes() {
    if (plan.anchors.length < 2) { setStatus("place ≥2 nodes first"); setTimeout(() => setStatus(""), 2000); return; }
    const fp = candidateFootprint(plan.anchors, 0.6);
    setPlan((p) => ({ ...p, meters: { w: fp.w, h: fp.h } }));
    setStatus("footprint fit to nodes ✓");
    setTimeout(() => setStatus(""), 2500);
  }

  async function save() {
    setStatus("saving…");
    try {
      const res = await fetch("/api/sensing/floorplan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const d = await res.json();
      if (d.ok) {
        setStatus("saved ✓");
        if (d.plan) setPlan(d.plan);
        onSaved?.(d.plan ?? plan);
      } else setStatus(d.error ?? "save failed");
    } catch {
      setStatus("network error");
    }
    setTimeout(() => setStatus(""), 2500);
  }

  const grid = [];
  for (let x = 0; x <= Math.ceil(b.w); x++) grid.push(<line key={`vx${x}`} x1={x} y1={0} x2={x} y2={b.h} stroke="rgba(255,255,255,0.05)" strokeWidth={0.02} />);
  for (let y = 0; y <= Math.ceil(b.h); y++) grid.push(<line key={`hy${y}`} x1={0} y1={y} x2={b.w} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={0.02} />);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
      <div className="card">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-white">Home floor plan (top-down)</span>
          <span className="text-xs text-gray-500">1 grid square = 1 m · drag to move</span>
        </div>
        <svg
          ref={svgRef}
          viewBox={`-0.3 -0.3 ${b.w + 0.6} ${b.h + 0.6}`}
          className="mt-3 w-full rounded-xl border border-surface-border bg-black/40 touch-none"
          style={{ aspectRatio: `${b.w} / ${b.h}` }}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerDown={() => setSel(null)}
        >
          {grid}
          {plan.rooms.map((r) => {
            const on = sel?.kind === "room" && sel.id === r.id;
            return (
              <g key={r.id} onPointerDown={(e) => startDrag(e, "room", r.id)} style={{ cursor: "move" }}>
                <rect
                  x={r.x} y={r.y} width={r.w} height={r.h}
                  fill={on ? "rgba(52,211,153,0.16)" : "rgba(96,165,250,0.08)"}
                  stroke={on ? "rgb(52,211,153)" : "rgba(148,163,184,0.7)"}
                  strokeWidth={on ? 0.09 : 0.06}
                  rx={0.08}
                />
                <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="middle" fill="rgba(226,232,240,0.85)" fontSize={0.32}>
                  {r.name}
                </text>
              </g>
            );
          })}
          {plan.anchors.map((a) => {
            const on = sel?.kind === "anchor" && sel.id === a.id;
            const c = a.kind === "ap" ? "rgb(96,165,250)" : "rgb(110,231,183)";
            return (
              <g key={a.id} onPointerDown={(e) => startDrag(e, "anchor", a.id)} style={{ cursor: "move" }}>
                <circle cx={a.x} cy={a.y} r={0.22} fill={c} stroke={on ? "#fff" : "rgba(0,0,0,0.4)"} strokeWidth={on ? 0.06 : 0.03} />
                <text x={a.x + 0.3} y={a.y} dominantBaseline="middle" fill="rgba(226,232,240,0.8)" fontSize={0.28}>
                  {a.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={addRoom} className="btn-ghost text-xs">+ Room</button>
          <button onClick={() => addAnchor("ap")} className="btn-ghost text-xs">+ AP</button>
          <button onClick={() => addAnchor("rx")} className="btn-ghost text-xs">+ CSI node</button>
          <button onClick={() => { setPlan(defaultPlan()); setSel(null); }} className="btn-ghost text-xs">Reset template</button>
          <button onClick={save} className="btn-primary ml-auto text-xs">Save plan</button>
          {status && <span className="self-center text-xs text-emerald-300">{status}</span>}
        </div>
      </div>

      {/* Inspector */}
      <div className="card self-start">
        <p className="text-sm font-semibold text-white">Properties</p>
        <div className="mt-3 space-y-2 text-xs">
          <NumRow label="Footprint width (m)" value={plan.meters.w} onChange={(v) => setPlan((p) => ({ ...p, meters: { ...p.meters, w: v } }))} />
          <NumRow label="Footprint depth (m)" value={plan.meters.h} onChange={(v) => setPlan((p) => ({ ...p, meters: { ...p.meters, h: v } }))} />
          <NumRow label="Wall height (m)" value={plan.height} step={0.1} onChange={(v) => setPlan((p) => ({ ...p, height: v }))} />
          <button onClick={fitToNodes} className="btn-ghost mt-1 w-full text-xs" title="Size the outer footprint to the WiFi nodes you placed">
            📐 Fit footprint to my WiFi nodes
          </button>
        </div>

        {selRoom && (
          <div className="mt-4 border-t border-surface-border pt-3">
            <p className="text-xs font-semibold text-gray-300">Selected room</p>
            <label className="mt-2 block text-[11px] text-gray-500">Name
              <input value={selRoom.name} onChange={(e) => patchRoom(selRoom.id, { name: e.target.value })} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1 text-sm text-gray-100 outline-none focus:border-brand" />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumRow label="X (m)" value={selRoom.x} onChange={(v) => patchRoom(selRoom.id, { x: v })} />
              <NumRow label="Y (m)" value={selRoom.y} onChange={(v) => patchRoom(selRoom.id, { y: v })} />
              <NumRow label="Width (m)" value={selRoom.w} onChange={(v) => patchRoom(selRoom.id, { w: v })} />
              <NumRow label="Depth (m)" value={selRoom.h} onChange={(v) => patchRoom(selRoom.id, { h: v })} />
            </div>
            <button onClick={del} className="mt-3 text-[11px] text-gray-500 hover:text-red-400">Delete room</button>
          </div>
        )}
        {selAnchor && (
          <div className="mt-4 border-t border-surface-border pt-3">
            <p className="text-xs font-semibold text-gray-300">Selected {selAnchor.kind === "ap" ? "access point" : "CSI node"}</p>
            <label className="mt-2 block text-[11px] text-gray-500">Name
              <input value={selAnchor.name} onChange={(e) => patchAnchor(selAnchor.id, { name: e.target.value })} className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1 text-sm text-gray-100 outline-none focus:border-brand" />
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumRow label="X (m)" value={selAnchor.x} onChange={(v) => patchAnchor(selAnchor.id, { x: v })} />
              <NumRow label="Y (m)" value={selAnchor.y} onChange={(v) => patchAnchor(selAnchor.id, { y: v })} />
            </div>
            <button onClick={del} className="mt-3 text-[11px] text-gray-500 hover:text-red-400">Delete node</button>
          </div>
        )}
        {!selRoom && !selAnchor && (
          <p className="mt-4 text-xs text-gray-500">Select a room or node to edit it, or drag it on the plan. The plan drives the 3D view&apos;s transparent walls and where people appear.</p>
        )}
      </div>
    </div>
  );
}

function NumRow({ label, value, step = 0.5, onChange }: { label: string; value: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-[11px] text-gray-500">
      {label}
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-2 py-1 text-sm text-gray-100 outline-none focus:border-brand"
      />
    </label>
  );
}
