// Pure model for the runner's daily self-heal / maintenance cycle. The machine
// runs an unattended maintenance pass once a day (default window 06:00–08:00
// local): refresh package index, upgrade security tools, free disk, refresh tool
// databases, then self-test. It reports the stage it's on via ping headers; the
// portal renders a live pipeline from this model. No prisma/Node here, so it is
// client-safe and unit-testable.

export type MaintStage =
  | "idle"
  | "starting"
  | "updating"
  | "upgrading"
  | "cleaning"
  | "refreshing"
  | "verifying"
  | "reporting"
  | "done"
  | "failed";

export type StageInfo = {
  id: MaintStage;
  label: string;
  blurb: string; // one-line, plain language for the user
  icon: string; // emoji marker for the UI
};

// The ordered pipeline the machine walks through. `idle`/`done`/`failed` are
// terminal states shown outside the progress track.
export const PIPELINE: MaintStage[] = [
  "starting",
  "updating",
  "upgrading",
  "cleaning",
  "refreshing",
  "verifying",
  "reporting",
];

export const STAGE_INFO: Record<MaintStage, StageInfo> = {
  idle: { id: "idle", label: "Idle", blurb: "No maintenance running — next pass is scheduled.", icon: "🌙" },
  starting: { id: "starting", label: "Starting", blurb: "Waking up and running pre-flight checks.", icon: "🌅" },
  updating: { id: "updating", label: "Update index", blurb: "Refreshing the package index (what's available).", icon: "🔄" },
  upgrading: { id: "upgrading", label: "Upgrade tools", blurb: "Installing newer versions of the security tools.", icon: "⬆️" },
  cleaning: { id: "cleaning", label: "Clean up", blurb: "Removing junk and freeing disk space.", icon: "🧹" },
  refreshing: { id: "refreshing", label: "Refresh databases", blurb: "Updating scanner templates and exploit databases.", icon: "📚" },
  verifying: { id: "verifying", label: "Self-test", blurb: "Confirming every tool still runs correctly.", icon: "✅" },
  reporting: { id: "reporting", label: "Report", blurb: "Posting the maintenance summary to the portal.", icon: "📡" },
  done: { id: "done", label: "Healthy", blurb: "Maintenance finished — the machine is up to date.", icon: "💚" },
  failed: { id: "failed", label: "Needs attention", blurb: "A maintenance step failed — details below.", icon: "⚠️" },
};

export function stageInfo(stage: MaintStage): StageInfo {
  return STAGE_INFO[stage] ?? STAGE_INFO.idle;
}

export function isActiveStage(stage: MaintStage): boolean {
  return PIPELINE.includes(stage);
}

/** 0..100 progress along the pipeline for a given stage. */
export function stageProgress(stage: MaintStage, override?: number | null): number {
  if (typeof override === "number" && override >= 0 && override <= 100) return Math.round(override);
  if (stage === "done") return 100;
  if (stage === "idle" || stage === "failed") return 0;
  const i = PIPELINE.indexOf(stage);
  if (i < 0) return 0;
  // Put the marker at the *end* of the current step so a mid-run stage reads as
  // "this step in progress" rather than "not started".
  return Math.round(((i + 1) / PIPELINE.length) * 100);
}

export type MaintInput = {
  maintStage?: string | null;
  maintNote?: string | null;
  maintPct?: number | null;
  maintStartedAt?: Date | string | null;
  maintUpdatedAt?: Date | string | null;
};

export type MaintSummary = {
  stage: MaintStage;
  info: StageInfo;
  active: boolean; // currently walking the pipeline
  stale: boolean; // claims active but hasn't updated recently → likely interrupted
  progress: number; // 0..100
  note: string;
  startedAt: number | null; // epoch ms
  updatedAt: number | null;
  elapsedMs: number | null; // for an active/just-finished cycle
};

const ACTIVE_STALE_MS = 15 * 60_000; // an active stage silent >15m is treated as stalled

function toMs(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Normalise a stored/unknown string into a known stage (defaults to idle). */
export function coerceStage(raw: string | null | undefined): MaintStage {
  const s = (raw ?? "").trim().toLowerCase();
  return (s in STAGE_INFO ? (s as MaintStage) : "idle");
}

/** Fold the runner's stored maintenance fields into a display summary. */
export function summarizeMaintenance(r: MaintInput, now = Date.now()): MaintSummary {
  const stage = coerceStage(r.maintStage);
  const active = isActiveStage(stage);
  const startedAt = toMs(r.maintStartedAt);
  const updatedAt = toMs(r.maintUpdatedAt);
  const stale = active && updatedAt != null && now - updatedAt > ACTIVE_STALE_MS;
  const elapsedMs =
    startedAt != null ? (active ? now - startedAt : updatedAt != null ? updatedAt - startedAt : null) : null;
  return {
    stage,
    info: stageInfo(stage),
    active,
    stale,
    progress: stageProgress(stage, r.maintPct),
    note: (r.maintNote ?? "").slice(0, 300),
    startedAt,
    updatedAt,
    elapsedMs,
  };
}

/** Parse the compact "stage|pct|note" maintenance header the runner sends. */
export function parseMaintHeader(raw: string | null | undefined): {
  stage: MaintStage;
  pct: number | null;
  note: string;
} | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const [stagePart, pctPart, ...noteParts] = s.split("|");
  const stage = coerceStage(stagePart);
  const pctNum = Number(pctPart);
  const pct = Number.isFinite(pctNum) && pctNum >= 0 && pctNum <= 100 ? Math.round(pctNum) : null;
  return { stage, pct, note: noteParts.join("|").slice(0, 300) };
}

/** Human "Daily 06:00–08:00" style schedule label. */
export function scheduleLabel(startHour = 6, endHour = 8): string {
  const h = (n: number) => `${String(((n % 24) + 24) % 24).padStart(2, "0")}:00`;
  return `Daily ${h(startHour)}–${h(endHour)}`;
}
