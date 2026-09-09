/**
 * Score a bug-bounty program as an autopilot candidate — pure + testable.
 *
 * We only ever RANK and SUGGEST programs here; a human still creates and
 * authorizes the engagement before anything runs. Scoring favours what actually
 * makes a program worth a hunter's time: it pays, its scope is broad, it's open
 * to submissions right now, it has legal safe harbour, and it's reasonably fresh
 * (less picked-over).
 */

export type ProgramSignals = {
  handle?: string;
  name?: string;
  submission_state?: string;
  triage_active?: boolean;
  started_accepting_at?: string;
  offers_bounties?: boolean;
  open_scope?: boolean;
  fast_payments?: boolean;
  gold_standard_safe_harbor?: boolean;
};

export type ProgramScore = {
  handle: string;
  name: string;
  score: number; // 0..100
  reasons: string[];
  eligible: boolean; // open to submissions now
};

/** Months since a date string, or Infinity if absent/unparseable. */
function monthsSince(iso?: string, now: number = Date.now()): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / (30 * 24 * 3600 * 1000);
}

export function scoreProgram(p: ProgramSignals, now: number = Date.now()): ProgramScore {
  const reasons: string[] = [];
  let score = 10; // base

  // A program not open to submissions is not a candidate right now.
  const eligible = (p.submission_state ?? "open") === "open";

  if (p.offers_bounties) {
    score += 40;
    reasons.push("pays bounties");
  } else {
    reasons.push("VDP only (no bounty)");
  }
  if (p.open_scope) {
    score += 20;
    reasons.push("open/wildcard scope");
  }
  if (p.gold_standard_safe_harbor) {
    score += 10;
    reasons.push("gold-standard safe harbour");
  }
  if (p.triage_active) {
    score += 10;
    reasons.push("managed triage");
  }
  if (p.fast_payments) {
    score += 5;
    reasons.push("fast payments");
  }

  // Freshness: a program that started accepting recently is usually less
  // picked-over. Full credit < 6 months, tapering to 0 by ~24 months.
  const m = monthsSince(p.started_accepting_at, now);
  if (m <= 6) {
    score += 15;
    reasons.push("recently opened");
  } else if (m <= 24) {
    score += Math.round(15 * (1 - (m - 6) / 18));
  }

  if (!eligible) {
    score = Math.round(score * 0.3); // heavily deprioritise, don't hide
    reasons.push(`submissions ${p.submission_state ?? "closed"}`);
  }

  return {
    handle: p.handle ?? "",
    name: p.name ?? p.handle ?? "(unnamed)",
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    eligible,
  };
}

/** Rank a batch of programs best-first (eligible first, then score). */
export function rankPrograms(programs: ProgramSignals[], now: number = Date.now()): ProgramScore[] {
  return programs
    .filter((p) => p.handle)
    .map((p) => scoreProgram(p, now))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}
