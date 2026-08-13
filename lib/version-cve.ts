// Version-applicability core — pure, no DB/IO. Decides whether a DETECTED
// software version is actually in a CVE's affected range, so the engine can
// DISMISS findings for versions that are already patched (the #1 source of
// stale false positives). Also a light semver-ish comparator. Unit-testable.

/** Compare two dotted versions. Returns -1 (a<b), 0 (equal), 1 (a>b). Non-numeric
 * segments compare lexically; missing segments count as 0. Ignores a leading v
 * and any build/pre-release suffix after '-' or '+'. */
export function cmpVersions(a: string, b: string): number {
  const norm = (s: string) =>
    s.trim().replace(/^v/i, "").split(/[-+]/)[0].split(".");
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const na = Number(sa);
    const nb = Number(sb);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

export type Constraint = { op: "<" | "<=" | ">" | ">=" | "="; version: string };

const VERSION_RE = /\d+(?:\.\d+){1,3}/;

/**
 * Pull affected/fixed-version constraints out of finding text. Handles the common
 * phrasings scanners/advisories use:
 *   "fixed in 2.4.55", "patched in 1.2.3", "before 2.4.55", "prior to X",
 *   "< 2.4.55", "<= 2.4.54", "affected: <= 1.0", "up to (including) 3.2".
 * "fixed/patched/before/prior to X" all mean: affected is `< X`.
 */
export function parseConstraints(text: string): Constraint[] {
  const out: Constraint[] = [];
  const push = (op: Constraint["op"], v?: string) => {
    if (v && VERSION_RE.test(v)) out.push({ op, version: v.match(VERSION_RE)![0] });
  };
  // fixed/patched/resolved in X  → affected < X
  for (const m of text.matchAll(/(?:fixed|patched|resolved|remediat\w+)\s+in\s+v?([\d.]+)/gi)) push("<", m[1]);
  // before / prior to X → affected < X
  for (const m of text.matchAll(/(?:before|prior to|earlier than|older than)\s+v?([\d.]+)/gi)) push("<", m[1]);
  // up to (and including) X → affected <= X
  for (const m of text.matchAll(/up to(?:\s+and)?(?:\s+including)?\s+v?([\d.]+)/gi)) push("<=", m[1]);
  // explicit operators: < X, <= X, >= X, > X
  for (const m of text.matchAll(/([<>]=?)\s*v?([\d.]+)/g)) push(m[1] as Constraint["op"], m[2]);
  return out;
}

function satisfies(detected: string, c: Constraint): boolean {
  const r = cmpVersions(detected, c.version);
  switch (c.op) {
    case "<": return r < 0;
    case "<=": return r <= 0;
    case ">": return r > 0;
    case ">=": return r >= 0;
    case "=": return r === 0;
  }
}

/**
 * Is the detected version affected, given constraints?
 *   true  = in the affected range (still vulnerable)
 *   false = NOT affected (already patched → dismiss the finding)
 *   null  = can't tell (no usable constraints)
 * When multiple constraints exist they must ALL hold (an AND range, e.g.
 * ">= 1.0" AND "< 1.2").
 */
export function versionAffected(detected: string, constraints: Constraint[]): boolean | null {
  if (!VERSION_RE.test(detected) || constraints.length === 0) return null;
  const v = detected.match(VERSION_RE)![0];
  return constraints.every((c) => satisfies(v, c));
}

/** Extract the first product-version pair from finding text (e.g. "Apache 2.4.49"). */
export function extractVersion(text: string): string | null {
  // The DETECTED (installed/banner) version — distinct from the CVE's fixed/
  // affected version. Grabbing the wrong token flips a real finding to "patched"
  // and silently drops it (a false-negative in the FP-reduction path). So before
  // taking the first version, remove tokens that are NOT the detected version:
  //   • URLs (a version in a docs/asset link, e.g. ".../2.4.55/")
  //   • versions inside a "fixed in / before / < X" constraint clause (that's the
  //     advisory's fixed/affected version).
  // Banner versions like "Apache/2.4.41" (no scheme, no constraint word) survive.
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(
      /\b(?:fixed(?:\s+in)?|patched(?:\s+in)?|resolved\s+in|before|prior\s+to|earlier\s+than|up\s+to(?:\s+and\s+including)?|through|affected)\s+v?\d+(?:\.\d+){1,3}/gi,
      " ",
    )
    .replace(/[<>]=?\s*v?\d+(?:\.\d+){1,3}/g, " ")
    .replace(/(?:^|[\s(])=\s*v?\d+(?:\.\d+){1,3}/g, " ");
  return cleaned.match(VERSION_RE)?.[0] ?? null;
}
