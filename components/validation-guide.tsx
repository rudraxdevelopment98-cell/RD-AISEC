import { Icon } from "@/components/icons";
import type { ValidationPlan } from "@/lib/validation-guide";

export type ValidationResult = {
  tool: string;
  target: string;
  confirmed: boolean;
  proves: boolean;
  signal: string;
  snippet: string;
  when: string;
};

/**
 * The "this vulnerability → this exploit → this result" guide for a finding.
 * Left: the ordered validation plan (what each step tests + what confirms it).
 * Right/below: the interpreted outcome of any validation jobs that have run.
 */
export function ValidationGuide({
  plan,
  results,
}: {
  plan: ValidationPlan;
  results: ValidationResult[];
}) {
  const proven = results.some((r) => r.proves);
  const anyConfirmed = results.some((r) => r.confirmed);

  return (
    <section className="card mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="radar" className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold text-white">Validation guide</h3>
        {results.length > 0 && (
          <span
            className={`tag text-xs ${
              proven
                ? "ring-emerald accent-emerald"
                : anyConfirmed
                  ? "ring-amber accent-amber"
                  : "border-surface-border text-gray-400"
            }`}
          >
            {proven ? "✓ Proven exploitable" : anyConfirmed ? "supporting evidence found" : "not confirmed yet"}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">{plan.note}</p>

      {/* The plan — what we run and what proves it */}
      {plan.steps.length > 0 && (
        <ol className="mt-3 space-y-2">
          {plan.steps.map((s, i) => (
            <li key={i} className="rounded-lg border border-surface-border bg-surface/40 p-3">
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/15 text-[11px] font-bold text-brand">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-white">{s.technique}</span>
                <span
                  className={`tag ml-auto text-[10px] ${
                    s.proves ? "ring-emerald accent-emerald" : "border-surface-border text-gray-400"
                  }`}
                >
                  {s.proves ? "proves" : "supporting"}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{s.why}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[11px] text-gray-300">
                {s.command}
              </pre>
              <p className="mt-1 text-[11px] text-sky-300/80">
                <b>Confirms if:</b> {s.confirmsIf}
              </p>
            </li>
          ))}
        </ol>
      )}

      {/* The result — interpreted outcome of the jobs that ran */}
      {results.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Results</h4>
          <div className="mt-2 space-y-2">
            {results.map((r, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 ${
                  r.proves
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : r.confirmed
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-surface-border bg-surface/30"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Icon
                    name={r.confirmed ? "check" : "x"}
                    className={`h-4 w-4 ${r.proves ? "text-emerald-400" : r.confirmed ? "text-amber-400" : "text-gray-600"}`}
                  />
                  <span className="font-mono text-xs font-semibold text-white">{r.tool}</span>
                  <span className="text-[11px] text-gray-500">on {r.target}</span>
                  <span className="ml-auto text-[10px] text-gray-600">{r.when}</span>
                </div>
                <p className="mt-1 text-xs text-gray-300">
                  {r.proves
                    ? "✓ Confirmed exploitable — "
                    : r.confirmed
                      ? "Supporting evidence — "
                      : "Not confirmed — "}
                  {r.signal}
                </p>
                {r.snippet && (
                  <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 font-mono text-[10px] text-gray-400">
                    {r.snippet}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
