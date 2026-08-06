// Attack-chain correlation — turn findings that COMBINE into real risk.
//
// Two lows that individually look boring can, on the same asset, form a real
// attack path (SSRF + exposed secrets → cloud takeover; default creds + a shell
// primitive → RCE). Today that only shows as a display-only flag. This computes a
// concrete RISK BOOST per finding so a genuine chain rises in triage, and a short
// chain label. Pure (no IO), unit-tested.

import { classifyFindingVuln } from "@/lib/vuln-taxonomy";
import { extractAsset, type FindingLike } from "@/lib/assessment";

// Classes that GAIN access/execution vs classes that ESCALATE/IMPACT. A chain is
// interesting when both kinds land on one asset. (Mirrors engine-core's sets.)
const ACCESS = new Set(["rce", "sqli", "ssti", "deserialization", "file_upload", "lfi", "auth_bypass", "default_creds", "legacy_smb", "xxe"]);
const IMPACT = new Set(["idor", "ato", "ssrf", "secrets", "info_disclosure", "subdomain_takeover", "stored_xss"]);

// Named escalation combos → a specific label + a bigger boost when BOTH classes
// appear on the same asset. Ordered most-severe first; first match wins per asset.
const KNOWN: { need: string[]; label: string; boost: number }[] = [
  { need: ["file_upload", "rce"], label: "File upload → code execution", boost: 30 },
  { need: ["default_creds", "rce"], label: "Default creds → code execution", boost: 30 },
  { need: ["sqli", "secrets"], label: "SQLi → credential dump", boost: 28 },
  { need: ["ssrf", "secrets"], label: "SSRF → credential/secret exposure", boost: 28 },
  { need: ["lfi", "secrets"], label: "LFI → secret/credential read", boost: 26 },
  { need: ["auth_bypass", "idor"], label: "Auth bypass → unauthorized data access", boost: 26 },
  { need: ["subdomain_takeover", "ato"], label: "Subdomain takeover → account takeover", boost: 26 },
  { need: ["ssrf", "info_disclosure"], label: "SSRF → internal info disclosure", boost: 22 },
];

export type ChainFinding = FindingLike & { id: string; severity: string };
export type ChainResult = { id: string; boost: number; label: string };

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function classIdOf(f: ChainFinding): string | null {
  return classifyFindingVuln({ title: f.title, description: f.description })?.id ?? null;
}

/**
 * Correlate findings into attack chains and return a per-finding risk boost + a
 * chain label for every finding that participates in a chain. Only findings in a
 * chain appear in the result; the highest boost wins if a finding is in several.
 */
export function correlateChains(findings: ChainFinding[]): ChainResult[] {
  const byAsset = new Map<string, { f: ChainFinding; cls: string | null }[]>();
  for (const f of findings) {
    const asset = extractAsset({ ...f, description: f.description ?? "" });
    if (!asset || asset === "unspecified") continue;
    const arr = byAsset.get(asset) ?? [];
    arr.push({ f, cls: classIdOf(f) });
    byAsset.set(asset, arr);
  }

  const out = new Map<string, ChainResult>();
  const bump = (id: string, boost: number, label: string) => {
    const cur = out.get(id);
    if (!cur || boost > cur.boost) out.set(id, { id, boost, label });
  };

  for (const [asset, items] of byAsset) {
    const classes = new Set(items.map((i) => i.cls).filter(Boolean) as string[]);

    // 1) Named combos — specific label, biggest boost. First match wins.
    const combo = KNOWN.find((k) => k.need.every((n) => classes.has(n)));
    if (combo) {
      for (const i of items) if (i.cls && combo.need.includes(i.cls)) bump(i.f.id, combo.boost, combo.label);
      continue;
    }

    // 2) Generic access + impact co-occurrence on one asset.
    const hasA = [...classes].some((c) => ACCESS.has(c));
    const hasI = [...classes].some((c) => IMPACT.has(c));
    if (hasA && hasI) {
      for (const i of items) {
        if (i.cls && (ACCESS.has(i.cls) || IMPACT.has(i.cls))) {
          bump(i.f.id, 18, "Chainable: access + impact on one asset");
        }
      }
      continue;
    }

    // 3) Many issues stacking on one asset — modest boost to the worst one.
    if (items.length >= 3) {
      const top = [...items].sort((a, b) => (SEV_RANK[a.f.severity] ?? 9) - (SEV_RANK[b.f.severity] ?? 9))[0];
      bump(top.f.id, 8, `${items.length} issues stack on ${asset}`);
    }
  }

  return [...out.values()];
}
