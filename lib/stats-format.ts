// Pure formatting helpers for machine resource stats (shared by the footer,
// the right rail and the machine page).

export function fmtGB(mb?: number | null): string {
  if (mb == null) return "—";
  const gb = mb / 1024;
  return `${gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)} GB`;
}

/** used/total as a 0..100 percentage (null if either is missing). */
export function ratioPct(used?: number | null, total?: number | null): number | null {
  if (used == null || !total || total <= 0) return null;
  return Math.round((used / total) * 100);
}

export function fmtUptime(sec?: number | null): string {
  if (sec == null) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Bar/severity colour for a utilisation percentage. */
export function loadColor(pct: number | null): string {
  if (pct == null) return "rgb(75 85 99)";
  if (pct >= 90) return "rgb(248 113 113)"; // red
  if (pct >= 75) return "rgb(251 191 36)"; // amber
  return "rgb(52 211 153)"; // emerald
}

/** A sensible "turbo" parallel-jobs count for a machine given its core count. */
export function turboWorkers(cores?: number | null): number {
  return Math.min(16, Math.max(6, (cores ?? 4) * 2));
}
