"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { SenseAnalysis } from "@/lib/wifi-sense-core";
import type { SpatialFrame, Grid } from "@/lib/wifi-fusion-core";

export type CameraMachine = { id: string; name: string; wifi: string[] };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Occupancy intensity → heat colour (transparent → teal → green → amber).
function heat(v: number): [number, number, number, number] {
  const c = clamp01(v);
  const r = Math.round(255 * clamp01(c * 1.9 - 0.7));
  const g = Math.round(255 * clamp01(c * 1.5));
  const b = Math.round(255 * clamp01(0.7 - c * 0.7) + 20);
  const a = Math.round(255 * clamp01(c * 1.15));
  return [r, g, b, a];
}

function drawField(cv: HTMLCanvasElement | null, frame: SpatialFrame | null, tPulse: number) {
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);

  // Dark room floor + grid.
  ctx.fillStyle = "rgba(8,12,16,0.55)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const x = (i / 8) * W, y = (i / 8) * H;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  if (!frame) return;

  const g: Grid = frame.grid;
  // Render the occupancy grid as a smooth heatmap via an offscreen image.
  const img = ctx.createImageData(g.w, g.h);
  for (let i = 0; i < g.cells.length; i++) {
    const [r, gg, b, a] = heat(g.cells[i]);
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
  }
  // Scale the small grid up onto the canvas with smoothing.
  const off = document.createElement("canvas");
  off.width = g.w; off.height = g.h;
  off.getContext("2d")!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.92;
  ctx.drawImage(off, 0, 0, W, H);
  ctx.globalAlpha = 1;

  // AP anchors.
  for (const a of frame.anchors) {
    const x = a.x * W, y = a.y * H;
    ctx.fillStyle = "rgba(110,231,183,0.95)";
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(148,163,184,0.9)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(a.label, x + 6, y + 3);
  }

  // Person markers — pulsing rings.
  for (const m of frame.markers) {
    const x = m.x * W, y = m.y * H;
    const pulse = 6 + 3 * Math.sin(tPulse * 4);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, pulse + 6 * m.intensity, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

// ── Demo generator (no hardware): a person walking a figure-eight ────────────
function demoFrame(t: number): { spatial: SpatialFrame; analysis: Partial<SenseAnalysis> } {
  const w = 40, h = 30;
  const cells = new Array(w * h).fill(0);
  const cx = 0.5 + 0.3 * Math.sin(t * 0.6);
  const cy = 0.5 + 0.25 * Math.sin(t * 1.2);
  const px = cx * w, py = cy * h;
  let best = 0, bx = 0, by = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - px, y - py);
      const v = clamp01(Math.exp(-(d * d) / 18) * 0.95);
      cells[y * w + x] = v;
      if (v > best) { best = v; bx = x; by = y; }
    }
  const spatial: SpatialFrame = {
    grid: { w, h, meters: { w: 8, h: 6 }, cells },
    markers: [{ x: bx / w, y: by / h, intensity: best, meters: { x: cx * 8, y: cy * 6 } }],
    anchors: [{ x: 0.5, y: 0.04, label: "AP" }],
    occupancy: 1,
    mode: "radial",
  };
  const speed = Math.abs(Math.cos(t * 0.6)) * 1.1;
  return {
    spatial,
    analysis: {
      activity: speed > 0.35 ? "walking" : "still",
      speedMps: Math.round(speed * 100) / 100,
      speedLabel: speed > 0.35 ? "walking" : "still",
      direction: Math.cos(t * 0.6) > 0 ? "approaching" : "receding",
      rangeMeters: Math.round((2 + 2 * Math.abs(Math.sin(t * 0.3))) * 10) / 10,
      breathingBpm: 15 + Math.round(2 * Math.sin(t * 0.2)),
      personEstimate: 1,
      confidence: 0.72,
      presentPct: 100,
      movement: clamp01(0.3 + speed * 0.4),
    },
  };
}

/**
 * "WiFi camera" — a top-down occupancy view built from a real RSSI capture on a
 * runner (motion → range → heatmap), or a labelled DEMO when no hardware is
 * connected. The heatmap, markers and readouts are the same shape either way.
 */
