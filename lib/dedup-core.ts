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
 * Stable signature for a finding: `${vulnClass}|${titleKey}|${host}`. Same issue
 * on the same host from any tool → same signature. Different hosts stay separate
 * (they're different assets). Falls back to the exact lowercased title when the
 * normalizer can't derive a stable key, so we never over-merge distinct issues.
 */
export function findingSignature(
  f: { title: string; description?: string | null },
  fallbackHost = "",
): string {
  const sig = signatureOf(f);
  const host = hostFromTitle(f.title) || fallbackHost.toLowerCase();
  const key = sig.titleKey || f.title.toLowerCase().trim();
  return `${sig.vulnClass}|${key}|${host}`;
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
