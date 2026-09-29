// Outcome learning — the engine gets smarter from what ACTUALLY paid.
//
// Every submitted report eventually gets a real-world verdict on the platform
// (resolved/bounty = it paid; duplicate/informative/not-applicable = it didn't).
// This pure core turns that history into a per-class ADJUSTMENT so the worth-
// reporting score reflects the operator's OWN results: classes that keep paying
// get boosted, classes that keep getting closed as dup/N-A get demoted. No AI —
// just counting outcomes. See docs/ENGINE-EARNING-RESEARCH.md.

export type Outcome = "pending" | "triaged" | "resolved" | "duplicate" | "informative" | "not-applicable" | "spam";

/** Map HackerOne's own report `state` → our outcome bucket. */
export function bucketOutcome(h1State: string): Outcome {
  const s = (h1State || "").toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "resolved") return "resolved";
  if (s === "triaged" || s === "retesting") return "triaged";
  if (s === "duplicate") return "duplicate";
  if (s === "informative") return "informative";
  if (s === "not-applicable" || s === "spam") return s === "spam" ? "spam" : "not-applicable";
  // new / pending-program-review / needs-more-info → not decided yet.
  return "pending";
}

/** Does this outcome count as a WIN (valid, likely/actually paid)? */
export function isWin(o: Outcome, bountyAmount = 0): boolean {
  return o === "resolved" || o === "triaged" || bountyAmount > 0;
}
/** Does it count as a LOSS (closed without value)? */
export function isLoss(o: Outcome): boolean {
  return o === "duplicate" || o === "informative" || o === "not-applicable" || o === "spam";
}

export type OutcomeRow = { cls: string; outcome: Outcome; bountyAmount?: number };
export type ClassStat = { cls: string; wins: number; losses: number; decided: number; bounty: number; adjust: number };
export type OutcomeModel = {
  byClass: Record<string, ClassStat>;
  totalWins: number;
  totalLosses: number;
  totalBounty: number;
};

// Only adjust once there's enough decided history for a class to mean something.
const MIN_DECIDED = 3;
const ADJUST_MIN = 0.35; // a class that always fails is worth ~a third
const ADJUST_MAX = 1.3; // a class that always pays gets a modest boost

/**
 * Learn a per-class multiplier from decided outcomes. adjust = 1.0 when there's
 * no signal; scales toward ADJUST_MAX as the win-rate → 1, toward ADJUST_MIN as
 * the loss-rate → 1. Undecided (pending) rows don't move the needle.
 */
export function learnFromOutcomes(rows: OutcomeRow[]): OutcomeModel {
  const byClass: Record<string, ClassStat> = {};
  let totalWins = 0, totalLosses = 0, totalBounty = 0;
  for (const r of rows) {
    const cls = r.cls || "misc";
    const st = (byClass[cls] ??= { cls, wins: 0, losses: 0, decided: 0, bounty: 0, adjust: 1 });
    const bounty = r.bountyAmount ?? 0;
    if (isWin(r.outcome, bounty)) { st.wins++; st.decided++; totalWins++; }
    else if (isLoss(r.outcome)) { st.losses++; st.decided++; totalLosses++; }
    st.bounty += bounty; totalBounty += bounty;
  }
  for (const st of Object.values(byClass)) {
    if (st.decided < MIN_DECIDED) { st.adjust = 1; continue; }
    const winRate = st.wins / st.decided; // 0..1
    // Center at 1.0: winRate 0.5 → ~1.0; 1.0 → ADJUST_MAX; 0.0 → ADJUST_MIN.
    st.adjust = winRate >= 0.5
      ? 1 + (ADJUST_MAX - 1) * ((winRate - 0.5) / 0.5)
      : ADJUST_MIN + (1 - ADJUST_MIN) * (winRate / 0.5);
    st.adjust = Math.round(st.adjust * 100) / 100;
  }
  return { byClass, totalWins, totalLosses, totalBounty };
}

/** Apply a learned model to a base novelty/priority score for a class. */
export function applyOutcomeAdjustment(base: number, cls: string, model: OutcomeModel | null | undefined): number {
  const st = model?.byClass?.[cls || "misc"];
  if (!st) return base;
  return Math.max(0, Math.min(100, Math.round(base * st.adjust)));
}

/** A short human summary of what pays for this operator (for the UI). */
export function outcomeSummary(model: OutcomeModel): string {
  const decided = model.totalWins + model.totalLosses;
  if (decided === 0) return "No decided reports yet — the engine learns what pays as outcomes land.";
  const top = Object.values(model.byClass)
    .filter((s) => s.decided >= MIN_DECIDED)
    .sort((a, b) => b.adjust - a.adjust);
  const best = top.slice(0, 3).filter((s) => s.adjust > 1).map((s) => s.cls);
  const worst = top.slice(-3).filter((s) => s.adjust < 1).map((s) => s.cls);
  const parts = [`${model.totalWins}/${decided} reports valid`];
  if (model.totalBounty > 0) parts.push(`$${model.totalBounty.toLocaleString()} bountied`);
  if (best.length) parts.push(`pays: ${best.join(", ")}`);
  if (worst.length) parts.push(`avoid: ${worst.join(", ")}`);
  return parts.join(" · ");
}
