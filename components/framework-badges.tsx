import Link from "next/link";
import { attackLabel, owaspLabel } from "@/lib/finding-map";

/**
 * Small framework tags for a finding: its MITRE ATT&CK tactic and OWASP Top 10
 * category (deterministically mapped — see lib/finding-map.ts). Renders nothing
 * when a finding has neither. When `linked` is set, each tag links to the
 * Findings page filtered to that framework value.
 */
export function FrameworkBadges({
  attack,
  owasp,
  className = "",
  linked = false,
}: {
  attack?: string | null;
  owasp?: string | null;
  className?: string;
  linked?: boolean;
}) {
  const a = attackLabel(attack);
  const o = owaspLabel(owasp);
  if (!a && !o) return null;

  const attackCls =
    "tag border-red-500/30 text-[10px] text-red-300" +
    (linked ? " transition hover:border-red-400 hover:bg-red-500/10" : "");
  const owaspCls =
    "tag border-amber-500/30 text-[10px] text-amber-300" +
    (linked ? " transition hover:border-amber-400 hover:bg-amber-500/10" : "");

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {a &&
        (linked ? (
          <Link href={`/dashboard/findings?attack=${attack}`} className={attackCls} title="Filter findings by this ATT&CK tactic">
            ATT&amp;CK · {a}
          </Link>
        ) : (
          <span className={attackCls} title="MITRE ATT&CK tactic">
            ATT&amp;CK · {a}
          </span>
        ))}
      {o &&
        (linked ? (
          <Link href={`/dashboard/findings?owasp=${owasp}`} className={owaspCls} title="Filter findings by this OWASP category">
            OWASP · {o}
          </Link>
        ) : (
          <span className={owaspCls} title="OWASP Top 10 (2021) category">
            OWASP · {o}
          </span>
        ))}
    </div>
  );
}
