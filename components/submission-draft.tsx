"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

/**
 * One-click, copy-ready bug-report writeup for a finding (HackerOne/Bugcrowd
 * style). Deterministic — built from the finding's own data, no AI.
 */
export function SubmissionDraft({
  title,
  severity,
  description,
  recommendation,
  engagement,
  attackLabel,
  owaspLabel,
}: {
  title: string;
  severity: string;
  description: string;
  recommendation: string;
  engagement?: string | null;
  attackLabel?: string | null;
  owaspLabel?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const md = [
    `# ${title}`,
    ``,
    `**Severity:** ${severity.toUpperCase()}`,
    engagement ? `**Program / engagement:** ${engagement}` : "",
    owaspLabel ? `**OWASP:** ${owaspLabel}` : "",
    attackLabel ? `**MITRE ATT&CK:** ${attackLabel}` : "",
    ``,
    `## Summary`,
    description || "—",
    ``,
    `## Steps to Reproduce`,
    `1. Identify the affected asset described above.`,
    `2. Reproduce the condition shown in the summary (validated by automated testing).`,
    `3. Observe the impact described below.`,
    ``,
    `## Impact`,
    `An attacker could exploit this ${severity}-severity issue against the affected asset, as evidenced above.`,
    ``,
    `## Remediation`,
    recommendation || "Patch/upgrade the affected component and re-test.",
    ``,
    `---`,
    `_Prepared with RD-AISEC._`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(md);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="btn-ghost px-2 py-1 text-xs"
      title="Copy a submission-ready bug report"
    >
      <Icon name={copied ? "check" : "copy"} className="h-3 w-3" />
      {copied ? "Copied" : "Copy bug report"}
    </button>
  );
}
