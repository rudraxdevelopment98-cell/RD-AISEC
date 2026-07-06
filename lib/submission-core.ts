// Pure helpers for vulnerability submissions (status lifecycle + bounty money).
// No DB/IO — usable server or client and unit-testable.

export const SUBMISSION_STATUSES = [
  "draft",
  "submitted",
  "triaged",
  "accepted",
  "duplicate",
  "informative",
  "not_applicable",
  "resolved",
] as const;

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  triaged: "Triaged",
  accepted: "Accepted",
  duplicate: "Duplicate",
  informative: "Informative",
  not_applicable: "N/A",
  resolved: "Resolved · paid",
};

// tag classes for each status (dark theme).
export const STATUS_CLASS: Record<string, string> = {
  draft: "border-gray-500/40 text-gray-400",
  submitted: "border-sky-500/40 text-sky-300",
  triaged: "border-sky-500/40 text-sky-300",
  accepted: "ring-emerald accent-emerald",
  resolved: "ring-emerald accent-emerald",
  duplicate: "border-amber-500/40 text-amber-300",
  informative: "border-gray-500/40 text-gray-400",
  not_applicable: "border-gray-600/40 text-gray-500",
};

/** True for statuses that represent a positive, potentially-paid outcome. */
export function isWon(status: string): boolean {
  return status === "accepted" || status === "resolved";
}

/** Parse a money string ("$1,500", "1500", "1.5k") into integer cents. */
export function parseRewardCents(raw: string): number {
  if (!raw) return 0;
  let s = raw.trim().toLowerCase().replace(/[$,\s]/g, "");
  let mult = 1;
  if (s.endsWith("k")) {
    mult = 1000;
    s = s.slice(0, -1);
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * mult * 100);
}

/** Format integer cents as a dollar string ("$1,500" or "$1,500.50"). */
export function formatReward(cents: number): string {
  if (!cents) return "$0";
  const dollars = cents / 100;
  const hasCents = cents % 100 !== 0;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export type SubmissionLike = { status: string; rewardCents: number };

/** Roll up submissions into counts + total earnings. */
export function submissionStats(subs: SubmissionLike[]): {
  total: number;
  won: number;
  pending: number;
  earnedCents: number;
} {
  let won = 0;
  let pending = 0;
  let earnedCents = 0;
  for (const s of subs) {
    earnedCents += s.rewardCents || 0;
    if (isWon(s.status)) won += 1;
    else if (s.status === "submitted" || s.status === "triaged" || s.status === "draft") pending += 1;
  }
  return { total: subs.length, won, pending, earnedCents };
}