export function WifiCamera({
  machines,
  defaultIface,
}: {
  machines: CameraMachine[];
  defaultIface?: string;
}) {
  const firstMachine = machines[0];
  const [machineId, setMachineId] = useState(firstMachine?.id ?? "");
  const [iface, setIface] = useState(
    defaultIface ?? firstMachine?.wifi?.[0] ?? "wlan0",
  );
  const [mode, setMode] = useState<"live" | "csi" | "demo">(machines.length ? "live" : "demo");
  const [running, setRunning] = useState(machines.length === 0);
  const [status, setStatus] = useState<string>("");
  const [analysis, setAnalysis] = useState<Partial<SenseAnalysis> | null>(null);
  const [spatial, setSpatial] = useState<SpatialFrame | null>(null);
  // CSI-only extras (velocity sign, angle-of-arrival, heart rate).
  const [csiExtra, setCsiExtra] = useState<{ heartBpm: number | null; azimuthDeg: number | null; fresh: boolean } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<SpatialFrame | null>(null);
  frameRef.current = spatial;

  // Continuous render loop (pulsing markers) regardless of data source.
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      drawField(canvasRef.current, frameRef.current, now / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Demo animation.
  useEffect(() => {
    if (mode !== "demo" || !running) return;
    let raf = 0, t0 = 0;
    const loop = (now: number) => {
      if (!t0) t0 = now;
      const { spatial: sp, analysis: an } = demoFrame((now - t0) / 1000);
      setSpatial(sp);
      setAnalysis(an);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [mode, running]);

  // Live capture loop: run a real sensing job, poll it, render, repeat.
  const liveLoop = useRef(false);
  const runLive = useCallback(async () => {
    if (liveLoop.current) return;
    liveLoop.current = true;
    try {
      while (liveLoop.current) {
        setStatus("capturing…");
        const res = await fetch("/api/sensing/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runnerId: machineId, iface, seconds: 8 }),
        });
        const { jobId, error } = await res.json();
        if (error || !jobId) { setStatus(error || "could not start"); break; }
        // Poll until done.
        let done = false;
        for (let i = 0; i < 40 && liveLoop.current && !done; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const g = await fetch(`/api/sensing/run?job=${jobId}`).then((r) => r.json());
          if (g.status === "done") {
            done = true;
            if (g.spatial) setSpatial(g.spatial);
            if (g.analysis) setAnalysis(g.analysis);
            setStatus(g.analysis?.error ? String(g.analysis.error) : "live");
          } else if (g.status === "failed" || g.status === "canceled") {
            setStatus(g.status); done = true;
          } else {
            setStatus(`capturing… (${g.status})`);
          }
        }
      }
    } finally {
      liveLoop.current = false;
    }
  }, [machineId, iface]);

  useEffect(() => {
    if (mode === "live" && running) runLive();
    return () => { liveLoop.current = false; };
  }, [mode, running, runLive]);

  // CSI mode: poll the latest imaging result posted by a CSI collector.
  useEffect(() => {
    if (mode !== "csi" || !running) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/sensing/csi").then((x) => x.json());
        const cs = r?.analysis;
        if (cs && cs.spatial) {
          setSpatial(cs.spatial);
          setAnalysis({
            presentPct: cs.present ? 100 : 0,
            personEstimate: cs.occupancy ?? 0,
            speedMps: Math.abs(cs.velocityMps ?? 0),
            speedLabel: Math.abs(cs.velocityMps ?? 0) > 0.35 ? "walking" : "still",
            direction: (cs.velocityMps ?? 0) > 0.05 ? "approaching" : (cs.velocityMps ?? 0) < -0.05 ? "receding" : "lateral",
            rangeMeters: cs.rangeMeters ?? null,
            breathingBpm: cs.breathingBpm ?? null,
            movement: cs.motion ?? 0,
            confidence: cs.quality ?? 0,
            activity: cs.present ? (Math.abs(cs.velocityMps ?? 0) > 0.35 ? "walking" : cs.breathingBpm ? "breathing" : "still") : "empty",
          });
          setCsiExtra({ heartBpm: cs.heartBpm ?? null, azimuthDeg: cs.azimuthDeg ?? null, fresh: !!r.fresh });
          setStatus(r.fresh ? "CSI live" : `CSI · last seen ${Math.round((r.ageMs ?? 0) / 1000)}s ago`);
        } else {
          setStatus("waiting for CSI collector… (run runner/csi_collector.py)");
        }
      } catch {
        setStatus("CSI poll failed");
      }
    };
    tick();
    const id = setInterval(() => { if (!stop) tick(); }, 1500);
    return () => { stop = true; clearInterval(id); };
  }, [mode, running]);

  const a = analysis ?? {};
  const present = (a.presentPct ?? 0) > 12 || (a.personEstimate ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Live vs Demo clarity — make it obvious when this isn't real signal. */}
      {machines.length === 0 ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          ◐ <b>Demo (simulation)</b> — no runner connected, so this is a synthetic walk-through, not
          your real room. Connect a machine running the engine (with WiFi) to read real signal.
        </div>
      ) : mode === "demo" ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-200/90">
          ◐ Demo mode — simulated. Switch to <b>Live · real WiFi</b> and press Start to read the room.
        </div>
      ) : !running ? (
        <div className="rounded-xl border border-surface-border px-4 py-2 text-xs text-gray-400">
          ▶ Press Start to begin a live capture. Note: this shows <b>motion</b> — people must move to
          appear; standing-still people barely perturb the signal.
        </div>
      ) : null}

      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-3">
        <button
          onClick={() => setRunning((r) => !r)}
          className={running ? "btn-ghost text-sm" : "btn-primary text-sm"}
        >
          {running ? "⏸ Pause" : "▶ Start"}
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setMode("live")}
            disabled={machines.length === 0}
            className={`tag ${mode === "live" ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400"} disabled:opacity-40`}
          >
            Live · real WiFi
          </button>
          <button
            onClick={() => setMode("csi")}
            className={`tag ${mode === "csi" ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400"}`}
            title="Full CSI imaging — needs a CSI collector running"
          >
            CSI · imaging
          </button>
          <button
            onClick={() => setMode("demo")}
            className={`tag ${mode === "demo" ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400"}`}
          >
            Demo
          </button>
        </div>

        {mode === "live" && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              Machine
              <select
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              Interface
              <select
                value={iface}
                onChange={(e) => setIface(e.target.value)}
                className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
              >
                {(machines.find((m) => m.id === machineId)?.wifi ?? ["wlan0"]).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <span className="ml-auto text-xs text-gray-500">
          {mode === "demo" ? "simulated walk-through" : status || "idle"}
        </span>
      </div>

      {/* Camera + readouts */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="card">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-white">WiFi camera — top-down occupancy</span>
            <span className="tag">
              {mode === "demo"
                ? "DEMO"
                : mode === "csi"
                  ? csiExtra?.azimuthDeg != null ? "CSI · 2D (AoA)" : "CSI · imaging"
                  : spatial?.mode === "multilateration" ? "multi-AP" : "single-AP · radial"}
            </span>
          </div>
          <canvas
            ref={canvasRef}
            width={480}
            height={360}
            className="mt-3 w-full rounded-xl border border-surface-border"
          />
          <p className="mt-2 text-[11px] text-gray-500">
            Movement in the space perturbs WiFi multipath; the heatmap places that energy at its
            estimated range. Bright rings mark likely people. Single-AP shows range (a ring); multiple
            APs intersect into real zones. True pose needs CSI hardware.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 self-start">
          <Tile label="Presence" value={present ? "yes" : "—"} sub={present ? `${a.personEstimate ?? 1} person(s)` : "room empty"} glow={present} />
          <Tile label="Activity" value={cap(a.activity ?? "—")} sub="classified" accent="amber" />
          <Tile label="Speed" value={present && a.speedMps ? `${a.speedMps}` : "—"} sub={`m/s · ${a.speedLabel ?? "still"}`} accent="sky" />
          <Tile label="Direction" value={dirArrow(a.direction)} sub={a.direction ?? "—"} accent="sky" />
          <Tile label="Breathing" value={a.breathingBpm != null ? `${a.breathingBpm}` : "—"} sub="breaths/min" accent="rose" />
          <Tile label="Range" value={a.rangeMeters != null ? `${a.rangeMeters}` : "—"} sub="metres (approx)" />
          {mode === "csi" ? (
            <>
              <Tile label="Heart rate" value={csiExtra?.heartBpm != null ? `${csiExtra.heartBpm}` : "—"} sub="beats/min · CSI" accent="rose" />
              <Tile label="Angle" value={csiExtra?.azimuthDeg != null ? `${csiExtra.azimuthDeg}°` : "—"} sub="bearing (AoA)" accent="sky" />
            </>
          ) : (
            <>
              <Tile label="Motion" value={`${Math.round((a.movement ?? 0) * 100)}%`} sub="activity level" accent="amber" />
              <Tile label="Confidence" value={`${Math.round((a.confidence ?? 0) * 100)}%`} sub="analysis" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function cap(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—"; }
function dirArrow(d?: string): string {
  return d === "approaching" ? "↓" : d === "receding" ? "↑" : d === "lateral" ? "↔" : "•";
}

function Tile({
  label, value, sub, accent, glow,
}: {
  label: string; value: string; sub: string;
  accent?: "sky" | "rose" | "amber"; glow?: boolean;
}) {
  const color =
    accent === "sky" ? "text-sky-300" : accent === "rose" ? "text-rose-300" : accent === "amber" ? "text-amber-300" : "text-brand";
  return (
    <div className={`card !p-3 ${glow ? "ring-1 ring-emerald-500/30" : ""}`}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-500">{sub}</p>
    </div>
  );
}
