"use client";

import { useEffect, useRef, useState } from "react";
import { simulateFrame, POSE_EDGES, type SensingFrame, type Scenario } from "@/lib/sensing-core";
import { sampleAt, type SenseTimeline } from "@/lib/wifi-sense-core";

export type SenseMachine = { id: string; name: string; wifi: string[] };

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "empty", label: "Empty" },
  { id: "resting", label: "Resting" },
  { id: "active", label: "Active" },
  { id: "fall", label: "Fall" },
];

/**
 * 3D WiFi-sensing observatory (RuView-style). Renders a real Three.js room: a
 * CSI floor field that lights up around the detected person, a glowing skeletal
 * figure driven by the pose estimate, WiFi propagation rings from an access
 * point, and orbit camera. HUD panels (vitals / signal) overlay the canvas.
 *
 * The scene + camera + WiFi selection are real; the detection is driven by our
 * sensing engine (simulation until CSI-capable hardware / a real RSSI feed is
 * connected — same SensingFrame shape either way).
 */
export function SensingObservatory({
  interfaces,
  defaultIface,
  machines = [],
}: {
  interfaces: string[];
  defaultIface?: string;
  machines?: SenseMachine[];
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<SensingFrame | null>(null);
  const [running, setRunning] = useState(true);
  const [scenario, setScenario] = useState<Scenario>("auto");
  const [failed, setFailed] = useState(false);

  // Real-sensing state.
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [senseIface, setSenseIface] = useState(machines[0]?.wifi[0] ?? defaultIface ?? interfaces[0] ?? "");
  const [senseStatus, setSenseStatus] = useState<"idle" | "starting" | "sampling" | "live" | "error">("idle");
  const [senseMsg, setSenseMsg] = useState("");
  const [timeline, setTimeline] = useState<SenseTimeline | null>(null);

  const stateRef = useRef<{ running: boolean; scenario: Scenario; timeline: SenseTimeline | null }>({
    running,
    scenario,
    timeline: null,
  });
  stateRef.current = { running, scenario, timeline };

  const selMachine = machines.find((m) => m.id === machineId);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      let THREE: typeof import("three");
      let OrbitControls: any;
      try {
        THREE = await import("three");
        OrbitControls = (await import("three/examples/jsm/controls/OrbitControls.js" as string)).OrbitControls;
      } catch {
        setFailed(true);
        return;
      }
      const mount = mountRef.current;
      if (!mount || disposed) return;
      let W = mount.clientWidth || 800;
      let H = mount.clientHeight || 480;

      let renderer: any;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch {
        setFailed(true);
        return;
      }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H);
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x04060b, 0.055);
      const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
      camera.position.set(3.4, 2.5, 4.6);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0.9, 0);
      controls.maxPolarAngle = Math.PI / 2.04;
      controls.minDistance = 2.6;
      controls.maxDistance = 10;

      scene.add(new THREE.AmbientLight(0x2a3a4a, 1.4));
      const pl = new THREE.PointLight(0x6ee7b7, 1.4, 24);
      pl.position.set(0, 3.2, 2);
      scene.add(pl);

      // Dark floor plane.
      const GW = 15;
      const GD = 11;
      const SP = 0.4;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(GW * SP + 1.2, GD * SP + 1.2),
        new THREE.MeshBasicMaterial({ color: 0x03050a }),
      );
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);

      // CSI floor field — one cell per grid point, colour = channel energy.
      const cellGeo = new THREE.BoxGeometry(SP * 0.8, 0.03, SP * 0.8);
      const cells = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial(), GW * GD);
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      const cellPos: [number, number][] = [];
      let ci = 0;
      for (let i = 0; i < GW; i++) {
        for (let j = 0; j < GD; j++) {
          const x = (i - (GW - 1) / 2) * SP;
          const z = (j - (GD - 1) / 2) * SP;
          cellPos.push([x, z]);
          dummy.position.set(x, 0.02, z);
          dummy.updateMatrix();
          cells.setMatrixAt(ci, dummy.matrix);
          cells.setColorAt(ci, col.setRGB(0.02, 0.05, 0.03));
          ci++;
        }
      }
      cells.instanceMatrix.needsUpdate = true;
      scene.add(cells);

      // Access point + expanding propagation rings.
      const ap = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.18, 0.18),
        new THREE.MeshBasicMaterial({ color: 0x60a5fa }),
      );
      ap.position.set(GW * SP * 0.34, 1.0, GD * SP * 0.34);
      scene.add(ap);
      const rings: any[] = [];
      for (let k = 0; k < 4; k++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.4, 0.008, 8, 60),
          new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.35 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(ap.position);
        scene.add(ring);
        rings.push(ring);
      }

      // Figure — joints (instanced spheres), bones (line segments), soft glow.
      const PW = 1.1;
      const PH = 1.85;
      const toWorld = (k: { x: number; y: number }, out: any) => out.set((k.x - 0.5) * PW, (1 - k.y) * PH, 0);
      const jointMat = new THREE.MeshBasicMaterial({ color: 0x9df8d0 });
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 12, 12), jointMat, 17);
      scene.add(joints);
      const boneMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.9 });
      const bonePos = new Float32Array(POSE_EDGES.length * 2 * 3);
      const boneGeo = new THREE.BufferGeometry();
      boneGeo.setAttribute("position", new THREE.BufferAttribute(bonePos, 3));
      const bones = new THREE.LineSegments(boneGeo, boneMat);
      scene.add(bones);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 1.3, 16, 1, true), glowMat);
      scene.add(glow);

      const vA = new THREE.Vector3();
      const vB = new THREE.Vector3();
      const vT = new THREE.Vector3();

      let t = 0;
      let last = 0;
      let lastEmit = 0;
      let raf = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (!last) last = now;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (stateRef.current.running) t += dt;
        const tl = stateRef.current.timeline;
        const ov = tl && tl.points.length ? sampleAt(tl, t) : null;
        const f = simulateFrame(t, {
          scenario: stateRef.current.scenario,
          subcarriers: 48,
          ...(ov ? { overridePresent: ov.present, overrideMotion: ov.motion } : {}),
        });

        // Floor field lights up around the person's ground position.
        const gx = ((f.pose[11].x + f.pose[12].x) / 2 - 0.5) * PW;
        const spread = 0.55 + f.motion * 1.6;
        for (let c = 0; c < cellPos.length; c++) {
          const [x, z] = cellPos[c];
          const d2 = (x - gx) * (x - gx) + z * z * 1.25;
          const inten = f.present ? Math.min(1, Math.exp(-d2 / spread) * (0.5 + f.motion * 0.9) + 0.02) : 0.02;
          cells.setColorAt(c, col.setRGB(inten * 0.16, inten * 0.9, inten * 0.22));
        }
        if (cells.instanceColor) cells.instanceColor.needsUpdate = true;

        if (f.present) {
          joints.visible = bones.visible = glow.visible = true;
          for (let i = 0; i < 17; i++) {
            toWorld(f.pose[i], dummy.position);
            dummy.scale.setScalar(i === 0 ? 1.35 : 1);
            dummy.updateMatrix();
            joints.setMatrixAt(i, dummy.matrix);
          }
          joints.instanceMatrix.needsUpdate = true;
          let bi = 0;
          for (const [a, b] of POSE_EDGES) {
            toWorld(f.pose[a], vA);
            toWorld(f.pose[b], vB);
            bonePos[bi++] = vA.x; bonePos[bi++] = vA.y; bonePos[bi++] = vA.z;
            bonePos[bi++] = vB.x; bonePos[bi++] = vB.y; bonePos[bi++] = vB.z;
          }
          boneGeo.attributes.position.needsUpdate = true;
          toWorld(f.pose[5], vA);
          toWorld(f.pose[12], vB);
          vT.addVectors(vA, vB).multiplyScalar(0.5);
          glow.position.copy(vT);
          jointMat.color.setHex(f.fall ? 0xfca5a5 : 0x9df8d0);
          boneMat.color.setHex(f.fall ? 0xf87171 : 0x34d399);
          glowMat.color.setHex(f.fall ? 0xf87171 : 0x10b981);
        } else {
          joints.visible = bones.visible = glow.visible = false;
        }

        rings.forEach((ring, k) => {
          const phase = (t * 0.45 + k * 0.25) % 1;
          ring.scale.setScalar(0.3 + phase * 4.2);
          ring.material.opacity = 0.4 * (1 - phase);
        });

        controls.update();
        renderer.render(scene, camera);
        if (now - lastEmit > 66) {
          setFrame(f);
          lastEmit = now;
        }
      };
      raf = requestAnimationFrame(loop);

      const onResize = () => {
        W = mount.clientWidth || 800;
        H = mount.clientHeight || 480;
        renderer.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        window.removeEventListener("resize", onResize);
        cancelAnimationFrame(raf);
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
        scene.traverse((o: any) => {
          o.geometry?.dispose?.();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: any) => m.dispose?.());
        });
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
    // build the scene once; live params flow through stateRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function senseNow() {
    if (!machineId || !senseIface) {
      setSenseStatus("error");
      setSenseMsg("Pick a machine and a WiFi interface.");
      return;
    }
    setSenseStatus("starting");
    setSenseMsg("");
    try {
      const res = await fetch("/api/sensing/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runnerId: machineId, iface: senseIface, seconds: 20 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSenseStatus("error");
        setSenseMsg(data?.error ?? "Couldn't start sensing.");
        return;
      }
      setSenseStatus("sampling");
      const jobId = data.jobId as string;
      const started = Date.now();
      const poll = async () => {
        try {
          const r = await fetch(`/api/sensing/run?job=${jobId}`, { cache: "no-store" });
          const d = await r.json();
          if (d.status === "done") {
            if (!d.timeline || d.timeline.error) {
              setSenseStatus("error");
              setSenseMsg(d.timeline?.message ?? "No wireless link on that interface.");
              return;
            }
            setTimeline(d.timeline);
            setSenseStatus("live");
            return;
          }
          if (Date.now() - started > 90000) {
            setSenseStatus("error");
            setSenseMsg("Timed out waiting for the machine.");
            return;
          }
          setTimeout(poll, 1500);
        } catch {
          setTimeout(poll, 2000);
        }
      };
      setTimeout(poll, 2500);
    } catch {
      setSenseStatus("error");
      setSenseMsg("Network error starting sensing.");
    }
  }
  function backToDemo() {
    setTimeline(null);
    setSenseStatus("idle");
    setSenseMsg("");
  }

  const f = frame;
  const present = f?.present ?? false;
  const live = senseStatus === "live" && !!timeline;
  const busy = senseStatus === "starting" || senseStatus === "sampling";
  const rssi = live ? timeline!.avgRssi ?? -60 : f ? Math.round(-32 - (1 - f.quality) * 46) : -60;
  const variance = f ? (2.2 + f.motion * 3).toFixed(2) : "—";

  return (
    <div className="relative mt-4 overflow-hidden rounded-2xl border border-surface-border bg-[#04060b]">
      {/* 3D canvas mount */}
      <div ref={mountRef} className="h-[62vh] min-h-[420px] w-full" />

      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-gray-400">
          3D view needs WebGL. Try Chrome/Edge with hardware acceleration on.
        </div>
      )}

      {/* Fall alert */}
      {f?.fall && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 animate-pulse rounded-full border border-red-500/60 bg-red-500/20 px-4 py-1.5 text-sm font-semibold text-red-100">
          ⚠ Fall detected
        </div>
      )}

      {/* Top bar — brand + controls */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-2 p-3">
        <div>
          <p className="text-lg font-bold text-white">
            <span className="text-brand">π</span> WiFi Sensing Observatory
          </p>
          <p className="text-[11px] text-gray-500">
            {live ? `Live · ${timeline?.ssid || senseIface}` : "Demo signal"} · orbit to look around
          </p>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          {live ? (
            <span className="tag ring-emerald accent-emerald">● LIVE · real WiFi</span>
          ) : (
            <span className="tag ring-amber-500/40 text-amber-300">◐ Demo signal</span>
          )}
          {machines.length > 0 ? (
            <div className="flex max-w-[92vw] flex-wrap items-center justify-end gap-1 rounded-lg border border-surface-border bg-surface/80 p-1 backdrop-blur">
              <select
                value={machineId}
                onChange={(e) => {
                  setMachineId(e.target.value);
                  const m = machines.find((x) => x.id === e.target.value);
                  setSenseIface(m?.wifi[0] ?? "");
                }}
                className="max-w-[7rem] rounded-md bg-surface px-1.5 py-1 text-xs outline-none"
                title="Machine running the RD-AISEC engine"
              >
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <select
                value={senseIface}
                onChange={(e) => setSenseIface(e.target.value)}
                className="max-w-[7rem] rounded-md bg-surface px-1.5 py-1 text-xs outline-none"
                title="The interface's connected access point is sampled"
              >
                {(selMachine?.wifi.length ? selMachine.wifi : ["(no wifi)"]).map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
              {live ? (
                <button onClick={backToDemo} className="btn-ghost px-2 py-1 text-xs">Stop</button>
              ) : (
                <button onClick={senseNow} disabled={busy || !selMachine?.wifi.length} className="btn-primary px-2 py-1 text-xs disabled:opacity-60">
                  {busy ? "Sensing…" : "📡 Sense real"}
                </button>
              )}
            </div>
          ) : (
            <span className="rounded-lg border border-surface-border bg-surface/80 px-2 py-1 text-[10px] text-gray-500 backdrop-blur">
              Connect a machine (with WiFi) to sense for real
            </span>
          )}
          {senseMsg && <span className="max-w-[16rem] text-right text-[10px] text-amber-300">{senseMsg}</span>}
        </div>
      </div>

      {/* Vital signs — bottom left */}
      <div className="pointer-events-none absolute bottom-3 left-3 w-[8.5rem] rounded-xl border border-surface-border bg-black/60 p-2.5 backdrop-blur sm:bottom-4 sm:left-4 sm:w-44 sm:p-3">
        <p className="text-[10px] uppercase tracking-widest text-gray-500">Vital signs</p>
        <Metric label="❤ Heart rate" value={present ? `${f?.heartBpm}` : "—"} unit="BPM" color="text-rose-300" />
        <Metric label="🌬 Respiration" value={present ? `${f?.breathingBpm}` : "—"} unit="RPM" color="text-sky-300" />
        <Metric label="⚖ Confidence" value={`${Math.round((f?.quality ?? 0) * 100)}`} unit="%" color="text-emerald-300" />
      </div>

      {/* WiFi signal — bottom right */}
      <div className="pointer-events-none absolute bottom-3 right-3 w-[8.5rem] rounded-xl border border-surface-border bg-black/60 p-2.5 backdrop-blur sm:bottom-4 sm:right-4 sm:w-44 sm:p-3">
        <p className="text-[10px] uppercase tracking-widest text-gray-500">
          WiFi signal {live && <span className="text-emerald-400">· live</span>}
        </p>
        <Row label="RSSI" value={`${rssi} dBm${live ? " avg" : ""}`} />
        <Row label="Variance" value={variance} />
        <Row label="Motion" value={(f?.motion ?? 0).toFixed(3)} />
        <Row label="Persons" value={String(f?.occupancy ?? 0)} />
        {live && (
          <p className="mt-1 text-[10px] text-gray-500">movement {timeline!.presentPct}% of {Math.round(timeline!.durationSec)}s</p>
        )}
        <div className={`mt-2 rounded-lg py-1.5 text-center text-sm font-semibold ${present ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-gray-500"}`}>
          {present ? "PRESENT" : "EMPTY"}
        </div>
      </div>

      {/* Scenario chips — top on mobile (keeps the bottom corners for the panels),
          bottom-center on wider screens. */}
      <div className="pointer-events-auto absolute left-1/2 top-[4.5rem] flex max-w-[92%] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 sm:top-auto sm:bottom-4">
        <button onClick={() => setRunning((r) => !r)} className="tag ring-brand/40 text-brand-glow">
          {running ? "⏸" : "▶"}
        </button>
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
    </div>
  );
}

function Metric({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="mt-2">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={`font-bold ${color}`}>
        <span className="text-xl">{value}</span> <span className="text-[10px] text-gray-500">{unit}</span>
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1.5 flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-sky-300">{value}</span>
    </div>
  );
}
