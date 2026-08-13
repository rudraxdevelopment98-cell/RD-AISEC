// Maps a white-box source-recon HYPOTHESIS (from lib/source-recon-core) to the
// concrete dynamic check that would PROVE it on the live target — the engine's
// "validate this hypothesis" one-click. A source hypothesis has no target of its
// own (it's `File: app/x.py:42`), so the matching check runs against the
// engagement's in-scope host. Pure + unit-tested; the server action wires it up.

export type HypothesisClass =
  | "rce"
  | "injection"
  | "ssrf"
  | "path-traversal"
  | "xss"
  | "crypto"
  | "auth"
  | "secrets"
  | "deserialization";

export type ValidationCheck = {
  tool: string;
  mode: "url" | "host";
  // Build the tool args for a given filled target (url or host already chosen).
  args: (target: string) => string;
  // One-line note explaining what a hit proves — surfaced on the finding.
  proves: string;
};

// The dynamic check per hypothesis class. Everything here is non-destructive
// (detection/validation tier) — the safe first proof step, not weaponization.
const CHECKS: Record<HypothesisClass, ValidationCheck> = {
  injection: {
    tool: "sqlmap",
    mode: "url",
    args: (u) => `-u "${u}" --batch --level=2 --risk=2`,
    proves: "sqlmap confirms an injectable parameter + names the DBMS.",
  },
  xss: {
    tool: "dalfox",
    mode: "url",
    args: (u) => `url "${u}" --silence --no-spinner`,
    proves: "dalfox verifies a payload reflects and would execute.",
  },
  ssrf: {
    tool: "nuclei",
    mode: "url",
    args: (u) => `-u ${u} -tags ssrf -rl 120 -timeout 8 -jsonl`,
    proves: "a nuclei SSRF template fires against the live endpoint.",
  },
  "path-traversal": {
    tool: "nuclei",
    mode: "url",
    args: (u) => `-u ${u} -tags lfi,traversal -rl 120 -timeout 8 -jsonl`,
    proves: "a nuclei LFI/traversal template reads a file it shouldn't.",
  },
  rce: {
    tool: "nuclei",
    mode: "url",
    args: (u) => `-u ${u} -tags rce,injection -severity high,critical -rl 120 -timeout 8 -jsonl`,
    proves: "a nuclei RCE/injection template matches on the live target.",
  },
  deserialization: {
    tool: "nuclei",
    mode: "url",
    args: (u) => `-u ${u} -tags deserialization -rl 120 -timeout 8 -jsonl`,
    proves: "a nuclei deserialization template matches on the live target.",
  },
  auth: {
    tool: "nuclei",
    mode: "url",
    args: (u) => `-u ${u} -tags auth,default-login,exposure -rl 120 -timeout 8 -jsonl`,
    proves: "a nuclei auth/default-login template finds the weakness live.",
  },
  secrets: {
    tool: "nuclei",
    mode: "url",
    args: (u) => `-u ${u} -tags exposure,exposures,secret,config -rl 120 -timeout 8 -jsonl`,
    proves: "the hard-coded secret is actually exposed/served at runtime.",
  },
  crypto: {
    tool: "sslscan",
    mode: "host",
    args: () => "",
    proves: "sslscan confirms the weak protocol/cipher is negotiated live.",
  },
};

/** The dynamic check for a hypothesis class, or null if none applies. */
export function checkForClass(cls: string | null | undefined): ValidationCheck | null {
  if (!cls) return null;
  return CHECKS[cls as HypothesisClass] ?? null;
}

const WHITEBOX_TITLE = /\[white-?box\][\s\S]*?possible\s+([a-z-]+)\s+in\b/i;
const CLASS_ALIASES: Record<string, HypothesisClass> = {
  rce: "rce",
  injection: "injection",
  sqli: "injection",
  sql: "injection",
  ssrf: "ssrf",
  "path-traversal": "path-traversal",
  lfi: "path-traversal",
  traversal: "path-traversal",
  xss: "xss",
  crypto: "crypto",
  auth: "auth",
  secrets: "secrets",
  secret: "secrets",
  deserialization: "deserialization",
  deser: "deserialization",
};

/**
 * Recover the hypothesis class from a white-box finding. Reads the
 * "[white-box] Possible <class> in <file>" title first, then falls back to any
 * known class token in the title/description. Returns null if it isn't a
 * recognizable white-box hypothesis.
 */
export function hypothesisClassOf(finding: { title?: string | null; description?: string | null }): HypothesisClass | null {
  const title = finding.title ?? "";
  const m = title.match(WHITEBOX_TITLE);
  if (m) {
    const raw = m[1].toLowerCase();
    if (CLASS_ALIASES[raw]) return CLASS_ALIASES[raw];
  }
  // Fallback: scan title + description for a class token (only for white-box findings).
  const text = `${title}\n${finding.description ?? ""}`.toLowerCase();
  if (!/\[white-?box\]/.test(text)) return null;
  for (const [token, cls] of Object.entries(CLASS_ALIASES)) {
    if (new RegExp(`\\b${token}\\b`).test(text)) return cls;
  }
  return null;
}

/** True when this finding is a white-box source hypothesis we can auto-validate. */
export function isValidatableHypothesis(finding: { title?: string | null; description?: string | null }): boolean {
  const cls = hypothesisClassOf(finding);
  return !!cls && !!CHECKS[cls];
}
