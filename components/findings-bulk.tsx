"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { SeverityBadge, FindingStatusBadge, ConfidenceBadge } from "@/components/badges";
import type { Confidence } from "@/lib/exploit-confidence";
import { FrameworkBadges } from "@/components/framework-badges";
import { bulkDeleteFindings, bulkSetStatus, bulkSetCategory, setRetest } from "@/lib/finding-actions";
import { sourceCount } from "@/lib/dedup-core";
import { signalScore, TIER_LABEL, TIER_CLASS } from "@/lib/finding-signal";
import { RETEST_LABEL, RETEST_CLASS } from "@/lib/retest-core";

export type FindingRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  attack: string;
  owasp: string;
  confirmed: boolean;
  confidence: Confidence;
  category: string;
  sources?: string;
  retest?: string;
  retestNote?: string;
  kev?: boolean;
  risk?: number | null;
  chain?: string;
  engagementId: string;
  engagementName: string | null;
};

const STATUSES = ["open", "fixed", "accepted", "false_positive"];

// Subtle tile glow keyed to the finding's risk level.
const SEV_GLOW: Record<string, string> = {
  critical: "sev-glow-critical",
  high: "sev-glow-high",
  medium: "sev-glow-medium",
  low: "sev-glow-low",
  info: "sev-glow-info",
};

export function FindingsBulk({ findings }: { findings: FindingRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [status, setStatus] = useState("fixed");
  const [category, setCategory] = useState("");

  const toggle = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  function run(action: (fd: FormData) => Promise<void>, extra?: Record<string, string>) {
    const fd = new FormData();
    selected.forEach((id) => fd.append("ids", id));
    if (extra) for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    start(async () => {
      await action(fd);
      setSelected(new Set());
    });
  }

  return (
    <div className="mt-4">
      {/* Action bar — sticks under the page title bar so bulk controls stay in
          reach while the list scrolls. */}
      <div className="sticky-under-header flex flex-wrap items-center gap-2 rounded-lg border border-surface-border bg-surface p-2 text-xs">
        <label className="flex items-center gap-1.5 text-gray-400">
          <input
            type="checkbox"
            checked={findings.length > 0 && findings.every((f) => selected.has(f.id))}
            onChange={(e) => setSelected(e.target.checked ? new Set(findings.map((f) => f.id)) : new Set())}
          />
          Select all
        </label>
        <span className="text-gray-400">{selected.size} selected</span>
        {selected.size > 0 && (
          <>
            <span className="text-gray-700">·</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-surface-border bg-surface px-2 py-1 capitalize outline-none focus:border-brand">
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
            <button disabled={pending} onClick={() => run(bulkSetStatus, { status })} className="btn-ghost px-2 py-1">Set status</button>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category" className="w-28 rounded-md border border-surface-border bg-surface px-2 py-1 outline-none focus:border-brand" />
            <button disabled={pending} onClick={() => run(bulkSetCategory, { category })} className="btn-ghost px-2 py-1">Tag</button>
            <button
              disabled={pending}
              onClick={() => { if (confirm(`Delete ${selected.size} finding(s)?`)) run(bulkDeleteFindings); }}
              className="rounded-md border border-sev-crit/40 px-2 py-1 text-sev-crit hover:bg-sev-crit/10"
            >
              Delete
            </button>
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:text-gray-300">Clear</button>
          </>
        )}
      </div>

      {/* Cards */}
      <div className="mt-3 space-y-3">
        {findings.map((f) => {
          const sig = signalScore(f);
          return (
          <div
            key={f.id}
            className={`card ${SEV_GLOW[f.severity] ?? ""}`}
          >
            {/* Title first (full width), badges wrap on their own row beneath —
                so a long multi-line title never collides with the frosted
                badges (the mobile "ghost pill over the title" bug). */}
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                onChange={() => toggle(f.id)}
                className="mt-1 shrink-0"
                aria-label="Select finding"
              />
              {f.confidence === "proven" && (
                <span className="dot-blink mt-1.5 shrink-0" title="Proven exploitable" />
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/dashboard/engagements/${f.engagementId}`} className="font-semibold text-white hover:text-brand break-words">
                  {f.title}
                </Link>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`tag ${TIER_CLASS[sig.tier]}`}
                    title={`Triage priority ${sig.score}/100${sig.reasons.length ? " — " + sig.reasons.join(", ") : ""}`}
                  >
                    {TIER_LABEL[sig.tier]}
                  </span>
                  <ConfidenceBadge value={f.confidence} />
                  {sourceCount(f.sources) > 1 && (
                    <span className="tag ring-emerald accent-emerald" title={`Independently detected by: ${f.sources}`}>
                      🔗 {sourceCount(f.sources)} tools
                    </span>
                  )}
                  {f.category && <span className="tag">{f.category}</span>}
                  {f.kev && (
                    <span
                      className="tag border-sev-crit/50 bg-sev-crit/15 text-sev-crit"
                      title="A CVE in this finding is in CISA's Known Exploited Vulnerabilities catalog — actively exploited in the wild."
                    >
                      🔥 KEV · exploited
                    </span>
                  )}
                  {f.chain && (
                    <span
                      className="tag border-sev-high/50 bg-sev-high/15 text-sev-high"
                      title={`Attack chain — risk boosted: ${f.chain}`}
                    >
                      ⛓ {f.chain}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">Risk</span>
                    {typeof f.risk === "number" && (
                      <span
                        className="font-mono text-xs font-semibold tabular-nums text-gray-200"
                        title="Engine risk score 0–100 (CVSS + proof + KEV + EPSS + exposure)"
                      >
                        {f.risk}
                      </span>
                    )}
                    <SeverityBadge value={f.severity} />
                  </span>
                  <FindingStatusBadge value={f.status} />
                  {f.retest ? (
                    <span
                      className={`tag ${RETEST_CLASS[f.retest] ?? ""}`}
                      title={f.retestNote || RETEST_LABEL[f.retest]}
                    >
                      ↻ {RETEST_LABEL[f.retest] ?? f.retest}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <FrameworkBadges attack={f.attack} owasp={f.owasp} className="mt-2 pl-6" linked />
            <div className="mt-2 flex flex-wrap items-center gap-3 pl-6 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Icon name="briefcase" className="h-3 w-3" />
                <Link href={`/dashboard/engagements/${f.engagementId}`} className="hover:text-gray-300">
                  {f.engagementName ?? "Unknown engagement"}
                </Link>
              </span>
              <Link
                href={`/dashboard/findings/${f.id}/exploit`}
                className="font-medium text-sev-crit hover:text-sev-crit"
              >
                ⚔ Exploit it →
              </Link>
            </div>
            {/* Remediation retest loop — client fixed it → retest → verified/failed. */}
            <form action={setRetest} className="mt-2 flex flex-wrap items-center gap-1.5 pl-6 text-[11px]">
              <input type="hidden" name="id" value={f.id} />
              <span className="text-[10px] uppercase tracking-wide text-gray-500">Retest</span>
              <button name="retest" value="requested" className="btn-ghost px-2 py-0.5">Requested</button>
              <button name="retest" value="passed" className="rounded-md border border-brand/40 px-2 py-0.5 text-brand hover:bg-brand/10">✓ Fixed</button>
              <button name="retest" value="failed" className="rounded-md border border-sev-crit/40 px-2 py-0.5 text-sev-crit hover:bg-sev-crit/10">✗ Still open</button>
              {f.retest ? (
                <button name="retest" value="" className="text-gray-600 hover:text-gray-400">clear</button>
              ) : null}
            </form>
          </div>
          );
        })}
      </div>
    </div>
  );
}
