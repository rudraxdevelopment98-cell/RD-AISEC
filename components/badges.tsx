const SEVERITY_STYLES: Record<string, string> = {
  info: "border-gray-500/40 text-gray-300",
  low: "border-sky-500/40 text-sky-300",
  medium: "border-amber-500/40 text-amber-300",
  high: "border-orange-500/40 text-orange-300",
  critical: "border-red-500/50 text-red-300 bg-red-500/10",
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
