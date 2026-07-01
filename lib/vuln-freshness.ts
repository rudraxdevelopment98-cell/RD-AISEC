// Vulnerability freshness engine — pure, no DB/IO. Kills the #1 false-positive
// class: stale version-banner matches to old, already-patched CVEs. The rule is
// a principle, not a list that itself goes stale:
//   • a check that actually fired against the LIVE target is current (any age);
//   • a CVE matched only by version/banner is NOT proof — backported patches keep
//     the old version string, so it must be validated;
//   • if the finding text carries affected/fixed-version info and the detected
//     version is out of range, it is already patched → dismiss it.
// This is what makes the engine track real, current, exploitable issues instead
// of years-old solved ones.

import { classifyConfidence } from "./exploit-confidence";
import { parseConstraints, versionAffected, extractVersion } from "./version-cve";

export type FreshnessVerdict = "current" | "verify" | "patched";

export type Freshness = {
  verdict: FreshnessVerdict;
  reason: string;
  cve?: string;
  ageYears?: number;
};

const CVE_RE = /\bCVE-(\d{4})-\d{3,7}\b/i;

export function assessFreshness(input: {
  title: string;
  description?: string | null;
  evidence?: string | null;
  confirmedFlag?: boolean | null;
}): Freshness {
  const text = `${input.title}\n${input.description ?? ""}\n${input.evidence ?? ""}`;
  const cveM = text.match(CVE_RE);
  const cve = cveM?.[0]?.toUpperCase();
  const ageYears = cveM ? new Date().getFullYear() - Number(cveM[1]) : undefined;

  // Live validation trumps everything — a check that actually demonstrated the
  // issue on the target is current regardless of the CVE's age.
  if (classifyConfidence(input).level !== "reported") {
    return { verdict: "current", reason: "validated against the live target", cve, ageYears };
  }

  // Version applicability: if affected/fixed-version info is present and the
  // detected version is out of range, it's already patched → dismiss.
  const detected = extractVersion(text);
  const constraints = parseConstraints(text);
  if (detected && constraints.length > 0 && versionAffected(detected, constraints) === false) {
    return {
      verdict: "patched",
      reason: `detected version ${detected} is outside the affected range — already patched`,
      cve,
      ageYears,
    };
  }

  // A CVE matched only by version/banner, not confirmed on the live target — the
  // stale false-positive case.
  if (cve) {
    return {
      verdict: "verify",
      reason:
        `matched ${cve} by version/banner only — not confirmed on the live target` +
        (ageYears && ageYears >= 2 ? ` (${ageYears}-yr-old CVE; likely patched via backport)` : "") +
        ". Validate before trusting.",
      cve,
      ageYears,
    };
  }

  return { verdict: "current", reason: "no stale-version signal", cve, ageYears };
}
