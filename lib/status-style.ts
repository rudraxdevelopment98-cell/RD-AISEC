// One source of truth for job / scan / stage status → Tailwind text-color class.
//
// This map was copy-pasted into ~9 pages and components (dashboard, runners,
// history, jobs, pipeline-panel, exploit-live, learn-board, jobs-table,
// retest-core), each drifting slightly. Import `jobStatusClass` instead so every
// status chip reads the same colour everywhere. Pure (no React), so server pages
// and client components can both use it.

export const JOB_STATUS_CLASS: Record<string, string> = {
  done: "text-brand",
  resolved: "text-brand",
  // In-flight states share the low-severity (calm) tone.
  running: "text-sev-low",
  importing: "text-sev-low",
  advancing: "text-sev-low",
  // Waiting states use the medium (attention) tone.
  queued: "text-sev-med",
  pending: "text-sev-med",
  awaiting_approval: "text-sev-med",
  // Terminal-bad.
  failed: "text-sev-crit",
  error: "text-sev-crit",
  // Inert.
  canceled: "text-gray-400",
  cancelled: "text-gray-400",
  paused: "text-gray-400",
  skipped: "text-gray-400",
};

/** Tailwind text-colour class for a job/scan/stage status (gray fallback). */
export function jobStatusClass(status: string | null | undefined): string {
  return JOB_STATUS_CLASS[(status ?? "").toLowerCase()] ?? "text-gray-400";
}

// Tag/chip variant of the same mapping — for a `.tag` pill with the ring accents
// (as used in the jobs table, history list and jobs page). Same status buckets,
// styled as a chip instead of bare text.
export const JOB_STATUS_TAG: Record<string, string> = {
  done: "ring-emerald accent-emerald",
  completed: "ring-emerald accent-emerald",
  resolved: "ring-emerald accent-emerald",
  running: "ring-sky accent-sky",
  importing: "ring-sky accent-sky",
  advancing: "ring-sky accent-sky",
  queued: "ring-amber accent-amber",
  pending: "ring-amber accent-amber",
  awaiting_approval: "ring-amber accent-amber",
  failed: "border-sev-crit/40 text-sev-crit",
  error: "border-sev-crit/40 text-sev-crit",
  canceled: "border-gray-500/40 text-gray-400",
  cancelled: "border-gray-500/40 text-gray-400",
  paused: "border-gray-500/40 text-gray-400",
};

/** `.tag` ring/accent classes for a job/scan status (gray fallback). */
export function jobStatusTag(status: string | null | undefined): string {
  return JOB_STATUS_TAG[(status ?? "").toLowerCase()] ?? "border-gray-500/40 text-gray-400";
}
