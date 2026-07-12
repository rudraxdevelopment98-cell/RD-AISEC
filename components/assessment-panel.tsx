import { Icon } from "@/components/icons";
import { createAssessment, setControl, addControl, deleteAssessment } from "@/lib/consulting";
import { FRAMEWORKS, CONTROL_STATUSES, statusLabel, statusColor, scoreControls } from "@/lib/consulting-core";

type Control = { id: string; controlId: string; domain: string; title: string; status: string; maturity: number; notes: string; recommendation: string };
type Assessment = { id: string; name: string; framework: string; notes: string; controls: Control[] };

const field = "rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

export function AssessmentPanel({ engagementId, assessments }: { engagementId: string; assessments: Assessment[] }) {
  return (
    <div id="assessment" className="scroll-mt-20">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon name="shield" className="h-5 w-5 text-brand" /> Assessments
        <span className="text-sm font-normal text-gray-500">({assessments.length})</span>
      </h2>
      <p className="mt-1 text-sm text-gray-400">
        Score the client against a framework — each control gets a status and a
        maturity level; the rollup drives the advisory posture score.
      </p>

      {/* New assessment */}
      <details className="card mt-3">
        <summary className="cursor-pointer font-semibold text-brand">+ New assessment</summary>
        <form action={createAssessment} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="engagementId" value={engagementId} />
          <input name="name" placeholder="Name (optional)" className={field} />
          <select name="framework" defaultValue="nist-csf" className={field}>
            {FRAMEWORKS.map((f) => <option key={f.id} value={f.id}>{f.name} — {f.controls.length || "empty"} controls</option>)}
          </select>
          <button className="btn-primary sm:col-span-2">Create &amp; seed controls</button>
        </form>
      </details>

      {assessments.length === 0 ? (
        <p className="card mt-3 text-sm text-gray-500">No assessments yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {assessments.map((a) => {
            const s = scoreControls(a.controls);
            return (
              <div key={a.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-white">{a.name || "Untitled assessment"}</p>
                    <p className="text-xs text-gray-500">{FRAMEWORKS.find((f) => f.id === a.framework)?.name ?? a.framework} · {a.controls.length} controls</p>
                  </div>
                  <form action={deleteAssessment}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="engagementId" value={engagementId} />
                    <button className="text-xs text-gray-600 hover:text-sev-crit">Delete</button>
                  </form>
                </div>

                {/* Score summary */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-white">{s.score}</span>
                    <span className="text-xs text-gray-500">/100 posture</span>
                  </div>
                  <span className="text-xs text-gray-500">maturity {s.maturityAvg.toFixed(1)}/5</span>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    <span className="tag ring-emerald accent-emerald">{s.pass} pass</span>
                    <span className="tag border-sev-med/40 text-sev-med">{s.partial} partial</span>
                    <span className="tag border-sev-crit/40 text-sev-crit">{s.fail} fail</span>
                    <span className="tag">{s.na} n/a</span>
                  </div>
                </div>
                {/* posture bar */}
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-border">
                  <div className="h-full rounded-full" style={{ width: `${s.score}%`, background: s.score >= 70 ? "#10b981" : s.score >= 40 ? "#f59e0b" : "#ef4444" }} />
                </div>

                {/* Per-domain breakdown */}
                {s.byDomain.length > 1 && (
                  <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                    {s.byDomain.map((d) => (
                      <div key={d.domain} className="flex items-center gap-2 text-[11px]">
                        <span className="w-24 shrink-0 truncate text-gray-400">{d.domain}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-border">
                          <div className="h-full" style={{ width: `${d.score}%`, background: d.score >= 70 ? "#10b981" : d.score >= 40 ? "#f59e0b" : "#ef4444" }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-gray-500">{d.score}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Controls */}
                <div className="mt-4 space-y-1.5">
                  {a.controls.map((c) => (
                    <details key={c.id} className="rounded-lg border border-surface-border bg-black/20">
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                        <span className={`h-2 w-2 shrink-0 rounded-full`} style={{ background: dotColor(c.status) }} />
                        <span className="min-w-0 flex-1 truncate text-gray-200">{c.title}</span>
                        {c.domain && <span className="hidden shrink-0 text-[10px] text-gray-500 sm:inline">{c.domain}</span>}
                        <span className={`tag ring-${statusColor(c.status)} accent-${statusColor(c.status)}`}>{statusLabel(c.status)}</span>
                      </summary>
                      <form action={setControl} className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="engagementId" value={engagementId} />
                        <label className="text-xs text-gray-500">Status
                          <select name="status" defaultValue={c.status} className={`${field} mt-1 w-full py-1.5 text-xs capitalize`}>
                            {CONTROL_STATUSES.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-gray-500">Maturity (0–5)
                          <select name="maturity" defaultValue={String(c.maturity)} className={`${field} mt-1 w-full py-1.5 text-xs`}>
                            {[0, 1, 2, 3, 4, 5].map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </label>
                        <input name="notes" defaultValue={c.notes} placeholder="Notes / evidence" className={`${field} py-1.5 text-xs sm:col-span-2`} />
                        <input name="recommendation" defaultValue={c.recommendation} placeholder="Recommendation" className={`${field} py-1.5 text-xs sm:col-span-2`} />
                        <button className="btn-ghost px-3 py-1.5 text-xs sm:col-span-2">Save control</button>
                      </form>
                    </details>
                  ))}
                </div>

                {/* Add custom control */}
                <form action={addControl} className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="assessmentId" value={a.id} />
                  <input type="hidden" name="engagementId" value={engagementId} />
                  <input name="domain" placeholder="Domain" className={`${field} w-28 py-1.5 text-xs`} />
                  <input name="title" placeholder="Add a custom control…" className={`${field} flex-1 py-1.5 text-xs`} />
                  <button className="btn-ghost px-3 py-1.5 text-xs">Add</button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function dotColor(status: string): string {
  return ({ pass: "#10b981", partial: "#f59e0b", fail: "#ef4444", na: "#64748b" } as Record<string, string>)[status] ?? "#64748b";
}
