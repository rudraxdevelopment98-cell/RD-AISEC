import Link from "next/link";
import { Icon } from "@/components/icons";
import type { Readiness } from "@/lib/diagnostics";
import { installRequiredTools } from "@/lib/runners";

const LEVEL: Record<string, { icon: string; cls: string; dot: string }> = {
  ok: { icon: "check", cls: "text-emerald-300", dot: "bg-emerald-400" },
  warn: { icon: "alert", cls: "text-amber-300", dot: "bg-amber-400" },
  fail: { icon: "x", cls: "text-red-300", dot: "bg-red-400" },
};

export function EngagementDiagnostics({
  readiness,
  engagementId,
}: {
  readiness: Readiness;
  engagementId: string;
}) {
  const { checks, failCount, warnCount } = readiness;
  const headline =
    failCount > 0
      ? `${failCount} blocker${failCount === 1 ? "" : "s"} stopping bug-finding`
      : warnCount > 0
        ? `Ready, with ${warnCount} thing${warnCount === 1 ? "" : "s"} to improve`
        : "Ready to find bugs";
  const tone = failCount > 0 ? "text-red-300" : warnCount > 0 ? "text-amber-300" : "text-emerald-300";

  return (
    <section className="mt-6">
      <details open={failCount > 0}>
        <summary className="flex cursor-pointer items-center gap-2 text-lg font-semibold">
          <Icon name="shield" className="h-4 w-4 text-brand" />
          Readiness check
          <span className={`ml-2 text-sm font-normal ${tone}`}>· {headline}</span>
        </summary>
        <div className="card mt-3 space-y-2">
          {checks.map((c) => {
            const lv = LEVEL[c.level] ?? LEVEL.warn;
            return (
              <div key={c.id} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${lv.dot}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${lv.cls}`}>{c.label}</p>
                  <p className="text-xs text-gray-500">{c.detail}</p>
                </div>
                {c.fixHref && (
                  <Link
                    href={c.fixHref}
                    className="shrink-0 self-center text-xs text-brand hover:underline"
                  >
                    {c.fixLabel ?? "Fix"} →
                  </Link>
                )}
              </div>
            );
          })}

          {readiness.canInstall && (
            <form action={installRequiredTools} className="mt-1 flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
              <input type="hidden" name="engagementId" value={engagementId} />
              <span className="text-xs text-gray-400">
                Missing on the runner: {readiness.missingTools.join(", ")}
              </span>
              <button className="btn-primary px-3 py-1 text-xs">
                <Icon name="arrow" className="mr-1 inline h-3 w-3" />
                Install all required tools
              </button>
            </form>
          )}
        </div>
      </details>
    </section>
  );
}
