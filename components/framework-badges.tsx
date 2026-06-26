import { attackLabel, owaspLabel } from "@/lib/finding-map";

/**
 * Small framework tags for a finding: its MITRE ATT&CK tactic and OWASP Top 10
 * category (deterministically mapped — see lib/finding-map.ts). Renders nothing
 * when a finding has neither.
 */
export function FrameworkBadges({
  attack,
  owasp,
  className = "",
}: {
  attack?: string | null;
  owasp?: string | null;
  className?: string;
}) {
  const a = attackLabel(attack);
  const o = owaspLabel(owasp);
  if (!a && !o) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {a && (
        <span
          className="tag border-red-500/30 text-[10px] text-red-300"
          title="MITRE ATT&CK tactic"
        >
          ATT&amp;CK · {a}
        </span>
      )}
      {o && (
        <span
          className="tag border-amber-500/30 text-[10px] text-amber-300"
          title="OWASP Top 10 (2021) category"
        >
          OWASP · {o}
        </span>
      )}
    </div>
  );
}
