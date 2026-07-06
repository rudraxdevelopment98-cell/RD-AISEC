"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { planBounds, wallSegments, type FloorPlan } from "@/lib/floorplan-core";
import { rssiBars, type DeviceKind } from "@/lib/survey-core";
import type { HomeMap, PositionedDevice } from "@/lib/homemap-core";

type Machine = { id: string; name: string; wifi: string[] };

type VantageStatus = {
  id: string;
  x: number;
  y: number;
  label: string;
  capturedAt: number;
  pending: boolean;
  error: string | null;
  summary: { aps: number; stations: number; named: number; open: number; strongest: number | null } | null;
};

type SurveyState = { vantages: VantageStatus[]; map: HomeMap; pending: boolean };

const KIND_COLOR: Record<DeviceKind, string> = {
  router: "#60a5fa",
  phone: "#34d399",
  laptop: "#a78bfa",
  computer: "#a78bfa",
  iot: "#fbbf24",
  unknown: "#94a3b8",
};

const KIND_LABEL: Record<DeviceKind, string> = {
  router: "Router / AP",
  phone: "Phone",
  laptop: "Laptop",
  computer: "Computer",
  iot: "IoT",
  unknown: "Device",
};

export function WifiHomemap({
  machines,
  defaultIface,
  plan,
}: {
  machines: Machine[];
  defaultIface?: string;
  plan: FloorPlan;
}) {
  const [runnerId, setRunnerId] = useState(machines[0]?.id ?? "");
  const ifaces = useMemo(() => {
    const m = machines.find((x) => x.id === runnerId);
    return m?.wifi ?? [];
  }, [machines, runnerId]);
  const [iface, setIface] = useState(defaultIface ?? "");
  const [seconds, setSeconds] = useState(25);
  const [stand, setStand] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<SurveyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!iface && ifaces[0]) setIface(ifaces[0]);
  }, [ifaces, iface]);

  const bounds = useMemo(() => planBounds(plan), [plan]);
  const walls = useMemo(() => wallSegments(plan), [plan]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/sensing/survey", { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch { /* transient */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while any capture is in flight.
  useEffect(() => {
    if (!state?.pending) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [state?.pending, refresh]);

  const CW = 520, CH = 400, pad = 28;
  const scale = Math.min((CW - 2 * pad) / bounds.w, (CH - 2 * pad) / bounds.h);
  const sx = useCallback((mx: number) => pad + mx * scale, [scale]);
  const sy = useCallback((my: number) => pad + my * scale, [scale]);

  // Canvas click → metres (the spot you're standing on).
  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CW;
    const py = ((e.clientY - rect.top) / rect.height) * CH;
    const mx = Math.round(((px - pad) / scale) * 10) / 10;
    const my = Math.round(((py - pad) / scale) * 10) / 10;
    if (mx < -1 || my < -1 || mx > bounds.w + 1 || my > bounds.h + 1) return;
    setStand({ x: Math.max(0, mx), y: Math.max(0, my) });
  };

  async function capture() {
    if (!runnerId || !iface) { setNote("Pick a machine and your monitor adapter."); return; }
    if (!stand) { setNote("Tap the plan to mark where you're standing, then capture."); return; }
    setBusy(true); setNote("");
    try {
      const r = await fetch("/api/sensing/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId, iface, x: stand.x, y: stand.y, seconds, label: `Spot ${(state?.vantages.length ?? 0) + 1}` }),
      });
      const j = await r.json();
      if (!r.ok) { setNote(j.error ?? "Capture failed."); }
      else { setStand(null); setNote(`Capturing ~${j.seconds}s at (${stand.x}, ${stand.y}) m — walk after it finishes.`); await refresh(); }
    } catch { setNote("Network error."); }
    finally { setBusy(false); }
  }

  async function clearAll() {
    if (!confirm("Clear all captured vantages and start a fresh walk?")) return;
    await fetch("/api/sensing/survey", { method: "DELETE" });
    setState(null); setStand(null); await refresh();
  }
  async function dropVantage(id: string) {
    await fetch(`/api/sensing/survey?vantage=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  // Single-vantage fallback: if we have exactly one resolved vantage, draw the
  // heard devices as distance RINGS around it (honest — no bearing from one spot).
  const singleVantage = useMemo(() => {
    if (!state) return null;
    const done = state.vantages.filter((v) => !v.pending && !v.error && v.summary);
    return done.length === 1 ? done[0] : null;
  }, [state]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(8,12,16,0.75)";
    ctx.fillRect(0, 0, CW, CH);

    // Coverage footprint (the walked area we heard signal in).
    const fp = state?.map.footprint ?? [];
    if (fp.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(sx(fp[0].x), sy(fp[0].y));
      for (const p of fp.slice(1)) ctx.lineTo(sx(p.x), sy(p.y));
      ctx.closePath();
      ctx.fillStyle = "rgba(52,211,153,0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(52,211,153,0.35)";
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }

    // Floor plan walls (your sketched blueprint).
    ctx.strokeStyle = "rgba(148,163,184,0.35)";
    ctx.lineWidth = 1.5;
    for (const w of walls) {
      ctx.beginPath(); ctx.moveTo(sx(w.x1), sy(w.y1)); ctx.lineTo(sx(w.x2), sy(w.y2)); ctx.stroke();
    }
    // Room labels.
    ctx.fillStyle = "rgba(148,163,184,0.5)";
    ctx.font = "10px ui-sans-serif, system-ui";
    for (const r of plan.rooms) ctx.fillText(r.name, sx(r.x) + 4, sy(r.y) + 12);

    // Single-vantage rings (distance-only).
    if (singleVantage && state) {
      const heardRadii: number[] = [];
      for (const d of state.map.devices) if (d.nearestMeters != null) heardRadii.push(d.nearestMeters);
      const vx = sx(singleVantage.x), vy = sy(singleVantage.y);
      ctx.strokeStyle = "rgba(96,165,250,0.18)";
      ctx.lineWidth = 1;
      for (const rm of heardRadii.slice(0, 40)) {
        ctx.beginPath(); ctx.arc(vx, vy, rm * scale, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Vantages (where you stood).
    for (const v of state?.vantages ?? []) {
      const x = sx(v.x), y = sy(v.y);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = v.pending ? "rgba(251,191,36,0.9)" : v.error ? "rgba(248,113,113,0.9)" : "rgba(56,189,248,0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "9px ui-sans-serif";
      ctx.fillText(v.label, x + 8, y + 3);
    }

    // Positioned devices.
    for (const d of state?.map.devices ?? []) {
      if (!d.pos) continue;
      const x = sx(d.pos.x), y = sy(d.pos.y);
      const c = KIND_COLOR[d.kind] ?? KIND_COLOR.unknown;
      if (d.isAp) {
        // AP: diamond.
        ctx.beginPath();
        ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y);
        ctx.closePath();
      } else {
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      }
      ctx.fillStyle = c; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
      const lbl = d.essid || d.vendor || d.id.slice(-5);
      ctx.fillStyle = "rgba(226,232,240,0.9)"; ctx.font = "9px ui-sans-serif";
      ctx.fillText(lbl.slice(0, 14), x + 7, y - 5);
    }

    // Pending "you are here" marker.
    if (stand) {
      const x = sx(stand.x), y = sy(stand.y);
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(52,211,153,0.95)"; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
      ctx.stroke();
    }
  }, [state, walls, plan.rooms, sx, sy, scale, stand, singleVantage]);

  const map = state?.map;
  const resolvedCount = state?.vantages.filter((v) => !v.pending && !v.error).length ?? 0;

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">🗺 Auto home map — walk &amp; sense</span>
        {map?.canPosition ? (
          <span className="tag ring-emerald accent-emerald">● positioning live</span>
        ) : (
          <span className="tag border-amber-500/40 text-amber-300">{resolvedCount}/3 spots · walk to position</span>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Put your <b>TL-WN721N</b> in reach, tap the plan where you&apos;re standing, and capture. Move to a new
        spot and repeat. After <b>3+ spots</b> your fixed routers become anchors and every device gets a real
        position; the green outline is the area you covered. One spot = distance rings (no bearing).
      </p>

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <select value={runnerId} onChange={(e) => setRunnerId(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand">
          {machines.length === 0 && <option value="">No machine online</option>}
          {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={iface} onChange={(e) => setIface(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand">
          {ifaces.length === 0 && <option value="">No adapter</option>}
          {ifaces.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <label className="flex items-center gap-1 text-gray-400">
          dwell
          <input type="range" min={8} max={60} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-20" />
          <span className="w-8 tabular-nums">{seconds}s</span>
        </label>
        <button disabled={busy || !stand} onClick={capture} className="btn-primary px-3 py-1 disabled:opacity-50">
          {busy ? "Queuing…" : stand ? `Capture at (${stand.x}, ${stand.y})` : "Tap the plan first"}
        </button>
        {(state?.vantages.length ?? 0) > 0 && (
          <button onClick={clearAll} className="btn-ghost px-2 py-1">Clear walk</button>
        )}
      </div>
      {note && <p className="mt-2 text-[11px] text-amber-300">{note}</p>}

      <div className="mt-3 grid gap-4 lg:grid-cols-[520px_1fr]">
        {/* Map canvas */}
        <div>
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            onClick={onCanvasClick}
            className="w-full cursor-crosshair rounded-xl border border-surface-border"
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
            <span><span className="text-sky-400">●</span> where you stood</span>
            <span><span className="text-blue-400">◆</span> AP/router</span>
            <span><span className="text-emerald-400">●</span> phone</span>
            <span><span className="text-violet-400">●</span> laptop</span>
            <span><span className="text-amber-400">●</span> IoT</span>
            <span className="text-emerald-500">▢ coverage footprint</span>
          </div>
        </div>

        {/* Device list + vantage list */}
        <div className="space-y-3">
          {map && map.devices.length > 0 ? (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">
                  {map.devices.length} devices heard · {map.positionedCount} positioned
                </span>
                <span className="text-[10px] text-gray-500">{map.aps.length} APs · {map.stations.length} clients</span>
              </div>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                {map.devices.slice(0, 60).map((d) => (
                  <DeviceRow key={d.id} d={d} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              No survey yet. Pick your monitor adapter, tap where you&apos;re standing, and capture your first spot.
            </p>
          )}

          {(state?.vantages.length ?? 0) > 0 && (
            <div>
              <span className="text-xs font-semibold text-gray-200">Walk ({state!.vantages.length} spots)</span>
              <div className="mt-1 space-y-1">
                {state!.vantages.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-[11px]">
                    <span className={`h-2 w-2 rounded-full ${v.pending ? "bg-amber-400 animate-pulse" : v.error ? "bg-red-400" : "bg-sky-400"}`} />
                    <span className="text-gray-300">{v.label}</span>
                    <span className="text-gray-600">({v.x}, {v.y})m</span>
                    {v.pending ? <span className="text-amber-300">capturing…</span>
                      : v.error ? <span className="text-red-300 truncate" title={v.error}>{v.error}</span>
                      : v.summary ? <span className="text-gray-500">{v.summary.aps} APs · {v.summary.stations} clients</span>
                      : null}
                    <button onClick={() => dropVantage(v.id)} className="ml-auto text-gray-600 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        <b className="text-gray-400">Honest limits.</b> Positions are RSSI estimates (indoor multipath makes
        them noisy, ±a couple of metres) and need ≥3 spots that heard the device. Walls aren&apos;t auto-drawn
        from this — your sketched plan + the coverage outline are the blueprint. Pose/breathing/through-wall
        imaging needs CSI hardware (ESP32-S3 nodes), which the AR9271 can&apos;t do. Authorized spaces only.
      </p>
    </div>
  );
}

function DeviceRow({ d }: { d: PositionedDevice }) {
  const c = KIND_COLOR[d.kind] ?? KIND_COLOR.unknown;
  const bars = rssiBars(d.bestRssi);
  return (
    <div className="flex items-center gap-2 rounded-md border border-surface-border/60 bg-surface/40 px-2 py-1 text-[11px]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-gray-200">
            {d.essid || d.vendor || KIND_LABEL[d.kind]}
          </span>
          {d.isAp && d.privacy && <span className="text-[9px] text-gray-500">{d.privacy}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span className="font-mono">{d.id}</span>
          {d.channel != null && <span>· ch{d.channel}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tabular-nums text-gray-400">{d.bestRssi} dBm</div>
        {d.positioned ? (
          <div className="text-[9px] text-emerald-400" title={`residual ±${d.residual}m`}>
            ({d.pos!.x}, {d.pos!.y})m
          </div>
        ) : d.nearestMeters != null ? (
          <div className="text-[9px] text-gray-500">~{d.nearestMeters}m · {d.vantagesHeard}/3</div>
        ) : null}
      </div>
    </div>
  );
}
