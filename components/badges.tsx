import type { Confidence } from "@/lib/exploit-confidence";

// Severity uses the tokenized `sev-*` scale (globals.css → tailwind), so it stays
// correct in both themes with no per-theme override hacks.
const SEVERITY_STYLES: Record<string, string> = {
  info: "border-sev-info/40 text-sev-info bg-sev-info/10",
  low: "border-sev-low/40 text-sev-low bg-sev-low/10",
  medium: "border-sev-med/50 text-sev-med bg-sev-med/15",
  high: "border-sev-high/50 text-sev-high bg-sev-high/15",
  critical: "border-sev-crit/60 text-sev-crit bg-sev-crit/15",
};

const FINDING_STATUS_STYLES: Record<string, string> = {
  open: "border-sev-med/40 text-sev-med",
  fixed: "border-brand/40 text-brand",
  accepted: "border-sev-info/40 text-sev-info",
  false_positive: "border-surface-border text-gray-400",
};

const ENGAGEMENT_STATUS_STYLES: Record<string, string> = {
  planning: "border-sev-info/40 text-sev-info",
  active: "border-brand/40 text-brand",
  completed: "border-sev-low/40 text-sev-low",
};

function label(s: string) {
  return s.replace(/_/g, " ");
}

// Proof-by-exploitation confidence (see lib/exploit-confidence.ts).
const CONFIDENCE_STYLES: Record<Confidence, string> = {
  proven: "border-sev-crit/60 text-sev-crit bg-sev-crit/15",
  validated: "border-brand/50 text-brand bg-brand/10",
  reported: "border-sev-info/40 text-gray-400",
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
