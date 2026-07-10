"use client";

import { useEffect, useRef, useState } from "react";
import { simulateFrame, POSE_EDGES, type SensingFrame, type Scenario } from "@/lib/sensing-core";
import { sampleAt, type SenseTimeline } from "@/lib/wifi-sense-core";
import { type FloorPlan, planBounds, wallSegments, placeInPlan } from "@/lib/floorplan-core";

export type SenseMachine = { id: string; name: string; wifi: string[] };

type AnalysisLite = { presentPct?: number; rangeMeters?: number | null; speedMps?: number; direction?: string };
type CsiLite = { present: boolean; rangeMeters?: number | null; azimuthDeg?: number | null; breathingBpm?: number | null; heartBpm?: number | null; velocityMps?: number };
type Placement = { present: boolean; range: number; azimuth: number; stature: number; source: "csi" | "rssi" };
// A real surveyed device with a solved 2D position (plan metres), for 3D markers.
type HomeDeviceLite = {
  id: string; isAp: boolean; kind: string; essid: string; vendor: string;
  bestRssi: number; pinned: boolean; pos: { x: number; y: number };
};

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
  // Precise RSSI analysis + latest CSI imaging → the person's real placement.
  const [analysis, setAnalysis] = useState<AnalysisLite | null>(null);
  const [csi, setCsi] = useState<CsiLite | null>(null);
  // The home floor plan — transparent walls + real in-plan placement.
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  // Real surveyed devices (routers / phones / IoT) positioned by the walk —
  // rendered as labelled 3D markers in the room. Not simulated.
  const [devices, setDevices] = useState<HomeDeviceLite[]>([]);
  const [showDevices, setShowDevices] = useState(true);

  // Prefer CSI (has a real bearing) when it's fresh; else the RSSI analysis.
  const placement: Placement | null = csi
    ? { present: csi.present, range: csi.rangeMeters ?? 2, azimuth: csi.azimuthDeg ?? 0, stature: 1.75, source: "csi" }
    : analysis
      ? { present: (analysis.presentPct ?? 0) > 12, range: analysis.rangeMeters ?? 2, azimuth: 0, stature: 1.75, source: "rssi" }
      : null;

  const stateRef = useRef<{ running: boolean; scenario: Scenario; timeline: SenseTimeline | null; placement: Placement | null }>({
    running,
    scenario,
    timeline: null,
    placement: null,
  });
  stateRef.current = { running, scenario, timeline, placement };

  // Rebuild the 3D scene (walls + node positions) whenever the plan changes.
  const planKey = plan ? JSON.stringify({ m: plan.meters, h: plan.height, r: plan.rooms, a: plan.anchors }) : "";
  // Rebuild device markers when the surveyed set changes (rounded so tiny RSSI
  // jitter in positions doesn't thrash the scene).
  const devKey = showDevices
    ? devices.map((d) => `${d.id}:${d.pos.x.toFixed(1)},${d.pos.y.toFixed(1)}:${d.kind}:${d.pinned ? 1 : 0}`).join("|")
    : "off";

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

      // Floating text label (canvas sprite) for a device marker.
      const makeLabel = (text: string, hex: number) => {
        const cvs = document.createElement("canvas");
        const c2 = cvs.getContext("2d");
        if (!c2) return null;
        const fs = 44;
        c2.font = `600 ${fs}px system-ui, sans-serif`;
        const tw = Math.ceil(c2.measureText(text).width) + 28;
        cvs.width = tw; cvs.height = 60;
        c2.font = `600 ${fs}px system-ui, sans-serif`;
        c2.fillStyle = "rgba(4,6,11,0.62)";
        (c2 as any).roundRect ? (c2.beginPath(), (c2 as any).roundRect(0, 0, tw, 60, 12), c2.fill()) : c2.fillRect(0, 0, tw, 60);
        c2.fillStyle = "#" + hex.toString(16).padStart(6, "0");
        c2.textBaseline = "middle";
        c2.fillText(text, 14, 32);
        const tex = new THREE.CanvasTexture(cvs);
        tex.minFilter = THREE.LinearFilter;
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
        spr.scale.set(0.42 * (tw / 60), 0.42, 1);
        return spr;
      };

      // ── Home floor plan → transparent glass walls, centred on the origin ──
      // The plan (metres) maps to world units so its larger side ≈ 6 units. When
      // a plan is present the sensing node + person live in PLAN coordinates.
      const pb = plan ? planBounds(plan) : null;
      const M2W = pb ? Math.min(0.9, 6 / Math.max(pb.w, pb.h)) : 0.7;
      const planToWorld = (px: number, py: number) =>
        new THREE.Vector3(pb ? (px - pb.w / 2) * M2W : px, 0, pb ? (py - pb.h / 2) * M2W : py);
      const senseAnchor =
        plan ? (plan.anchors.find((a) => a.kind === "rx") ?? plan.anchors.find((a) => a.kind === "ap") ?? null) : null;

      if (plan && pb) {
        const wallH = plan.height * M2W;
        const wallMat = new THREE.MeshBasicMaterial({
          color: 0x9fd6ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
        });
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.35 });
        for (const s of wallSegments(plan)) {
          const a = planToWorld(s.x1, s.y1);
          const c = planToWorld(s.x2, s.y2);
          const len = a.distanceTo(c);
          if (len < 1e-3) continue;
          const wall = new THREE.Mesh(new THREE.BoxGeometry(len, wallH, 0.03), wallMat);
          wall.position.set((a.x + c.x) / 2, wallH / 2, (a.z + c.z) / 2);
          wall.rotation.y = -Math.atan2(c.z - a.z, c.x - a.x);
          scene.add(wall);
          // Bright top rim so the glass wall reads clearly.
          const rimGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(a.x, wallH, a.z), new THREE.Vector3(c.x, wallH, c.z),
          ]);
          scene.add(new THREE.Line(rimGeo, edgeMat));
        }
        // WiFi node markers at their real plan positions (AP = blue, RX = green).
        for (const an of plan.anchors) {
          const w = planToWorld(an.x, an.y);
          const node = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 12, 12),
            new THREE.MeshBasicMaterial({ color: an.kind === "ap" ? 0x60a5fa : 0x6ee7b7 }),
          );
          node.position.set(w.x, 0.16, w.z);
          scene.add(node);
        }

        // ── REAL surveyed devices → labelled 3D markers at their solved (x,y) ──
        // Routers sit high, phones low; each has a stem to the floor + a name tag.
        if (showDevices && devices.length) {
          const KIND_HEX: Record<string, number> = {
            router: 0x60a5fa, phone: 0x34d399, laptop: 0xa78bfa, computer: 0xa78bfa, iot: 0xfbbf24, unknown: 0x94a3b8,
          };
          for (const d of devices) {
            const w = planToWorld(d.pos.x, d.pos.y);
            const hex = KIND_HEX[d.kind] ?? 0x94a3b8;
            const hgt = d.isAp ? Math.min(wallH * 0.9, 1.6) : d.kind === "phone" ? 0.85 : 1.0;
            // stem to floor
            const stemGeo = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(w.x, 0.02, w.z), new THREE.Vector3(w.x, hgt, w.z),
            ]);
            scene.add(new THREE.Line(stemGeo, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.35 })));
            // floor dot
            const dotGeo = new THREE.RingGeometry(0.05, 0.11, 24);
            const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
            dot.rotation.x = -Math.PI / 2; dot.position.set(w.x, 0.03, w.z);
            scene.add(dot);
            // marker: octahedron for APs, sphere for clients
            const marker = new THREE.Mesh(
              d.isAp ? new THREE.OctahedronGeometry(0.13) : new THREE.SphereGeometry(0.09, 14, 14),
              new THREE.MeshBasicMaterial({ color: hex }),
            );
            marker.position.set(w.x, hgt, w.z);
            scene.add(marker);
            if (d.pinned) {
              const halo = new THREE.Mesh(
                new THREE.TorusGeometry(0.2, 0.012, 8, 32),
                new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.7 }),
              );
              halo.position.copy(marker.position); halo.rotation.x = Math.PI / 2;
              scene.add(halo);
            }
            const lbl = makeLabel((d.essid || d.vendor || d.id.slice(-5)).slice(0, 16), hex);
            if (lbl) { lbl.position.set(w.x, hgt + 0.3, w.z); scene.add(lbl); }
          }
        }
      }

      // Sensing node (the AP/RX the range is measured from) + propagation rings.
      const senseWorld = senseAnchor ? planToWorld(senseAnchor.x, senseAnchor.y) : new THREE.Vector3(GW * SP * 0.34, 0, GD * SP * 0.34);
      const ap = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, 0.16),
        new THREE.MeshBasicMaterial({ color: 0x60a5fa }),
      );
      ap.position.set(senseWorld.x, 1.0, senseWorld.z);
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

      const apFloor = new THREE.Vector3(senseWorld.x, 0.02, senseWorld.z);
      // Distance-reference rings only without a plan (the plan gives real walls).
      if (!plan) {
        for (let m = 1; m <= 4; m++) {
          const ringGeo = new THREE.RingGeometry(m * M2W - 0.01, m * M2W + 0.01, 64);
          const ring = new THREE.Mesh(
            ringGeo,
            new THREE.MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.copy(apFloor);
          scene.add(ring);
        }
      }
      // Line from the sensing node to the person's ground point (the range).
      const rangeLineGeo = new THREE.BufferGeometry();
      rangeLineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const rangeLine = new THREE.Line(
        rangeLineGeo,
        new THREE.LineBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.5 }),
      );
      scene.add(rangeLine);

      // Figure — joints (instanced spheres), bones (line segments), soft glow,
      // all parented to a GROUP so the whole person can be placed at the measured
      // (distance, bearing) and scaled to the estimated height.
      const PW = 1.1;
      const PH = 1.85; // world height of a ~1.85 m person at scale 1
      const figure = new THREE.Group();
      scene.add(figure);
      const toWorld = (k: { x: number; y: number }, out: any) => out.set((k.x - 0.5) * PW, (1 - k.y) * PH, 0);
      const jointMat = new THREE.MeshBasicMaterial({ color: 0x9df8d0 });
      const joints = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 12, 12), jointMat, 17);
      figure.add(joints);
      const boneMat = new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.9 });
      const bonePos = new Float32Array(POSE_EDGES.length * 2 * 3);
      const boneGeo = new THREE.BufferGeometry();
      boneGeo.setAttribute("position", new THREE.BufferAttribute(bonePos, 3));
      const bones = new THREE.LineSegments(boneGeo, boneMat);
      figure.add(bones);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 1.3, 16, 1, true), glowMat);
      figure.add(glow);

      // Boresight = AP → room centre (origin), on the floor. Azimuth rotates the
      // person around vertical from this axis; range scales along it.
      const boresight = new THREE.Vector3(-apFloor.x, 0, -apFloor.z).normalize();

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

        // Place the person at the MEASURED distance + bearing, scaled to the
        // estimated height. With a floor plan, resolve into plan coordinates
        // (so the figure walks through the real rooms); else use the AP axis.
        const pl = stateRef.current.placement;
        const rangeM = Math.max(0.3, Math.min(20, pl?.range ?? 2));
        let gx: number, gz: number;
        if (plan && senseAnchor) {
          const pp = placeInPlan(plan, senseAnchor, rangeM, pl?.azimuth ?? 0);
          const wpos = planToWorld(pp.x, pp.y);
          gx = wpos.x; gz = wpos.z;
        } else {
          const azRad = ((pl?.azimuth ?? 0) * Math.PI) / 180;
          const dirX = boresight.x * Math.cos(azRad) - boresight.z * Math.sin(azRad);
          const dirZ = boresight.x * Math.sin(azRad) + boresight.z * Math.cos(azRad);
          gx = apFloor.x + dirX * rangeM * M2W;
          gz = apFloor.z + dirZ * rangeM * M2W;
        }
        const stature = Math.max(1.2, Math.min(2.1, pl?.stature ?? 1.75));
        figure.position.set(gx, 0, gz);
        figure.scale.setScalar(stature / 1.85);

        // Range line from AP to the person's ground point.
        const rp = rangeLineGeo.attributes.position as any;
        rp.array[0] = apFloor.x; rp.array[1] = 0.02; rp.array[2] = apFloor.z;
        rp.array[3] = gx; rp.array[4] = 0.02; rp.array[5] = gz;
        rp.needsUpdate = true;
        (rangeLine as any).visible = f.present;

        // Floor field lights up around the person's real ground position.
        const spread = 0.55 + f.motion * 1.6;
        for (let c = 0; c < cellPos.length; c++) {
          const [x, z] = cellPos[c];
          const d2 = (x - gx) * (x - gx) + (z - gz) * (z - gz);
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
    // rebuild the scene when the floor plan or surveyed devices change; live
    // params flow via stateRef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, devKey]);

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
            if (d.analysis) setAnalysis(d.analysis as AnalysisLite);
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
    setAnalysis(null);
    setSenseStatus("idle");
    setSenseMsg("");
  }

  // Poll the latest CSI imaging (if a CSI collector is feeding frames). CSI adds
  // a real bearing + vitals, so when it's fresh it drives the figure's position.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/sensing/csi", { cache: "no-store" }).then((x) => x.json());
        if (!stop) setCsi(r?.fresh && r?.analysis ? (r.analysis as CsiLite) : null);
      } catch {
        /* ignore */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  // Load the home floor plan (transparent walls + in-plan placement).
  useEffect(() => {
    let stop = false;
    fetch("/api/sensing/floorplan", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (!stop && d?.plan) setPlan(d.plan as FloorPlan); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);

  // Load the real surveyed devices (the auto home map) and refresh periodically
  // so a live walk / monitor shows up as 3D markers. Only positioned ones.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch("/api/sensing/survey", { cache: "no-store" }).then((x) => x.json());
        const list: HomeDeviceLite[] = (r?.map?.devices ?? [])
          .filter((d: { pos: unknown }) => d.pos)
          .map((d: HomeDeviceLite) => ({
            id: d.id, isAp: d.isAp, kind: d.kind, essid: d.essid, vendor: d.vendor,
            bestRssi: d.bestRssi, pinned: d.pinned, pos: d.pos,
          }));
        if (!stop) setDevices(list);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 8000);
    return () => { stop = true; clearInterval(id); };
  }, []);

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
        <p className="text-[10px] uppercase tracking-widest text-gray-500">
          Vital signs {csi && <span className="text-emerald-400">· CSI</span>}
        </p>
        <Metric label="❤ Heart rate" value={csi?.heartBpm != null ? `${csi.heartBpm}` : present ? `${f?.heartBpm}` : "—"} unit="BPM" color="text-rose-300" />
        <Metric label="🌬 Respiration" value={csi?.breathingBpm != null ? `${csi.breathingBpm}` : present ? `${f?.breathingBpm}` : "—"} unit="RPM" color="text-sky-300" />
        <Metric label="⚖ Confidence" value={`${Math.round((f?.quality ?? 0) * 100)}`} unit="%" color="text-emerald-300" />
      </div>

      {/* WiFi signal — bottom right */}
      <div className="pointer-events-none absolute bottom-3 right-3 w-[8.5rem] rounded-xl border border-surface-border bg-black/60 p-2.5 backdrop-blur sm:bottom-4 sm:right-4 sm:w-44 sm:p-3">
        <p className="text-[10px] uppercase tracking-widest text-gray-500">
          WiFi signal {live && <span className="text-emerald-400">· live</span>}
        </p>
        <Row label="RSSI" value={`${rssi} dBm${live ? " avg" : ""}`} />
        <Row label="Distance" value={placement?.present ? `${placement.range.toFixed(1)} m` : "—"} />
        <Row
          label="Bearing"
          value={csi?.azimuthDeg != null ? `${csi.azimuthDeg}°` : placement?.source === "rssi" ? "1 AP" : "—"}
        />
        <Row label="Height" value={placement?.present ? `~${placement.stature.toFixed(2)} m` : "—"} />
        <Row label="Persons" value={String(f?.occupancy ?? 0)} />
        {(csi || placement) && (
          <p className="mt-1 text-[10px] text-gray-500">
            position from {csi ? "CSI (range + angle)" : "RSSI range · bearing needs ≥2 antennas"}
          </p>
        )}
        {live && !csi && (
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
        {devices.length > 0 && (
          <button
            onClick={() => setShowDevices((v) => !v)}
            className={`tag ${showDevices ? "border-brand bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
            title="Show the real surveyed devices as 3D markers"
          >
            📡 Devices {devices.length}
          </button>
        )}
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
