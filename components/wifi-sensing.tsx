"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  simulateFrame,
  POSE_EDGES,
  type SensingFrame,
  type Scenario,
} from "@/lib/sensing-core";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// CSI amplitude → heat colour (dark → teal → green → yellow).
function heat(v: number): string {
  const c = clamp01(v);
  const r = Math.round(255 * clamp01(c * 1.7 - 0.5));
  const g = Math.round(255 * clamp01(c * 1.35));
  const b = Math.round(255 * clamp01(0.55 - c * 0.55) + 30);
  return `rgb(${r},${g},${b})`;
}

function drawWaterfall(cv: HTMLCanvasElement | null, csi: number[]) {
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const { width: w, height: h } = cv;
  ctx.drawImage(cv, -1, 0); // scroll left 1px
  const n = csi.length;
  for (let k = 0; k < n; k++) {
    const y0 = Math.floor((k / n) * h);
    const y1 = Math.floor(((k + 1) / n) * h);
    ctx.fillStyle = heat(csi[k]);
    ctx.fillRect(w - 1, y0, 1, Math.max(1, y1 - y0));
  }
}

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "empty", label: "Empty room" },
  { id: "resting", label: "Resting" },
  { id: "active", label: "Active" },
  { id: "fall", label: "Simulate fall" },
];

/**
 * Live WiFi spatial-sensing dashboard. Runs our sensing engine (currently a
 * physically-plausible simulator) in a rAF loop and renders presence, vitals,
 * pose and the CSI "waterfall". Swap simulateFrame() for a real CSI feed later.
 */
export function WifiSensing({
  interfaces,
  defaultIface,
}: {
  interfaces: string[];
  defaultIface?: string;
}) {
  const [running, setRunning] = useState(true);
  const [scenario, setScenario] = useState<Scenario>("auto");
  const [sensitivity, setSensitivity] = useState(0.6);
  const [iface, setIface] = useState(defaultIface ?? interfaces[0] ?? "wlan0");
  const [frame, setFrame] = useState<SensingFrame | null>(null);

  const tRef = useRef(0);
  const vitalBuf = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const optsRef = useRef({ scenario, sensitivity });
  optsRef.current = { scenario, sensitivity };

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let lastNow = 0;
    let lastEmit = 0;
    const loop = (now: number) => {
      if (!lastNow) lastNow = now;
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      tRef.current += dt;
      const f = simulateFrame(tRef.current, {
        scenario: optsRef.current.scenario,
        sensitivity: optsRef.current.sensitivity,
        subcarriers: 64,
      });
      const buf = vitalBuf.current;
      buf.push(f.vital);
      if (buf.length > 240) buf.shift();
      drawWaterfall(canvasRef.current, f.csi);
      if (now - lastEmit > 50) {
        setFrame(f);
        lastEmit = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  // Vital trace polyline from the ring buffer.
  const vitalPath = useMemo(() => {
    const b = vitalBuf.current;
    if (!b.length) return "";
    const W = 240;
    const H = 40;
    return b
      .map((v, i) => `${((i / (b.length - 1 || 1)) * W).toFixed(1)},${(H / 2 - v * (H / 2 - 2)).toFixed(1)}`)
      .join(" ");
    // frame drives re-render at ~20fps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const f = frame;
  const present = f?.present ?? false;

  return (
    <div className="mt-4 space-y-4">
      {/* Fall alert */}
      {f?.fall && (
        <div className="animate-pulse rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200">
          <Icon name="alert" className="mr-1 inline h-4 w-4" /> Fall detected — sudden collapse then stillness on {iface}.
        </div>
      )}

      {/* Controls */}
      <div className="card flex flex-wrap items-center gap-3">
        <button
          onClick={() => setRunning((r) => !r)}
          className={running ? "btn-ghost text-sm" : "btn-primary text-sm"}
        >
          {running ? "⏸ Pause" : "▶ Start sensing"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          Interface
          <select
            value={iface}
            onChange={(e) => setIface(e.target.value)}
            className="rounded-lg border border-surface-border bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
          >
            {(interfaces.length ? interfaces : ["wlan0"]).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScenario(s.id)}
              className={`tag ${scenario === s.id ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          Sensitivity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="accent-emerald-500"
          />
        </label>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Occupancy" value={present ? String(f?.occupancy ?? 0) : "0"} sub={present ? "people detected" : "room empty"} glow={present} />
        <Tile
          label="Breathing"
          value={present ? `${f?.breathingBpm}` : "—"}
          sub="breaths / min"
          accent="sky"
        />
        <Tile
          label="Heart rate"
          value={present ? `${f?.heartBpm}` : "—"}
          sub="beats / min"
          accent="rose"
        />
        <Tile
          label="Motion"
          value={`${Math.round((f?.motion ?? 0) * 100)}%`}
          sub="activity level"
          accent="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Vitals trace */}
        <div className="card">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-white">Vital-sign waveform</span>
            <span className="text-xs text-gray-500">breathing + heartbeat, from CSI amplitude</span>
          </div>
          <svg viewBox="0 0 240 40" preserveAspectRatio="none" className="mt-3 h-16 w-full">
            <polyline points={vitalPath} fill="none" stroke="rgb(52 211 153)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
            <span>Signal quality {Math.round((f?.quality ?? 0) * 100)}%</span>
            <span className={present ? "text-emerald-400" : "text-gray-500"}>
              ● {present ? "person present" : "no presence"}
            </span>
          </div>
        </div>

        {/* Pose skeleton */}
        <div className="card">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-white">Pose estimate</span>
            <span className="text-xs text-gray-500">17 keypoints, no camera</span>
          </div>
          <svg viewBox="0 0 100 140" className="mx-auto mt-2 h-48">
            {present && f
              ? (
                <>
                  {POSE_EDGES.map(([a, b], i) => (
                    <line
                      key={i}
                      x1={f.pose[a].x * 100}
                      y1={f.pose[a].y * 140}
                      x2={f.pose[b].x * 100}
                      y2={f.pose[b].y * 140}
                      stroke={f.fall ? "rgb(248 113 113)" : "rgb(52 211 153)"}
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      opacity={0.85}
                    />
                  ))}
                  {f.pose.map((k, i) => (
                    <circle key={i} cx={k.x * 100} cy={k.y * 140} r={i === 0 ? 3.2 : 1.8} fill={f.fall ? "rgb(252 165 165)" : "rgb(110 231 183)"} />
                  ))}
                </>
              )
              : (
                <text x={50} y={72} textAnchor="middle" className="fill-gray-600 text-[7px]">
                  no one in range
                </text>
              )}
          </svg>
        </div>
      </div>

      {/* CSI waterfall */}
      <div className="card">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-white">CSI waterfall</span>
          <span className="text-xs text-gray-500">64 subcarriers × time — the raw channel the rest is inferred from</span>
        </div>
        <canvas
          ref={canvasRef}
          width={240}
          height={96}
          className="mt-3 h-24 w-full rounded-lg border border-surface-border"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  accent,
  glow,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "sky" | "rose" | "amber";
  glow?: boolean;
}) {
  const color =
    accent === "sky" ? "text-sky-300" : accent === "rose" ? "text-rose-300" : accent === "amber" ? "text-amber-300" : "text-brand";
  return (
    <div className={`card ${glow ? "ring-1 ring-emerald-500/30" : ""}`}>
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-[11px] text-gray-500">{sub}</p>
    </div>
  );
}
