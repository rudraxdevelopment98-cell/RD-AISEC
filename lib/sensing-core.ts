// WiFi spatial-sensing engine (our own take on the RuView approach) — pure, no
// DOM. Turns time into a "sensing frame" derived the way real WiFi Channel State
// Information (CSI) sensing works:
//   • presence  — variance/energy in the channel
//   • breathing — a slow (~0.2–0.3 Hz) periodic modulation of CSI amplitude
//   • heartbeat — a faster (~1–1.4 Hz) modulation riding on top
//   • motion    — large, broadband CSI variance
//   • pose      — 17 COCO keypoints inferred from the field
//   • fall      — a variance spike followed by stillness
//
// Right now the frames come from a physically-plausible SIMULATOR so the whole
// UI is alive without hardware. A real feed (ESP32-S3 CSI nodes, or a CSI-capable
// adapter on the runner) produces the same SensingFrame shape, so the dashboard
// swaps sources without changing. Deterministic (seeded) so it's unit-testable.

export type Keypoint = { name: string; x: number; y: number; score: number };

export type SensingFrame = {
  t: number;
  present: boolean;
  occupancy: number; // people detected
  breathingBpm: number;
  heartBpm: number;
  motion: number; // 0..1 broadband activity
  vital: number; // combined vital waveform sample, -1..1 (for the trace)
  breath: number; // breathing component, -1..1
  pose: Keypoint[]; // 17 keypoints, normalized 0..1 (x right, y down)
  fall: boolean;
  csi: number[]; // per-subcarrier amplitude, 0..1 (the "waterfall" row)
  quality: number; // link/signal quality 0..1
};

export type Scenario = "auto" | "empty" | "resting" | "active" | "fall";

export type SensingOpts = {
  subcarriers?: number; // CSI subcarriers (waterfall width)
  sensitivity?: number; // 0..1, scales how twitchy detection is
  scenario?: Scenario;
  seed?: number;
  // Drive presence/motion from a REAL signal (e.g. RSSI variance from a runner).
  // Pose/vitals stay modeled but scale with the real motion.
  overridePresent?: boolean;
  overrideMotion?: number; // 0..1
};

const KP_NAMES = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

// Base standing skeleton, normalized (0..1). Animated per-frame below.
const BASE_POSE: [number, number][] = [
  [0.5, 0.16],
  [0.47, 0.14],
  [0.53, 0.14],
  [0.44, 0.15],
  [0.56, 0.15],
  [0.41, 0.29],
  [0.59, 0.29],
  [0.37, 0.44],
  [0.63, 0.44],
  [0.35, 0.58],
  [0.65, 0.58],
  [0.45, 0.55],
  [0.55, 0.55],
  [0.44, 0.75],
  [0.56, 0.75],
  [0.44, 0.93],
  [0.56, 0.93],
];

/** Skeleton bone connections (indices into the keypoint list) for drawing. */
export const POSE_EDGES: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 4], // head
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], // arms
  [5, 11], [6, 12], [11, 12], // torso
  [11, 13], [13, 15], [12, 14], [14, 16], // legs
];

// Cheap deterministic value noise so the sim is smooth + seedable (no RNG state).
function noise(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s); // 0..1
}
function snoise(x: number): number {
  return noise(x) * 2 - 1; // -1..1
}
/** Smooth 1-D noise (interpolated), range -1..1. */
function smooth(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return snoise(i) * (1 - u) + snoise(i + 1) * u;
}

function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Decide the current scenario (auto slowly cycles empty→resting→active). */
function resolveScenario(t: number, scenario: Scenario, seed: number): Exclude<Scenario, "auto"> {
  if (scenario !== "auto") return scenario;
  const phase = (t / 24 + seed) % 3; // ~24s per state
  return phase < 1 ? "resting" : phase < 2 ? "active" : "resting";
}

/**
 * Produce one sensing frame at time `t` (seconds). Deterministic given t+opts.
 */
