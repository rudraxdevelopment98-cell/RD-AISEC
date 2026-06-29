import type { Confidence } from "@/lib/exploit-confidence";

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-gray-500/40 text-gray-200 bg-gray-500/10",
  low: "border-sky-500/40 text-sky-200 bg-sky-500/10",
  medium: "border-amber-500/50 text-amber-200 bg-amber-500/15",
  high: "border-orange-500/50 text-orange-200 bg-orange-500/15",
  critical: "border-red-500/60 text-red-200 bg-red-500/20",
};

const FINDING_STATUS_STYLES: Record<string, string> = {
  open: "border-amber-500/40 text-amber-300",
  fixed: "border-emerald-500/40 text-emerald-300",
  accepted: "border-gray-500/40 text-gray-300",
  false_positive: "border-slate-500/40 text-slate-400",
};

const ENGAGEMENT_STATUS_STYLES: Record<string, string> = {
  planning: "border-gray-500/40 text-gray-300",
  active: "border-emerald-500/40 text-emerald-300",
  completed: "border-sky-500/40 text-sky-300",
};

function label(s: string) {
  return s.replace(/_/g, " ");
}

// Proof-by-exploitation confidence (see lib/exploit-confidence.ts).
const CONFIDENCE_STYLES: Record<Confidence, string> = {
  proven: "border-red-500/60 text-red-200 bg-red-500/15",
  validated: "border-emerald-500/50 text-emerald-200 bg-emerald-500/10",
  reported: "border-gray-500/40 text-gray-400",
};
const CONFIDENCE_TITLE: Record<Confidence, string> = {
  proven: "Proven — a working exploit ran",
  validated: "Validated — an active check demonstrated it",
  reported: "Reported — detected by a scanner, not yet validated",
};
export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span className={`tag ${CONFIDENCE_STYLES[value]}`} title={CONFIDENCE_TITLE[value]}>
      {value}
    </span>
  );
}

export function SeverityBadge({ value }: { value: string }) {
  return (
    <span className={`tag uppercase ${SEVERITY_STYLES[value] ?? SEVERITY_STYLES.info}`}>
      {label(value)}
    </span>
  );
}

export function FindingStatusBadge({ value }: { value: string }) {
  return (
    <span className={`tag ${FINDING_STATUS_STYLES[value] ?? FINDING_STATUS_STYLES.open}`}>
      {label(value)}
    </span>
  );
}

export function EngagementStatusBadge({ value }: { value: string }) {
  return (
    <span className={`tag ${ENGAGEMENT_STATUS_STYLES[value] ?? ENGAGEMENT_STATUS_STYLES.planning}`}>
      {label(value)}
    </span>
  );
}
