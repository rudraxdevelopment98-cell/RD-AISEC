import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getEngagement } from "@/lib/engagements";
import { prepAssessment, frameworkName } from "@/lib/report-extras";
import { statusLabel } from "@/lib/consulting-core";
import { severityCounts, gradeFindings, type GradedFinding } from "@/lib/report";
import {
  toAssessmentRow,
  assetSummary,
  remediationRoadmap,
  executiveDashboard,
} from "@/lib/assessment";
import { attackChains } from "@/lib/exploit-strategy";
import { remediationStats, RETEST_LABEL } from "@/lib/retest-core";
import { STATE_LABEL } from "@/lib/bb-engine";
import { publishState } from "@/lib/review-gate";
import { getKevSet } from "@/lib/threat-intel";
import { buildExecutiveSummary } from "@/lib/ai-report";
import { attackLabel, owaspLabel } from "@/lib/finding-map";
import { SeverityBadge } from "@/components/badges";
import { PrintButton } from "@/components/print-button";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: { id: string };
}) {
  const e = await getEngagement(params.id);
  if (!e) notFound();

  // Discipline extras — consulting posture + forensics evidence for this case.
  const [rawAssessments, evidence] = await Promise.all([
    prisma.assessment.findMany({ where: { engagementId: e.id }, orderBy: { createdAt: "desc" }, include: { controls: { orderBy: { controlId: "asc" } } } }),
    prisma.evidence.findMany({ where: { engagementId: e.id }, orderBy: { acquiredAt: "desc" }, include: { custody: { orderBy: { at: "asc" } } } }),
  ]);
  const assessments = rawAssessments.map(prepAssessment);

  const counts = severityCounts(e.findings);
  const kev = await getKevSet();
  const graded = gradeFindings(e.findings, kev);
  const date = new Date(e.createdAt).toISOString().slice(0, 10);
  const summary = buildExecutiveSummary(e);

  // Standard-schema rows across every graded finding → the executive tables.
  const allRows = [
    ...graded.confirmed,
    ...graded.validated,
    ...graded.suspected,
    ...graded.informational,
  ].map((f) => toAssessmentRow(f, f.quality));
  const dash = executiveDashboard(allRows);
  const assets = assetSummary(allRows);
  const roadmap = remediationRoadmap(allRows);
  const chains = attackChains(
    e.findings.map((f) => ({ id: f.id, title: f.title, description: f.description })),
  );
  const remediation = remediationStats(
    e.findings.map((f) => ({ status: f.status, retest: f.retest ?? "", severity: f.severity })),
  );
  const retestedFindings = e.findings.filter((f) => f.retest);

  const SEV_TEXT: Record<string, string> = {
    critical: "text-red-300",
    high: "text-orange-300",
    medium: "text-amber-300",
    low: "text-sky-300",
    info: "text-gray-400",
  };

  const RATING_STYLE: Record<string, string> = {
    Critical: "border-red-500/50 text-red-300",
    High: "border-orange-500/50 text-orange-300",
    Elevated: "border-amber-500/50 text-amber-300",
    Low: "border-sky-500/50 text-sky-300",
    Resolved: "border-emerald-500/50 text-emerald-300",
    Informational: "border-gray-500/50 text-gray-300",
  };

  return (
    <div className="mx-auto max-w-3xl">
      {/* Toolbar — hidden when printing */}
      <div className="flex items-center justify-between print:hidden">
        <Link
          href={`/dashboard/engagements/${e.id}`}
          className="text-sm text-gray-500 hover:text-brand"
        >
          ← Back to engagement
        </Link>
        <div className="flex gap-2">
          <a href={`/api/engagements/${e.id}/report`} className="btn-ghost">
            <Icon name="copy" className="h-4 w-4" /> Download Markdown
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Report — also the print surface */}
      <article className="card mt-4 print:border-0 print:bg-white print:text-black">
        <header className="border-b border-surface-border pb-4 print:border-gray-300">
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Security Assessment Report
          </p>
          <h1 className="mt-1 text-2xl font-bold">{e.name}</h1>
          <div className="mt-3 grid grid-cols-2 gap-1 text-sm text-gray-400 print:text-gray-700 sm:grid-cols-4">
            <p><span className="text-gray-500">Client:</span> {e.client || "—"}</p>
            <p className="capitalize"><span className="text-gray-500">Type:</span> {e.type}</p>
            <p className="capitalize"><span className="text-gray-500">Status:</span> {e.status}</p>
            <p><span className="text-gray-500">Date:</span> {date}</p>
          </div>
          <p
            className={`mt-3 text-sm ${
              e.authorized ? "text-emerald-400" : "text-amber-400"
            } print:text-black`}
          >
            {e.authorized
              ? `Authorized${e.authorizedBy ? ` by ${e.authorizedBy}` : ""}`
              : "⚠ NOT AUTHORIZED — this report should not be issued."}
          </p>
        </header>

        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Executive Summary</h2>
            <span className="flex items-center gap-2 print:hidden">
              <span className="tag">
                <Icon name="bot" className="h-3 w-3" /> AI-drafted
              </span>
              <span
                className={`tag ${RATING_STYLE[summary.rating] ?? RATING_STYLE.Informational}`}
              >
                Risk: {summary.rating}
              </span>
            </span>
          </div>

          {summary.paragraphs.map((para, i) => (
            <p key={i} className="mt-2 text-sm text-gray-300 print:text-black">
              {para}
            </p>
          ))}

          {counts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {counts.map((c) => (
                <span key={c.severity} className="flex items-center gap-2">
                  <SeverityBadge value={c.severity} />
                  <span className="text-sm text-gray-400 print:text-black">× {c.count}</span>
                </span>
              ))}
              <span className="tag ml-auto border-brand/40 text-brand print:text-black" title="From confirmed + validated findings only">
                Validated risk {graded.riskScore}/100
              </span>
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500 print:text-gray-600">
            {graded.counts.confirmed} confirmed · {graded.counts.validated} validated ·{" "}
            {graded.counts.suspected} suspected · {graded.counts.informational} informational
            (recon artifacts excluded from risk).
          </p>
          {graded.pendingReview > 0 && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 print:text-amber-800">
              ⚠ {graded.pendingReview} high-impact finding(s) are pending human review — not yet
              cleared for publication or submission.
            </p>
          )}

          {summary.keyRisks.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-200 print:text-black">Key risks</h3>
              <ul className="mt-2 space-y-1">
                {summary.keyRisks.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm text-gray-300 print:text-black">
                    <SeverityBadge value={r.severity} />
                    <span>{r.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.recommendations.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-gray-200 print:text-black">
                Prioritized recommendations
              </h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-300 print:text-black">
                {summary.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {allRows.length > 0 && (
          <>
            {/* Executive Dashboard */}
            <section className="mt-6">
              <h2 className="text-lg font-semibold">Executive Dashboard</h2>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Findings", value: dash.total },
                  { label: "Assets", value: dash.assets },
                  { label: "Critical", value: dash.bySeverity.critical },
                  { label: "High", value: dash.bySeverity.high },
                  { label: "Confirmed", value: dash.confirmed },
                  { label: "KEV (exploited)", value: dash.knownExploited },
                  { label: "Validated", value: dash.validated },
                  { label: "Avg. confidence", value: `${dash.avgConfidence}/100` },
                ].map((m) => (
                  <div
                    key={m.label}
                    className="rounded-lg border border-surface-border px-3 py-2 print:border-gray-300"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-gray-500 print:text-gray-600">
                      {m.label}
                    </p>
                    <p className="mt-0.5 text-xl font-bold text-white print:text-black">{m.value}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Asset Summary */}
            {assets.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Asset Summary</h2>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="py-1.5 pr-3">Asset</th>
                        <th className="py-1.5 pr-3">Top</th>
                        <th className="py-1.5 pr-2 text-right">Crit</th>
                        <th className="py-1.5 pr-2 text-right">High</th>
                        <th className="py-1.5 pr-2 text-right">Med</th>
                        <th className="py-1.5 pr-2 text-right">Low</th>
                        <th className="py-1.5 pr-2 text-right">Info</th>
                        <th className="py-1.5 pr-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-300 print:text-black">
                      {assets.map((a) => (
                        <tr key={a.asset} className="border-t border-surface-border print:border-gray-300">
                          <td className="py-1.5 pr-3 font-mono text-xs">{a.asset}</td>
                          <td className={`py-1.5 pr-3 font-medium capitalize ${SEV_TEXT[a.topSeverity]}`}>
                            {a.topSeverity}
                          </td>
                          <td className="py-1.5 pr-2 text-right">{a.critical}</td>
                          <td className="py-1.5 pr-2 text-right">{a.high}</td>
                          <td className="py-1.5 pr-2 text-right">{a.medium}</td>
                          <td className="py-1.5 pr-2 text-right">{a.low}</td>
                          <td className="py-1.5 pr-2 text-right">{a.info}</td>
                          <td className="py-1.5 pr-2 text-right font-semibold">{a.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Remediation Roadmap */}
            {roadmap.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Remediation Roadmap</h2>
                <p className="mt-1 text-xs text-gray-500 print:text-gray-600">
                  Prioritized by severity then confidence — fix in this order.
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="py-1.5 pr-2">#</th>
                        <th className="py-1.5 pr-3">Finding</th>
                        <th className="py-1.5 pr-3">Sev</th>
                        <th className="py-1.5 pr-3">Effort</th>
                        <th className="py-1.5 pr-3">Target</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-300 print:text-black">
                      {roadmap.slice(0, 25).map((r) => (
                        <tr key={r.priority} className="border-t border-surface-border align-top print:border-gray-300">
                          <td className="py-1.5 pr-2 text-gray-500">{r.priority}</td>
                          <td className="py-1.5 pr-3">
                            {r.title}
                            <span className="block font-mono text-[11px] text-gray-500">{r.asset}</span>
                          </td>
                          <td className={`py-1.5 pr-3 font-medium capitalize ${SEV_TEXT[r.severity]}`}>
                            {r.severity}
                          </td>
                          <td className="py-1.5 pr-3 text-gray-400 print:text-black">{r.effort}</td>
                          <td className="py-1.5 pr-3 text-gray-400 print:text-black">{r.when}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Remediation Status — the retest loop: what the client fixed and
                what we re-verified. This is the pentest deliverable's outcome. */}
            {retestedFindings.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Remediation Status</h2>
                <p className="mt-1 text-xs text-gray-500 print:text-gray-600">
                  Retest outcomes after remediation — verified fixes vs. issues still exploitable.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "Verified fixed", value: remediation.verifiedFixed, cls: "text-emerald-300" },
                    { label: "Still exploitable", value: remediation.stillExploitable, cls: "text-red-300" },
                    { label: "Awaiting retest", value: remediation.requested, cls: "text-amber-300" },
                    { label: "Closed", value: `${remediation.closedPct}%`, cls: "text-white" },
                  ].map((m) => (
                    <div key={m.label} className="rounded-lg border border-surface-border px-3 py-2 print:border-gray-300">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500 print:text-gray-600">{m.label}</p>
                      <p className={`mt-0.5 text-xl font-bold ${m.cls} print:text-black`}>{m.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="py-1.5 pr-3">Finding</th>
                        <th className="py-1.5 pr-3">Sev</th>
                        <th className="py-1.5 pr-3">Retest</th>
                        <th className="py-1.5 pr-3">Note</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-300 print:text-black">
                      {retestedFindings.map((f) => (
                        <tr key={f.id} className="border-t border-surface-border align-top print:border-gray-300">
                          <td className="py-1.5 pr-3">{f.title}</td>
                          <td className={`py-1.5 pr-3 font-medium capitalize ${SEV_TEXT[f.severity]}`}>{f.severity}</td>
                          <td className={`py-1.5 pr-3 ${f.retest === "passed" ? "text-emerald-300" : f.retest === "failed" ? "text-red-300" : "text-amber-300"} print:text-black`}>
                            {RETEST_LABEL[f.retest ?? ""] ?? f.retest}
                            {f.retestedAt ? <span className="block text-[11px] text-gray-500">{new Date(f.retestedAt).toISOString().slice(0, 10)}</span> : null}
                          </td>
                          <td className="py-1.5 pr-3 text-gray-400 print:text-black">{f.retestNote || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Attack Paths — findings correlated into plausible kill-chains. */}
            {chains.length > 0 && (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Attack Paths</h2>
                <p className="mt-1 text-xs text-gray-500 print:text-gray-600">
                  Individual findings correlated into multi-step attack chains — the real risk is
                  often the combination, not any single issue.
                </p>
                <div className="mt-3 space-y-3">
                  {chains.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-surface-border p-3 print:border-gray-300"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-white print:text-black">{c.title}</h3>
                        <span className={`tag capitalize ${SEV_TEXT[c.severity]}`}>{c.severity}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400 print:text-black">{c.narrative}</p>
                      {c.links.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-400 print:text-black">
                          {c.links.map((l, i) => (
                            <span key={l.findingId} className="flex items-center gap-1">
                              {i > 0 && <span className="text-gray-600">→</span>}
                              <span className="rounded border border-surface-border px-1.5 py-0.5 print:border-gray-300">
                                {l.label}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {e.scope && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Scope</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300 print:text-black">
              {e.scope}
            </p>
          </section>
        )}

        {(() => {
          const renderItem = (f: GradedFinding, i: number) => (
            <li key={f.id} className="border-l-2 border-surface-border pl-4 print:border-gray-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-white print:text-black">
                  {i + 1}. {f.title}
                </h3>
                <span className="flex flex-wrap items-center gap-2">
                  <SeverityBadge value={f.quality.severity} />
                  <span className="tag border-surface-border text-gray-300 print:text-black">
                    {STATE_LABEL[f.quality.state]}
                  </span>
                  {f.quality.knownExploited && (
                    <span className="tag border-red-500/60 text-red-300 print:text-red-700" title="In CISA KEV — actively exploited in the wild">🔥 KEV</span>
                  )}
                  {publishState({ title: f.title, description: f.description, severity: f.severity, confirmedFlag: f.confirmed, reviewed: f.reviewed }) === "pending_review" && (
                    <span className="tag border-amber-500/50 text-amber-300 print:text-amber-700">⚠ pending review</span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 print:text-gray-600">
                Confidence {f.quality.confidence}/100
                {f.quality.state !== "informational" && (
                  <> · est. acceptance {f.quality.bugBountyProbability}%{f.quality.vulnClass ? ` (${f.quality.vulnClass})` : ""}</>
                )}
                {(attackLabel(f.attack) || owaspLabel(f.owasp)) && (
                  <>
                    {"  ·  "}
                    {[
                      attackLabel(f.attack) && `ATT&CK ${attackLabel(f.attack)}`,
                      owaspLabel(f.owasp) && `OWASP ${owaspLabel(f.owasp)}`,
                    ].filter(Boolean).join("  ·  ")}
                  </>
                )}
              </p>
              {(() => {
                const row = toAssessmentRow(f, f.quality);
                return (
                  <>
                    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="inline text-gray-500">Category: </dt>
                        <dd className="inline text-gray-300 print:text-black">{row.category}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-500">Affected asset: </dt>
                        <dd className="inline font-mono text-gray-300 print:text-black">{row.affectedAsset}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-500">CVSS (approx): </dt>
                        <dd className="inline text-gray-300 print:text-black">{row.cvss}{row.cve ? ` · ${row.cve}` : ""}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-500">Detection: </dt>
                        <dd className="inline text-gray-300 print:text-black">{row.detectionMethod}</dd>
                      </div>
                    </dl>
                    <p className="mt-1 text-xs text-gray-400 print:text-black">
                      <span className="text-gray-500">Business impact: </span>{row.businessImpact}
                    </p>
                    {f.description && (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300 print:text-black">
                        {f.description}
                      </p>
                    )}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300 print:text-black">
                      <span className="text-gray-500">Recommended fix: </span>
                      {row.recommendedFix}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-gray-400 print:text-black">
                      <span className="text-gray-500">Verification: </span>
                      {row.verification}
                    </p>
                  </>
                );
              })()}
            </li>
          );
          const Section = ({ title, note, rows }: { title: string; note: string; rows: GradedFinding[] }) =>
            rows.length === 0 ? null : (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">{title}</h2>
                <p className="mt-1 text-xs text-gray-500 print:text-gray-600">{note}</p>
                <ol className="mt-3 space-y-4">{rows.map(renderItem)}</ol>
              </section>
            );
          const total =
            graded.confirmed.length + graded.validated.length + graded.suspected.length + graded.informational.length;
          if (total === 0) {
            return (
              <section className="mt-6">
                <h2 className="text-lg font-semibold">Findings</h2>
                <p className="mt-2 text-sm text-gray-500">No findings recorded.</p>
              </section>
            );
          }
          return (
            <>
              <Section title="Confirmed Exploitable Vulnerabilities" note="A working proof-of-concept demonstrated real impact." rows={graded.confirmed} />
              <Section title="Validated Vulnerabilities" note="An active check demonstrated the weakness." rows={graded.validated} />
              <Section title="Suspected Findings" note="Detected but not yet validated — reproduce/exploit before relying on these." rows={graded.suspected} />
              {graded.informational.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold">Informational &amp; Reconnaissance Artifacts</h2>
                  <p className="mt-1 text-xs text-gray-500 print:text-gray-600">
                    No direct security impact; excluded from the risk score.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-400 print:text-black">
                    {graded.informational.map((f) => (
                      <li key={f.id}>{f.title}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        })()}

        {/* Security Posture Assessment (consulting) */}
        {assessments.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Security Posture Assessment</h2>
            <div className="mt-3 space-y-4">
              {assessments.map((a) => (
                <div key={a.id} className="rounded-xl border border-surface-border p-3 print:border-gray-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white print:text-black">{a.name} — {frameworkName(a.framework)}</h3>
                    <span className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-white print:text-black">{a.score.score}</span>
                      <span className="text-xs text-gray-500">/100 · maturity {a.score.maturityAvg.toFixed(1)}/5</span>
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-border print:border print:border-gray-300">
                    <div className="h-full" style={{ width: `${a.score.score}%`, background: a.score.score >= 70 ? "#10b981" : a.score.score >= 40 ? "#f59e0b" : "#ef4444" }} />
                  </div>
                  <p className="mt-1 text-xs text-gray-500 print:text-gray-600">
                    {a.score.pass} pass · {a.score.partial} partial · {a.score.fail} fail · {a.score.na} n/a
                  </p>
                  {a.score.byDomain.length > 1 && (
                    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {a.score.byDomain.map((d) => (
                        <div key={d.domain} className="flex items-center gap-2 text-[11px]">
                          <span className="w-24 shrink-0 truncate text-gray-500 print:text-black">{d.domain}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-border">
                            <div className="h-full" style={{ width: `${d.score}%`, background: d.score >= 70 ? "#10b981" : d.score >= 40 ? "#f59e0b" : "#ef4444" }} />
                          </div>
                          <span className="w-8 shrink-0 text-right text-gray-500">{d.score}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {a.gaps.length > 0 && (
                    <div className="mt-3 overflow-x-auto">
                      <p className="text-xs font-semibold text-gray-400 print:text-black">Gaps &amp; recommendations</p>
                      <table className="mt-1 w-full text-left text-xs">
                        <thead className="text-[10px] uppercase tracking-wide text-gray-500">
                          <tr><th className="py-1 pr-3">Control</th><th className="py-1 pr-3">Status</th><th className="py-1">Recommendation</th></tr>
                        </thead>
                        <tbody className="text-gray-300 print:text-black">
                          {a.gaps.map((c) => (
                            <tr key={c.controlId} className="border-t border-surface-border align-top print:border-gray-300">
                              <td className="py-1 pr-3">{c.title}</td>
                              <td className={`py-1 pr-3 ${c.status === "fail" ? "text-red-300" : "text-amber-300"}`}>{statusLabel(c.status)}</td>
                              <td className="py-1">{c.recommendation || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Evidence & Chain of Custody (forensics) */}
        {evidence.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold">Evidence &amp; Chain of Custody</h2>
            <div className="mt-3 space-y-3">
              {evidence.map((ev) => (
                <div key={ev.id} className="rounded-xl border border-surface-border p-3 print:border-gray-300">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-white print:text-black">{ev.name}</h3>
                    <span className="text-[11px] text-gray-500">{ev.kind}{ev.size ? ` · ${ev.size}` : ""}</span>
                  </div>
                  <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                    {ev.source && <div><dt className="inline text-gray-500">Source: </dt><dd className="inline text-gray-300 print:text-black">{ev.source}</dd></div>}
                    <div><dt className="inline text-gray-500">Acquired: </dt><dd className="inline text-gray-300 print:text-black">{ev.acquiredBy || "—"} · {new Date(ev.acquiredAt).toISOString().slice(0, 16).replace("T", " ")}</dd></div>
                    <div className="sm:col-span-2"><dt className="inline text-gray-500">Integrity: </dt><dd className="inline break-all font-mono text-gray-300 print:text-black">{ev.hashValue ? `${ev.hashAlgo}:${ev.hashValue}` : "— no hash recorded"}</dd></div>
                  </dl>
                  {ev.custody.length > 0 && (
                    <ol className="mt-2 space-y-0.5 border-t border-surface-border pt-2 text-[11px] text-gray-400 print:border-gray-300 print:text-black">
                      {ev.custody.map((c) => (
                        <li key={c.id}>
                          <span className="text-gray-500">{new Date(c.at).toISOString().slice(0, 16).replace("T", " ")}</span> — <b>{c.action}</b> by {c.actor || "—"}{c.notes ? `: ${c.notes}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-8 border-t border-surface-border pt-4 text-xs text-gray-500 print:border-gray-300">
          Generated by RD-AISEC. For authorized security testing and education
          only.
        </footer>
      </article>
    </div>
  );
}
