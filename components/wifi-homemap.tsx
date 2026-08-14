"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hint } from "@/components/hint";
import { planBounds, wallSegments, type FloorPlan } from "@/lib/floorplan-core";
import { rssiBars, type DeviceKind } from "@/lib/survey-core";
import type { HomeMap, PositionedDevice, Pin } from "@/lib/homemap-core";
import {
  updateTracks, deviceMotion, MOTION_COLOR, MOTION_LABEL,
  type Track, type MotionRead,
} from "@/lib/live-monitor-core";

type Machine = { id: string; name: string; wifi: string[] };

type VantageStatus = {
  id: string; x: number; y: number; label: string; capturedAt: number;
  pending: boolean; error: string | null;
  summary: { aps: number; stations: number; named: number; open: number; strongest: number | null } | null;
};

type SurveyState = { vantages: VantageStatus[]; pins: Pin[]; map: HomeMap; pending: boolean };

const KIND_COLOR: Record<DeviceKind, string> = {
  router: "#60a5fa", phone: "#34d399", laptop: "#a78bfa", computer: "#a78bfa", iot: "#fbbf24", unknown: "#94a3b8",
};
const KIND_LABEL: Record<DeviceKind, string> = {
  router: "Router / AP", phone: "Phone", laptop: "Laptop", computer: "Computer", iot: "IoT", unknown: "Device",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function WifiHomemap({ machines, defaultIface, plan }: { machines: Machine[]; defaultIface?: string; plan: FloorPlan }) {
  const [runnerId, setRunnerId] = useState(machines[0]?.id ?? "");
  const ifaces = useMemo(() => machines.find((x) => x.id === runnerId)?.wifi ?? [], [machines, runnerId]);
  const [iface, setIface] = useState(defaultIface ?? "");
  const [seconds, setSeconds] = useState(25);
  const [mode, setMode] = useState<"capture" | "pin">("capture");
  const [pinTarget, setPinTarget] = useState("");
  const [stand, setStand] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<SurveyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [liveOn, setLiveOn] = useState(false);
  const [, setTick] = useState(0);
  const [phase, setPhase] = useState(0);
  const tracksRef = useRef<Map<string, Track>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => { if (!iface && ifaces[0]) setIface(ifaces[0]); }, [ifaces, iface]);

  const bounds = useMemo(() => planBounds(plan), [plan]);
  const walls = useMemo(() => wallSegments(plan), [plan]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/sensing/survey", { cache: "no-store" });
      if (r.ok) setState(await r.json());
    } catch { /* transient */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!state?.pending) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [state?.pending, refresh]);

  // --- Live monitor loop: auto re-survey, accumulate per-device motion. ---
  useEffect(() => {
    if (!liveOn) return;
    if (!runnerId || !iface) { setNote("Pick a machine + adapter before going live."); setLiveOn(false); return; }
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        try {
          const r = await fetch("/api/sensing/survey", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runnerId, iface, live: true, seconds: 12 }),
          });
          const j = await r.json();
          if (!r.ok || !j.jobId) { await sleep(2500); continue; }
          let survey = null;
          for (let i = 0; i < 40 && !cancelled; i++) {
            await sleep(1500);
            const pr = await fetch(`/api/sensing/survey?job=${j.jobId}`, { cache: "no-store" });
            const pj = await pr.json().catch(() => ({}));
            if (pj.status === "done") { survey = pj.survey; break; }
            if (pj.status === "error" || pj.status === "canceled") break;
          }
          if (cancelled) break;
          if (survey && !survey.error) {
            tracksRef.current = updateTracks(tracksRef.current, survey, Date.now());
            setTick((t) => t + 1);
          }
        } catch { await sleep(2500); }
      }
    })();
    return () => { cancelled = true; };
  }, [liveOn, runnerId, iface]);

  // Gentle pulse for live rings.
  useEffect(() => {
    if (!liveOn) return;
    let raf = 0, start = performance.now();
    const step = (now: number) => { setPhase(((now - start) / 1400) % 1); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [liveOn]);

  const CW = 520, CH = 400, pad = 28;
  const scale = Math.min((CW - 2 * pad) / bounds.w, (CH - 2 * pad) / bounds.h);
  const sx = useCallback((mx: number) => pad + mx * scale, [scale]);
  const sy = useCallback((my: number) => pad + my * scale, [scale]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current; if (!cv) return;
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId, iface, x: stand.x, y: stand.y, seconds, label: `Spot ${(state?.vantages.length ?? 0) + 1}` }),
      });
      const j = await r.json();
      if (!r.ok) setNote(j.error ?? "Capture failed.");
      else { setStand(null); setNote(`Capturing ~${j.seconds}s at (${stand.x}, ${stand.y}) m — walk after it finishes.`); await refresh(); }
    } catch { setNote("Network error."); } finally { setBusy(false); }
  }

  async function addPin() {
    if (!pinTarget) { setNote("Pick which AP to pin from the list."); return; }
    if (!stand) { setNote("Tap the plan where that router physically sits, then pin."); return; }
    const ap = state?.map.aps.find((a) => a.id === pinTarget);
    setBusy(true); setNote("");
    try {
      const r = await fetch("/api/sensing/survey", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: { bssid: pinTarget, x: stand.x, y: stand.y, label: ap?.essid ?? "" } }),
      });
      const j = await r.json();
      if (!r.ok) setNote(j.error ?? "Pin failed.");
      else { setStand(null); setPinTarget(""); setMode("capture"); await refresh(); }
    } catch { setNote("Network error."); } finally { setBusy(false); }
  }

  async function removePin(bssid: string) {
    await fetch(`/api/sensing/survey?pin=${encodeURIComponent(bssid)}`, { method: "DELETE" });
    await refresh();
  }
  async function clearAll() {
    if (!confirm("Clear all captured vantages and start a fresh walk? (pins are kept)")) return;
    await fetch("/api/sensing/survey", { method: "DELETE" });
    setState(null); setStand(null); await refresh();
  }
  async function dropVantage(id: string) {
    await fetch(`/api/sensing/survey?vantage=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }

  const singleVantage = useMemo(() => {
    if (!state) return null;
    const done = state.vantages.filter((v) => !v.pending && !v.error && v.summary);
    return done.length === 1 ? done[0] : null;
  }, [state]);

  // Live motion reads for the whole track set (recomputed each render/tick).
  const liveReads = useMemo(() => {
    const now = Date.now();
    const out: { track: Track; read: MotionRead }[] = [];
    for (const t of tracksRef.current.values()) out.push({ track: t, read: deviceMotion(t, now) });
    return out.sort((a, b) => (b.track.samples.at(-1)?.rssi ?? -999) - (a.track.samples.at(-1)?.rssi ?? -999));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, liveOn]);

  useEffect(() => {
    const cv = canvasRef.current; const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(8,12,16,0.75)"; ctx.fillRect(0, 0, CW, CH);

    // Coverage footprint.
    const fp = state?.map.footprint ?? [];
    if (fp.length >= 3) {
      ctx.beginPath(); ctx.moveTo(sx(fp[0].x), sy(fp[0].y));
      for (const p of fp.slice(1)) ctx.lineTo(sx(p.x), sy(p.y));
      ctx.closePath();
      ctx.fillStyle = "rgba(52,211,153,0.08)"; ctx.fill();
      ctx.strokeStyle = "rgba(52,211,153,0.35)"; ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }

    // Wall hints (from pinned-AP radio tomography).
    for (const w of state?.map.wallHints.points ?? []) {
      ctx.fillStyle = `rgba(248,113,113,${0.12 + w.v * 0.35})`;
      ctx.fillRect(sx(w.x) - 2, sy(w.y) - 2, 4, 4);
    }

    // Floor-plan walls.
    ctx.strokeStyle = "rgba(148,163,184,0.35)"; ctx.lineWidth = 1.5;
    for (const w of walls) { ctx.beginPath(); ctx.moveTo(sx(w.x1), sy(w.y1)); ctx.lineTo(sx(w.x2), sy(w.y2)); ctx.stroke(); }
    ctx.fillStyle = "rgba(148,163,184,0.5)"; ctx.font = "10px ui-sans-serif, system-ui";
    for (const r of plan.rooms) ctx.fillText(r.name, sx(r.x) + 4, sy(r.y) + 12);

    // Single-vantage rings.
    if (singleVantage && state && !liveOn) {
      const vx = sx(singleVantage.x), vy = sy(singleVantage.y);
      ctx.strokeStyle = "rgba(96,165,250,0.16)"; ctx.lineWidth = 1;
      for (const d of state.map.devices) if (d.nearestMeters != null) {
        ctx.beginPath(); ctx.arc(vx, vy, d.nearestMeters * scale, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Vantages.
    for (const v of state?.vantages ?? []) {
      const x = sx(v.x), y = sy(v.y);
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = v.pending ? "rgba(251,191,36,0.9)" : v.error ? "rgba(248,113,113,0.9)" : "rgba(56,189,248,0.95)";
      ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.font = "9px ui-sans-serif"; ctx.fillText(v.label, x + 8, y + 3);
    }

    // Positioned devices.
    for (const d of state?.map.devices ?? []) {
      if (!d.pos) continue;
      const x = sx(d.pos.x), y = sy(d.pos.y);
      const c = KIND_COLOR[d.kind] ?? KIND_COLOR.unknown;
      if (d.isAp) { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 6, y); ctx.closePath(); }
      else { ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); }
      ctx.fillStyle = c; ctx.fill();
      ctx.strokeStyle = d.pinned ? "rgba(56,189,248,0.95)" : "rgba(0,0,0,0.5)"; ctx.lineWidth = d.pinned ? 2 : 1; ctx.stroke();
      if (d.pinned) { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.strokeStyle = "rgba(56,189,248,0.5)"; ctx.lineWidth = 1; ctx.stroke(); }
      const lbl = d.essid || d.vendor || d.id.slice(-5);
      ctx.fillStyle = "rgba(226,232,240,0.9)"; ctx.font = "9px ui-sans-serif"; ctx.fillText(lbl.slice(0, 14), x + 7, y - 5);
    }

    // Live motion overlay: pulsing rings on positioned devices, colored by motion.
    if (liveOn) {
      const posById = new Map((state?.map.devices ?? []).filter((d) => d.pos).map((d) => [d.id, d.pos!]));
      for (const { track, read } of liveReads) {
        if (read.state === "gone") continue;
        const p = posById.get(track.id);
        const col = MOTION_COLOR[read.state];
        if (p) {
          const x = sx(p.x), y = sy(p.y);
          const rad = 8 + phase * 12 + read.variance;
          ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
          ctx.strokeStyle = hexA(col, 0.5 * (1 - phase)); ctx.lineWidth = 2; ctx.stroke();
        } else if (stand && read.meters != null) {
          // Not positioned — ring at live distance around the monitor spot.
          const vx = sx(stand.x), vy = sy(stand.y);
          ctx.beginPath(); ctx.arc(vx, vy, read.meters * scale, 0, Math.PI * 2);
          ctx.strokeStyle = hexA(col, 0.3); ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
    }

    // "You are here" / pin-target marker.
    if (stand) {
      const x = sx(stand.x), y = sy(stand.y);
      const c = mode === "pin" ? "rgba(56,189,248,0.95)" : "rgba(52,211,153,0.95)";
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke();
    }
  }, [state, walls, plan.rooms, sx, sy, scale, stand, singleVantage, liveOn, liveReads, phase, mode]);

  const map = state?.map;
  const resolvedCount = state?.vantages.filter((v) => !v.pending && !v.error).length ?? 0;

  return (
    <div className="card mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-white">
          🗺 Auto home map — walk &amp; sense{" "}
          <Hint>
            Tap the plan where you&apos;re standing, capture, move, repeat. After <b>3+ spots</b> your fixed routers
            become anchors and every device gets a real position. <b>Pin</b> a router at its true spot to sharpen
            positioning and reveal wall hints. <b>Live monitor</b> keeps re-surveying to show who&apos;s moving.
          </Hint>
        </span>
        {map?.canPosition ? <span className="tag ring-emerald accent-emerald">● positioning live</span>
          : <span className="tag border-amber-500/40 text-amber-300">{resolvedCount}/3 spots · walk to position</span>}
        {(state?.pins.length ?? 0) > 0 && <span className="tag border-sky-500/40 text-sky-300">📌 {state!.pins.length} pinned</span>}
        {liveOn && <span className="tag border-emerald-500/40 text-emerald-300 animate-pulse">◉ live monitor</span>}
      </div>

      {/* Mode + controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <div className="flex rounded-md border border-surface-border p-0.5">
          <button onClick={() => setMode("capture")} className={`rounded px-2 py-1 ${mode === "capture" ? "bg-brand/20 text-brand" : "text-gray-400"}`}>Walk</button>
          <button onClick={() => setMode("pin")} className={`rounded px-2 py-1 ${mode === "pin" ? "bg-sky-500/20 text-sky-300" : "text-gray-400"}`}>Pin AP</button>
        </div>
        <select value={runnerId} onChange={(e) => setRunnerId(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand">
          {machines.length === 0 && <option value="">No machine online</option>}
          {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={iface} onChange={(e) => setIface(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand">
          {ifaces.length === 0 && <option value="">No adapter</option>}
          {ifaces.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>

        {mode === "capture" ? (
          <>
            <label className="flex items-center gap-1 text-gray-400">
              dwell
              <input type="range" min={8} max={60} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-20" />
              <span className="w-8 tabular-nums">{seconds}s</span>
            </label>
            <button disabled={busy || !stand || liveOn} onClick={capture} className="btn-primary px-3 py-1 disabled:opacity-50">
              {busy ? "Queuing…" : stand ? `Capture (${stand.x}, ${stand.y})` : "Tap the plan first"}
            </button>
          </>
        ) : (
          <>
            <select value={pinTarget} onChange={(e) => setPinTarget(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand">
              <option value="">Pick an AP…</option>
              {(map?.aps ?? []).map((a) => <option key={a.id} value={a.id}>{a.essid || a.vendor || a.id.slice(-8)} ({a.bestRssi}dBm)</option>)}
            </select>
            <button disabled={busy || !stand || !pinTarget} onClick={addPin} className="rounded-md bg-sky-500/20 px-3 py-1 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              {stand ? `Pin here (${stand.x}, ${stand.y})` : "Tap where it sits"}
            </button>
          </>
        )}

        <button onClick={() => setLiveOn((v) => !v)} className={`ml-auto rounded-md px-3 py-1 ${liveOn ? "bg-red-500/20 text-red-300" : "bg-emerald-500/20 text-emerald-300"}`}>
          {liveOn ? "■ Stop live" : "◉ Live monitor"}
        </button>
        {(state?.vantages.length ?? 0) > 0 && <button onClick={clearAll} className="btn-ghost px-2 py-1">Clear walk</button>}
      </div>
      {note && <p className="mt-2 text-[11px] text-amber-300">{note}</p>}

      <div className="mt-3 grid gap-4 lg:grid-cols-[520px_1fr]">
        <div>
          <canvas ref={canvasRef} width={CW} height={CH} onClick={onCanvasClick} className="w-full cursor-crosshair rounded-xl border border-surface-border" />
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
            <span><span className="text-sky-400">●</span> stood here</span>
            <span><span className="text-blue-400">◆</span> AP · <span className="text-sky-400">◎</span> pinned</span>
            <span><span className="text-emerald-400">●</span> phone</span>
            <span><span className="text-violet-400">●</span> laptop</span>
            <span><span className="text-amber-400">●</span> IoT</span>
            <span className="text-emerald-500">▢ coverage</span>
            <span className="text-red-400">▪ wall hint</span>
          </div>
        </div>

        <div className="space-y-3">
          {liveOn ? (
            <div>
              <span className="text-xs font-semibold text-emerald-300">Live — {liveReads.filter((r) => r.read.state !== "gone").length} active devices</span>
              <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1">
                {liveReads.filter((r) => r.read.state !== "gone").slice(0, 60).map(({ track, read }) => (
                  <div key={track.id} className="flex items-center gap-2 rounded-md border border-surface-border/60 bg-surface/40 px-2 py-1 text-[11px]">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: MOTION_COLOR[read.state] }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-200">{track.essid || track.vendor || track.id}</div>
                      <div className="font-mono text-[10px] text-gray-500">{track.id}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular-nums text-gray-400">{track.samples.at(-1)?.rssi} dBm</div>
                      <div className="text-[9px]" style={{ color: MOTION_COLOR[read.state] }}>
                        {MOTION_LABEL[read.state]}{read.meters != null ? ` · ~${read.meters}m` : ""}
                      </div>
                    </div>
                  </div>
                ))}
                {liveReads.length === 0 && <p className="text-xs text-gray-500">Listening… first sweep takes ~12s.</p>}
              </div>
            </div>
          ) : map && map.devices.length > 0 ? (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">{map.devices.length} devices · {map.positionedCount} positioned</span>
                <span className="text-[10px] text-gray-500">{map.aps.length} APs · {map.stations.length} clients</span>
              </div>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                {map.devices.slice(0, 60).map((d) => <DeviceRow key={d.id} d={d} onPin={d.isAp ? () => { setMode("pin"); setPinTarget(d.id); } : undefined} />)}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No survey yet. Pick your monitor adapter, tap where you&apos;re standing, and capture your first spot.</p>
          )}

          {(state?.pins.length ?? 0) > 0 && (
            <div>
              <span className="text-xs font-semibold text-gray-200">Pinned routers</span>
              <div className="mt-1 space-y-1">
                {state!.pins.map((p) => (
                  <div key={p.bssid} className="flex items-center gap-2 text-[11px]">
                    <span className="text-sky-400">📌</span>
                    <span className="text-gray-300">{p.label || p.bssid}</span>
                    <span className="text-gray-600">({p.x}, {p.y})m</span>
                    <button onClick={() => removePin(p.bssid)} className="ml-auto text-gray-600 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            </div>
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
                      : v.error ? <span className="truncate text-red-300" title={v.error}>{v.error}</span>
                      : v.summary ? <span className="text-gray-500">{v.summary.aps} APs · {v.summary.stations} clients</span> : null}
                    <button onClick={() => dropVantage(v.id)} className="ml-auto text-gray-600 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-[11px] text-gray-500">
        <b className="text-gray-400">Honest limits.</b> Positions are RSSI estimates (±a couple of metres) and
        need ≥3 spots that heard the device. Wall hints are coarse radio-tomography from pinned APs — a guide,
        not a survey. Live motion is 1D from one adapter (variance = moving, trend = closer/further); true 2D
        paths need a multi-node mesh. Pose/vitals need CSI hardware (AR9271 can&apos;t). Authorized spaces only.
      </p>
    </div>
  );
}

/** "#rrggbb" + alpha → rgba() string. */
function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(2)})`;
}

function DeviceRow({ d, onPin }: { d: PositionedDevice; onPin?: () => void }) {
  const c = KIND_COLOR[d.kind] ?? KIND_COLOR.unknown;
  return (
    <div className="flex items-center gap-2 rounded-md border border-surface-border/60 bg-surface/40 px-2 py-1 text-[11px]">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-gray-200">{d.essid || d.vendor || KIND_LABEL[d.kind]}</span>
          {d.pinned && <span className="text-[9px] text-sky-400">📌</span>}
          {d.isAp && d.privacy && <span className="text-[9px] text-gray-500">{d.privacy}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <span className="font-mono">{d.id}</span>
          {d.channel != null && <span>· ch{d.channel}</span>}
          {rssiBars(d.bestRssi) > 0 && <span>· {rssiBars(d.bestRssi)}%</span>}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="tabular-nums text-gray-400">{d.bestRssi} dBm</div>
        {d.positioned ? (
          <div className="text-[9px] text-emerald-400" title={d.pinned ? "pinned (exact)" : `residual ±${d.residual}m`}>
            ({d.pos!.x}, {d.pos!.y})m
          </div>
        ) : d.nearestMeters != null ? <div className="text-[9px] text-gray-500">~{d.nearestMeters}m · {d.vantagesHeard}/3</div> : null}
      </div>
      {onPin && !d.pinned && <button onClick={onPin} className="shrink-0 text-[9px] text-sky-400 hover:text-sky-300" title="Pin this router">📌</button>}
    </div>
  );
}
