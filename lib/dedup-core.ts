// Finding de-duplication + cross-tool corroboration — pure core (no DB/IO).
//
// The old dedup was exact-title only, so "Weak TLS ciphers on a.com (3)" and
// "…on a.com (7)", or the same header issue from nikto vs the header scan, all
// became separate findings. This derives a stable SIGNATURE (vuln class +
// normalized title + host) — reusing the same normalization the suppression
// engine uses — so near-duplicates collapse into one finding, and every tool
// that independently found it is recorded (corroboration), not thrown away.

import { signatureOf, hostFromTitle } from "./suppression-core";

/**
 * A distinguishing token that MUST keep otherwise-similar findings apart: a CVE
 * id, or a version number in the title. Without it the normalized titleKey (which
 * strips CVEs/versions to merge "(3)" vs "(7)" counts) would collapse two DIFFERENT
 * bugs — e.g. "Apache 2.4.49 (CVE-2021-41773)" and "Apache 2.4.50 (CVE-2021-42013)"
 * — into one and silently drop the second real, payable finding.
 */
function discriminator(f: { title: string; description?: string | null }): string {
  const text = `${f.title}\n${f.description ?? ""}`;
  const cve = text.match(/cve-\d{4}-\d{3,7}/i);
  if (cve) return cve[0].toLowerCase();
  const ver = f.title.match(/\b\d+\.\d[\d.]*\b/); // e.g. "2.4.49", "1.0"
  return ver ? ver[0] : "";
}

/**
 * Stable signature for a finding: `${vulnClass}|${titleKey}|${disc}|${host}`. Same
 * issue on the same host from any tool → same signature. Different hosts — or a
 * different CVE/version (disc) — stay separate. Falls back to the exact lowercased
 * title when the normalizer can't derive a stable key, so we never over-merge.
 */
export function findingSignature(
  f: { title: string; description?: string | null },
  fallbackHost = "",
): string {
  const sig = signatureOf(f);
  const host = hostFromTitle(f.title) || fallbackHost.toLowerCase();
  // UNCLASSIFIED findings (vulnClass === "") — e.g. open ports, banners — must NOT
  // use the normalized titleKey: it strips port numbers and the "(service)"
  // parenthetical, so "Open port 22/tcp (ssh)", "…80/tcp (http)", "…443/tcp" would
  // all collapse to one finding and every port but the first would be silently
  // dropped. Use a number-preserving key so distinct ports/services stay distinct.
  // Classified findings keep the normalized key (so "(3)" vs "(7)" counts merge)
  // PLUS a CVE/version discriminator so distinct CVEs on one host stay distinct.
  if (!sig.vulnClass) {
    const key = f.title.toLowerCase().replace(/\s+/g, " ").trim();
    return `|${key}|${host}`;
  }
  const key = sig.titleKey || f.title.toLowerCase().trim();
  return `${sig.vulnClass}|${key}|${discriminator(f)}|${host}`;
}

/** Merge a tool id into a comma-joined source list (deduped, stable order). */
export function mergeSources(existing: string, tool: string): string {
  const set = new Set((existing || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (tool) set.add(tool);
  return [...set].sort().join(",");
}

/** How many distinct tools corroborated a finding. */
export function sourceCount(sources: string | null | undefined): number {
  return (sources || "").split(",").map((s) => s.trim()).filter(Boolean).length;
}

export type DedupExisting = { id: string; title: string; description?: string | null; sources: string };
export type DedupResult<T> = {
  fresh: (T & { sources: string })[]; // new findings to create (with source = tool)
  merges: { id: string; sources: string }[]; // existing findings to update (corroborated)
};

/**
 * Partition parsed candidates against existing findings by signature:
 *  - a candidate matching an existing finding → record it as a corroboration
 *    (add `tool` to that finding's sources) instead of creating a duplicate;
 *  - a candidate matching an EARLIER candidate in the same batch → also merged
 *    (so one scan emitting the same issue twice yields one finding);
 *  - otherwise it's fresh, tagged with `tool` as its first source.
 */
export function dedupFindings<T extends { title: string; description?: string | null }>(
  candidates: T[],
  existing: DedupExisting[],
  tool: string,
  host = "",
): DedupResult<T> {
  const bySig = new Map<string, { id: string; sources: string }>();
  for (const e of existing) bySig.set(findingSignature(e, host), { id: e.id, sources: e.sources });

  const fresh: (T & { sources: string })[] = [];
  const mergeMap = new Map<string, string>(); // existing id -> new source list

  for (const c of candidates) {
    const sig = findingSignature(c, host);
    const hit = bySig.get(sig);
    if (hit && hit.id !== "__batch__") {
      // Corroborates an existing finding — merge the tool into its sources.
      const base = mergeMap.get(hit.id) ?? hit.sources;
      const merged = mergeSources(base, tool);
      if (merged !== hit.sources) mergeMap.set(hit.id, merged);
    } else if (hit && hit.id === "__batch__") {
      // Duplicate within this same batch — already going to be created; skip.
      continue;
    } else {
      fresh.push({ ...c, sources: tool });
      bySig.set(sig, { id: "__batch__", sources: tool });
    }
  }

  return { fresh, merges: [...mergeMap.entries()].map(([id, sources]) => ({ id, sources })) };
}
