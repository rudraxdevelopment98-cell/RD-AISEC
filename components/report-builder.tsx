"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import {
  buildHumanReport,
  buildStructuredReport,
  assessValidity,
  type ReportInput,
} from "@/lib/report-narrative";
import { submitUrl, submissionHints } from "@/lib/submission";

const LEVEL_STYLE: Record<string, string> = {
  ready: "ring-emerald accent-emerald",
  review: "ring-amber accent-amber",
  weak: "border-sev-crit/40 text-sev-crit",
};
const LEVEL_LABEL: Record<string, string> = {
  ready: "Looks submittable",
  review: "Worth a review first",
  weak: "Needs more before submitting",
};

/**
 * Builds a finding into a report with two voices — a natural human narrative
 * (what we submit) and a structured engine writeup (for records) — shows a
 * "submittable yet?" assessment, and one-click copy. Deterministic; no AI.
 */
export function ReportBuilder(
  props: ReportInput & { programUrl?: string | null; platform?: string },
) {
  const [format, setFormat] = useState<"human" | "structured">("human");
  const [copied, setCopied] = useState(false);

  const human = useMemo(() => buildHumanReport(props), [props]);
  const structured = useMemo(() => buildStructuredReport(props), [props]);
  const validity = useMemo(() => assessValidity(props), [props]);
  const text = format === "human" ? human : structured;
  const submit = submitUrl(props.platform ?? "", props.programUrl);
  const hints = useMemo(() => submissionHints(props.platform ?? ""), [props.platform]);

  function copyAndGo() {
    navigator.clipboard?.writeText(human); // always submit the human voice
  }

  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <details className="group/report">
      <summary className="btn-ghost cursor-pointer list-none px-2 py-1 text-xs">
        <Icon name="copy" className="mr-1 inline h-3 w-3" /> Report
      </summary>
      <div className="glass-panel mt-2 w-[min(34rem,90vw)] space-y-3 rounded-lg border border-surface-border p-3">
        {/* Validity */}
        <div className="flex items-center gap-2">
          <span className={`tag ${LEVEL_STYLE[validity.level]}`}>{LEVEL_LABEL[validity.level]}</span>
          <span className="text-[11px] text-gray-500">heuristic check — your judgement still applies</span>
        </div>
        <ul className="space-y-0.5">
          {validity.notes.map((n, i) => (
            <li key={i} className={`text-[11px] ${n.kind === "good" ? "text-brand" : "text-sev-med"}`}>
              {n.kind === "good" ? "✓" : "!"} {n.text}
            </li>
          ))}
        </ul>

        {/* Format toggle */}
        <div className="flex items-center gap-2 text-xs">
          <div className="inline-flex overflow-hidden rounded-md border border-surface-border">
            <button
              type="button"
              onClick={() => setFormat("human")}
              className={`px-2.5 py-1 ${format === "human" ? "bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
            >
              Human (send this)
            </button>
            <button
              type="button"
              onClick={() => setFormat("structured")}
              className={`px-2.5 py-1 ${format === "structured" ? "bg-brand/15 text-brand-glow" : "text-gray-400 hover:text-gray-200"}`}
            >
              Structured
            </button>
          </div>
          <button type="button" onClick={copy} className="btn-ghost px-2 py-1">
            {copied ? "Copied ✓" : "Copy"}
          </button>
          {submit && (
            <a
              href={submit}
              target="_blank"
              rel="noopener noreferrer"
              onClick={copyAndGo}
              title="Copies the human draft and opens the submit page"
              className="btn-primary px-2 py-1"
            >
              Copy + Submit ↗
            </a>
          )}
        </div>

        {/* Before-you-submit reminders (platforms don't allow silent API submit). */}
        <details>
          <summary className="cursor-pointer text-[11px] text-gray-500 hover:text-brand">
            Before you submit
          </summary>
          <ul className="mt-1 space-y-0.5">
            {hints.map((h, i) => (
              <li key={i} className="text-[11px] text-gray-400">
                • {h}
              </li>
            ))}
          </ul>
        </details>

        <textarea
          readOnly
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          className="h-64 w-full resize-y rounded-lg border border-surface-border bg-black/40 p-2 font-mono text-[11px] leading-relaxed text-gray-300 outline-none"
        />
        <p className="text-[10px] text-gray-600">
          The human version is written to read naturally — review it, tweak anything
          that doesn&apos;t sound like you, then submit.
        </p>
      </div>
    </details>
  );
}