export function simulateFrame(t: number, opts: SensingOpts = {}): SensingFrame {
  const sub = opts.subcarriers ?? 56;
  const sens = opts.sensitivity ?? 0.6;
  const seed = opts.seed ?? 0;
  const scenario = resolveScenario(t, opts.scenario ?? "auto", seed);

  const empty = scenario === "empty";
  const active = scenario === "active";
  const falling = scenario === "fall";

  // Occupancy: 0 when empty, otherwise 1 (occasionally 2).
  let occupancy = empty ? 0 : 1 + (smooth(t / 40 + seed) > 0.75 ? 1 : 0);
  if (opts.overridePresent !== undefined) occupancy = opts.overridePresent ? Math.max(1, occupancy) : 0;
  const present = occupancy > 0;

  // Vitals — breathing + heart, slowly wandering within human ranges.
  const breathingBpm = present ? 15 + smooth(t / 20 + seed) * 3 : 0; // ~12–18
  const heartBpm = present ? 70 + smooth(t / 12 + seed + 5) * 10 : 0; // ~60–80
  const breath = present ? Math.sin((2 * Math.PI * breathingBpm) / 60 * t) : 0;
  const heart = present ? 0.22 * Math.sin((2 * Math.PI * heartBpm) / 60 * t) : 0;
  const vital = present ? clamp(breath * 0.85 + heart, -1, 1) : 0;

  // Motion — low at rest, bursty when active, big spike then stillness on a fall.
  let motion: number;
  if (!present) motion = 0.02 + 0.02 * noise(t * 3);
  else if (falling) {
    const fp = t % 12; // fall event every 12s in this scenario
    motion = fp < 0.4 ? 0.95 : fp < 3 ? 0.05 : 0.08 + 0.05 * noise(t * 2);
  } else if (active) motion = clamp(0.35 + 0.4 * Math.abs(smooth(t * 0.8 + seed)) + 0.1 * noise(t * 5));
  else motion = clamp(0.05 + 0.06 * Math.abs(smooth(t * 0.5)) + 0.02 * noise(t * 4));
  motion = clamp(motion * (0.7 + sens * 0.6));
  if (opts.overrideMotion !== undefined) motion = clamp(opts.overrideMotion);

  const fall = falling && t % 12 >= 0.4 && t % 12 < 3.2;

  // Pose — breathing lifts the chest/shoulders; motion swings the limbs; a fall
  // drops everything toward the floor.
  const lift = breath * 0.006; // chest rise
  const swing = active ? 0.05 : 0.012;
  const pose: Keypoint[] = BASE_POSE.map(([bx, by], i) => {
    let x = bx;
    let y = by;
    if (present) {
      // gentle whole-body sway
      x += smooth(t * 0.6 + i) * 0.006 * (0.5 + motion);
      // upper body rises slightly with the breath
      if (i <= 12) y -= lift * (1 - by);
      // arms (elbows/wrists) move with motion
      if (i >= 7 && i <= 10) {
        const p = (i % 2 === 1 ? 1 : -1) * Math.sin(t * (active ? 4 : 1.2) + i);
        x += p * swing;
        y += Math.cos(t * (active ? 4 : 1.2) + i) * swing * 0.7;
      }
    }
    if (fall) {
      // collapse toward the floor
      y = 0.72 + (by - 0.16) * 0.28 + smooth(t + i) * 0.01;
      x = 0.5 + (bx - 0.5) * 1.4;
    }
    return { name: KP_NAMES[i], x: clamp(x, 0, 1), y: clamp(y, 0, 1), score: present ? 0.85 : 0.1 };
  });

  // CSI waterfall row — per-subcarrier amplitude modulated by the breath +
  // broadband motion, plus link noise.
  const csi: number[] = new Array(sub);
  for (let k = 0; k < sub; k++) {
    const base = 0.45 + 0.18 * Math.sin((k / sub) * Math.PI * 3 + t * 0.3);
    const resp = present ? breath * 0.08 * Math.sin(k * 0.7 + 1) : 0;
    const mot = motion * 0.25 * snoise(k * 1.3 + t * 6);
    csi[k] = clamp(base + resp + mot + 0.05 * snoise(k + t * 12));
  }

  const quality = clamp(0.75 + 0.15 * smooth(t / 8) - motion * 0.1);

  return {
    t,
    present,
    occupancy,
    breathingBpm: present ? Math.round(breathingBpm) : 0,
    heartBpm: present ? Math.round(heartBpm) : 0,
    motion,
    vital,
    breath,
    pose,
    fall,
    csi,
    quality,
  };
}

export const KEYPOINT_NAMES = KP_NAMES;
