// MCP security scanner — a TypeScript port of the Shiva scanner (shiva/scanner)
// so the portal's Shiva dashboard can run the same checks live in the browser.
// Pure, no deps, unit-testable. Mirrors checks.py / patterns.py.

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export const SEV_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
export function sevMax(a: Severity, b: Severity): Severity {
  return SEV_RANK[a] >= SEV_RANK[b] ? a : b;
}

export type McpParam = {
  name: string;
  type?: string;
  // Enriched from the JSON schema when present — powers the over-broad-scope check.
  default?: string; // stringified default value, if the schema declares one
  constrained?: boolean; // schema has enum / pattern / format (i.e. the value is bounded)
  description?: string;
};
export type McpTool = {
  name: string;
  description?: string;
  params?: McpParam[];
  descriptionDynamic?: boolean;
  // Optional sample of what this tool RETURNS — lets the scanner check for indirect
  // prompt injection carried in tool results (C8), not just in descriptions (C1).
  sampleResult?: string;
};
export type McpTarget = { name?: string; tools: McpTool[] };

export type Finding = {
  check: string;
  severity: Severity;
  tool: string; // "" = server-level
  title: string;
  detail?: string;
  evidence?: string;
  recommendation?: string;
};

// --- C1: hidden / imperative instructions in a description -------------------
const INSTRUCTION_PATTERNS: { re: RegExp; weight: number; label: string }[] = [
  { re: /<\s*important\s*>/i, weight: 3, label: "<IMPORTANT> instruction block" },
  { re: /<\s*system\s*>/i, weight: 3, label: "<system> instruction block" },
  { re: /<!--[\s\S]*?-->/, weight: 2, label: "HTML comment hiding text" },
  { re: /\[\s*(system|instruction)s?\s*\]/i, weight: 2, label: "[system]/[instructions] marker" },
  { re: /\byou must\b/i, weight: 2, label: "imperative 'you must'" },
  { re: /\b(before|prior to) (answering|responding|replying)\b/i, weight: 3, label: "pre-answer directive" },
  { re: /\b(always|first|immediately) call\b/i, weight: 2, label: "directive to call a tool" },
  { re: /\bignore (the |all |any )?(previous|above|prior)\b/i, weight: 3, label: "instruction to ignore prior context" },
  { re: /\bas an ai\b/i, weight: 1, label: "role-spoofing phrase" },
  { re: /\bdo not (mention|tell|reveal|say|disclose)\b/i, weight: 3, label: "secrecy instruction" },
  { re: /\b(don't|do not) (let|inform) the user\b/i, weight: 3, label: "hide-from-user instruction" },
  { re: /\bwithout (telling|informing|notifying)\b/i, weight: 3, label: "covert-action instruction" },
  { re: /\bsilently\b/i, weight: 2, label: "covert-action phrase" },
  { re: /\b(append|include|add) (its |the )?(contents|output|result)\b/i, weight: 2, label: "instruction to append other data to the reply" },
  { re: /\bcall (read_file|run_command|exec|the \w+ tool)\b/i, weight: 2, label: "names another tool to invoke" },
];
const BASE64_BLOB = /[A-Za-z0-9+/]{40,}={0,2}/;
// zero-width / bidi / BOM characters used to hide injected text
const INVISIBLE = /[​-‏‪-‮⁠﻿]/;

// --- C2 / C3: capability inference ------------------------------------------
const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  fs_read: ["read_file", "readfile", "read", "cat", "open", "load", "get_file", "file_get"],
  fs_write: ["write", "save", "put_file", "edit", "append_file", "create_file"],
  fs_delete: ["delete", "remove", "rm", "unlink", "rmdir"],
  exec: ["run_command", "exec", "execute", "shell", "system", "subprocess", "command", "bash", "sh", "eval", "spawn", "popen"],
  network: ["fetch", "http", "https", "request", "curl", "url", "download", "upload", "webhook", "post", "send", "get_url", "browse"],
  secrets: ["env", "getenv", "secret", "token", "credential", "password", "apikey", "api_key", "private_key", "ssh_key"],
  database: ["sql", "query", "db_", "database", "psql", "mysql", "mongo"],
};
const CAPABILITY_RISK: Record<string, { label: string; sev: Severity }> = {
  exec: { label: "arbitrary command / code execution", sev: "critical" },
  fs_delete: { label: "file deletion", sev: "high" },
  fs_write: { label: "arbitrary file write", sev: "high" },
  secrets: { label: "access to secrets / credentials / environment", sev: "high" },
  database: { label: "direct database access", sev: "medium" },
  fs_read: { label: "arbitrary file read", sev: "low" },
  network: { label: "outbound network access", sev: "low" },
};
const UNCONSTRAINED_PARAMS: Record<string, string[]> = {
  fs_read: ["path", "file", "filename", "filepath"],
  fs_write: ["path", "file", "filename", "filepath"],
  fs_delete: ["path", "file", "filename", "filepath"],
  exec: ["command", "cmd", "code", "script", "args"],
  network: ["url", "uri", "host", "endpoint", "address"],
};
const DANGEROUS_COMBOS: [string, string, Severity, string][] = [
  ["secrets", "network", "critical", "a tool can read secrets and another can send data out — classic exfiltration path"],
  ["fs_read", "network", "high", "file-read + outbound network: file contents can be exfiltrated"],
  ["network", "exec", "high", "fetched (untrusted) content + command execution: cross-tool escalation surface"],
  ["fs_read", "exec", "high", "file-read + execution: read-then-run host control surface"],
  ["fs_write", "exec", "high", "file-write + execution: drop-and-run host control surface"],
];

export function inferCapabilities(tool: McpTool): Set<string> {
  const hay = [tool.name.toLowerCase(), ...(tool.params ?? []).map((p) => p.name.toLowerCase())];
  const caps = new Set<string>();
  for (const [cap, kws] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (kws.some((kw) => hay.some((tok) => tok === kw || tok.includes(kw)))) caps.add(cap);
  }
  return caps;
}

function sevFromScore(score: number): Severity {
  if (score >= 6) return "critical";
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function escalate(sev: Severity): Severity {
  const order: Severity[] = ["info", "low", "medium", "high", "critical"];
  return order[Math.min(SEV_RANK[sev] + 1, 4)];
}

export function checkHiddenInstructions(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  for (const tool of target.tools) {
    const desc = tool.description ?? "";
    if (!desc.trim()) continue;
    let score = 0;
    const hits: string[] = [];
    for (const p of INSTRUCTION_PATTERNS) {
      if (p.re.test(desc)) {
        score += p.weight;
        hits.push(p.label);
      }
    }
    if (BASE64_BLOB.test(desc)) {
      score += 2;
      hits.push("long encoded blob");
    }
    if (INVISIBLE.test(desc)) {
      score += 3;
      hits.push("invisible/zero-width characters");
    }
    if (hits.length === 0) continue;
    const snippet = desc.replace(/\s+/g, " ").slice(0, 140);
    out.push({
      check: "C1-hidden-instructions",
      severity: sevFromScore(score),
      tool: tool.name,
      title: "Tool description contains hidden or imperative instructions",
      detail:
        "A tool description is metadata the user rarely sees but the model treats as trusted context. This one steers the model rather than describing the tool — the hallmark of tool poisoning.",
      evidence: `${Array.from(new Set(hits)).sort().join("; ")} — “${snippet}…”`,
      recommendation:
        "Treat tool descriptions as untrusted. Strip markup/comments, reject imperative or secrecy language, and pin the description to a reviewed baseline.",
    });
  }
  return out;
}

export function checkBroadPermissions(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  for (const tool of target.tools) {
    const caps = inferCapabilities(tool);
    for (const cap of caps) {
      const risk = CAPABILITY_RISK[cap];
      if (!risk) continue;
      let sev = risk.sev;
      const unconstrained = (tool.params ?? [])
        .map((p) => p.name.toLowerCase())
        .filter((n) => (UNCONSTRAINED_PARAMS[cap] ?? []).includes(n));
      let evidence = `capability inferred from name/params: ${cap}`;
      if (unconstrained.length) {
        sev = escalate(sev);
        evidence += `; unconstrained param(s): ${unconstrained.join(", ")}`;
      }
      out.push({
        check: "C2-broad-permissions",
        severity: sev,
        tool: tool.name,
        title: `Tool exposes ${risk.label}`,
        detail:
          "This tool grants a powerful capability. On its own that may be legitimate, but it widens blast radius if the agent is tricked into calling it.",
        evidence,
        recommendation:
          "Constrain the capability: validate/allowlist arguments (paths, hosts, commands), drop unused tools, and require human approval for high-impact calls.",
      });
    }
  }
  return out;
}

export function checkDangerousCombos(target: McpTarget): Finding[] {
  const providers: Record<string, string[]> = {};
  for (const tool of target.tools) {
    for (const cap of inferCapabilities(tool)) {
      (providers[cap] ??= []).push(tool.name);
    }
  }
  const out: Finding[] = [];
  for (const [a, b, sev, why] of DANGEROUS_COMBOS) {
    if (providers[a] && providers[b]) {
      out.push({
        check: "C3-dangerous-combo",
        severity: sev,
        tool: "",
        title: `Dangerous capability combination: ${a} + ${b}`,
        detail: why,
        evidence: `${a}: [${Array.from(new Set(providers[a])).join(", ")}] + ${b}: [${Array.from(new Set(providers[b])).join(", ")}]`,
        recommendation:
          "Separate these capabilities across trust boundaries, or gate the chain (never let fetched/file content flow into an exec or network-send tool unattended).",
      });
    }
  }
  return out;
}

// --- C5: tool shadowing / look-alike names -----------------------------------
// A malicious MCP server can register a tool whose name collides with — or looks
// confusingly like — a trusted tool, so the agent calls the impostor (tool
// shadowing / namespace confusion). Catch exact duplicates and near-duplicates.
function normalizeName(n: string): string {
  return n.toLowerCase().replace(/[\s_\-.]/g, "");
}
function levenshtein1(a: string, b: string): boolean {
  if (a === b) return false;
  const dl = Math.abs(a.length - b.length);
  if (dl > 1) return false;
  // count edits with an early bail at >1
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  if (i < a.length || j < b.length) edits++;
  return edits === 1;
}

export function checkToolShadowing(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  const tools = target.tools;
  const reported = new Set<string>();
  for (let i = 0; i < tools.length; i++) {
    for (let k = i + 1; k < tools.length; k++) {
      const a = tools[i].name, b = tools[k].name;
      if (!a || !b) continue;
      const na = normalizeName(a), nb = normalizeName(b);
      const dup = a === b;
      const collide = !dup && na === nb; // differ only by case/_/-/./space
      // High precision: a single-character edit on the normalized name (e.g.
      // read_file vs read_fi1e). Substring matches are intentionally NOT flagged
      // — get vs get_weather is normal, not shadowing.
      const lookAlike = !dup && !collide && levenshtein1(na, nb);
      if (!dup && !collide && !lookAlike) continue;
      const key = [a, b].sort().join("|");
      if (reported.has(key)) continue;
      reported.add(key);
      out.push({
        check: "C5-tool-shadowing",
        severity: dup || collide ? "high" : "medium",
        tool: b,
        title: dup
          ? `Duplicate tool name: ${a}`
          : `Tool name shadows another: ${b} vs ${a}`,
        detail:
          "Two tools share — or nearly share — a name. A malicious or careless server can register a look-alike that the agent calls instead of the trusted tool (tool shadowing / namespace confusion).",
        evidence: `${a}  ~  ${b}`,
        recommendation:
          "Namespace tools per server, reject duplicate/again-similar names at registration, and pin which server owns each tool name.",
      });
    }
  }
  return out;
}

export function checkDriftRisk(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  for (const tool of target.tools) {
    if (tool.descriptionDynamic) {
      out.push({
        check: "C4-drift-risk",
        severity: "high",
        tool: tool.name,
        title: "Tool description is computed at runtime (drift risk)",
        detail:
          "The description is not a fixed literal; the server can change it after the user approves the tool — the rug-pull / description-drift vector.",
        evidence: "non-literal description",
        recommendation: "Pin descriptions to reviewed static text, hash them, and re-prompt for approval on any change.",
      });
    }
  }
  return out;
}

// --- C6: over-broad scopes / roots -------------------------------------------
// A powerful tool is far more dangerous when its reach isn't bounded: a file tool
// rooted at "/" or "~", a network tool that accepts any host, a param with a broad
// default and no allowlist. Catch explicit broad roots/defaults + unconstrained
// sensitive params + description phrasing that advertises unrestricted scope.
const BROAD_ROOT = [
  /^\/$/, // filesystem root
  /^~\/?$/, // home
  /^[A-Za-z]:\\?$/, // windows drive root
  /^\/(etc|root|home|var|usr)\/?$/i,
  /^\*{1,2}$/, // * or **
  /^\.{0,2}\/?\*/, // ./* , ../* , /*
];
const BROAD_HOST = [/^\*$/, /^0\.0\.0\.0/, /\/0$/, /^any$/i, /^\*:\d+$/];
const BROAD_SCOPE_DESC =
  /\b(entire|whole|full) (file ?system|disk|drive)\b|\ball files\b|\bunrestricted\b|\bany (host|url|domain|path|file)\b|\bno (restriction|allow[- ]?list|whitelist|validation|sandbox)\b|\broot (access|directory|filesystem)\b|\barbitrary (path|host|url|file)\b|\bunsandboxed\b/i;
const PATH_PARAM = new Set(["path", "file", "filename", "filepath", "dir", "directory", "root", "cwd", "base", "basepath"]);
const HOST_PARAM = new Set(["url", "uri", "host", "endpoint", "address", "target", "origin"]);

export function checkOverbroadScope(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  for (const tool of target.tools) {
    const caps = inferCapabilities(tool);
    const sensitive = caps.has("fs_read") || caps.has("fs_write") || caps.has("fs_delete") || caps.has("exec") || caps.has("network");
    if (!sensitive) continue;
    // High-impact caps make an unbounded param dangerous on its own; a plain
    // read tool with an unconstrained path is too common to flag (C2 already
    // notes the capability) — so an unconstrained param alone is only "strong"
    // for exec/fs_write/fs_delete, or for an any-host network reach.
    const highImpact = caps.has("exec") || caps.has("fs_write") || caps.has("fs_delete");
    const hits: string[] = [];
    let sev: Severity = "medium";
    let strong = false; // at least one signal that isn't just "a read path is unbounded"

    for (const p of tool.params ?? []) {
      const name = p.name.toLowerCase();
      const def = (p.default ?? "").trim();
      const isPath = PATH_PARAM.has(name);
      const isHost = HOST_PARAM.has(name);
      if (isPath && def && BROAD_ROOT.some((re) => re.test(def))) {
        hits.push(`param "${p.name}" defaults to a broad root: "${def}"`);
        sev = sevMax(sev, "high");
        strong = true;
      }
      if (isHost && def && BROAD_HOST.some((re) => re.test(def))) {
        hits.push(`param "${p.name}" defaults to any host: "${def}"`);
        sev = sevMax(sev, "high");
        strong = true;
      }
      // A sensitive path/host param with no enum/pattern/format is unbounded.
      if ((isPath || isHost) && !p.constrained) {
        hits.push(`sensitive param "${p.name}" has no allowlist/pattern constraint`);
        // Unbounded is "strong" for a network reach (SSRF-to-anywhere) or a
        // high-impact tool (write/delete/exec) — not for a plain file read.
        if ((isHost && caps.has("network")) || highImpact) strong = true;
      }
    }
    if (BROAD_SCOPE_DESC.test(tool.description ?? "")) {
      hits.push("description advertises unrestricted scope");
      sev = sevMax(sev, caps.has("exec") ? "critical" : "high");
      strong = true;
    }
    if (hits.length === 0 || !strong) continue;
    out.push({
      check: "C6-overbroad-scope",
      severity: sev,
      tool: tool.name,
      title: "Tool scope is not bounded (over-broad root / host / params)",
      detail:
        "A capable tool with an unbounded root, any-host default, or unconstrained sensitive parameters lets a single tricked call reach far beyond its intended target — the blast-radius multiplier behind most MCP incidents.",
      evidence: Array.from(new Set(hits)).join("; "),
      recommendation:
        "Bound the tool: pin a specific root/working directory, allowlist hosts, and add enum/pattern constraints (or path canonicalization) to every sensitive parameter.",
    });
  }
  return out;
}

// --- C7: remote / unpinned tool servers --------------------------------------
// If a tool's code or content is fetched from a remote, unpinned source at call
// time, the server owner (or whoever controls that source) can change what runs
// AFTER you approved it — a supply-chain rug-pull. Flag remote-exec fetchers and
// unpinned versions in the tool name/description/params and at the server level.
const REMOTE_UNPINNED: { re: RegExp; label: string; sev: Severity }[] = [
  { re: /\bnpx\b(?!\s+--no-install)/i, label: "npx fetches & runs a remote package at call time", sev: "high" },
  { re: /\buvx?\b\s+\S/i, label: "uv/uvx runs a remote tool at call time", sev: "high" },
  { re: /curl[^\n]*\|\s*(sh|bash|python|node)\b/i, label: "curl | sh remote install/exec", sev: "high" },
  { re: /\bgit clone\b/i, label: "git clone at runtime (moving target)", sev: "high" },
  { re: /@latest\b/i, label: "@latest — unpinned package version", sev: "medium" },
  { re: /:latest\b/i, label: ":latest — unpinned container tag", sev: "medium" },
  { re: /\bpip install\b(?![^\n]*==)/i, label: "pip install without a pinned ==version", sev: "medium" },
  { re: /https?:\/\/\S+\.(sh|py|js|ts|rb)\b/i, label: "fetches a remote script by URL", sev: "high" },
  { re: /\bhttp:\/\//i, label: "insecure http:// source (no integrity/TLS)", sev: "medium" },
];

export function checkRemoteUnpinned(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  const scanText = (text: string, toolName: string) => {
    if (!text.trim()) return;
    const hits: string[] = [];
    let sev: Severity = "low";
    for (const p of REMOTE_UNPINNED) {
      if (p.re.test(text)) {
        hits.push(p.label);
        sev = sevMax(sev, p.sev);
      }
    }
    if (hits.length === 0) return;
    out.push({
      check: "C7-remote-unpinned",
      severity: sev,
      tool: toolName,
      title: toolName
        ? "Tool sources code/content from a remote or unpinned origin"
        : "Server sources code/content from a remote or unpinned origin",
      detail:
        "What runs is fetched from a remote or unpinned source at call time, so it can change after you approved it — a supply-chain rug-pull. Approval of a moving target is not real approval.",
      evidence: Array.from(new Set(hits)).join("; "),
      recommendation:
        "Pin exact versions/digests, vendor the tool locally, verify integrity (hash/signature), and re-review on any change. Avoid npx/uvx/curl|sh in tool definitions.",
    });
  };
  if (target.name) scanText(target.name, "");
  for (const tool of target.tools) {
    const paramText = (tool.params ?? []).map((p) => `${p.name} ${p.default ?? ""} ${p.description ?? ""}`).join(" ");
    scanText(`${tool.name}\n${tool.description ?? ""}\n${paramText}`, tool.name);
  }
  return out;
}

// --- C8: prompt injection in tool RESULTS (indirect injection) ----------------
// C1 catches instructions hidden in a tool's DESCRIPTION. But the higher-volume
// modern vector is indirect: a tool returns attacker-controlled content (a web
// page, a file, an issue body) carrying instructions the model then obeys. Reuse
// the C1 instruction signal on a tool's RESULT text.
export function checkResultInjection(resultText: string, toolName = ""): Finding[] {
  const text = resultText ?? "";
  if (!text.trim()) return [];
  let score = 0;
  const hits: string[] = [];
  for (const p of INSTRUCTION_PATTERNS) {
    if (p.re.test(text)) {
      score += p.weight;
      hits.push(p.label);
    }
  }
  if (BASE64_BLOB.test(text)) { score += 2; hits.push("long encoded blob"); }
  if (INVISIBLE.test(text)) { score += 3; hits.push("invisible/zero-width characters"); }
  if (hits.length === 0) return [];
  const snippet = text.replace(/\s+/g, " ").slice(0, 140);
  return [{
    check: "C8-result-injection",
    // Result injection is at least as severe as description injection (the content
    // is fully attacker-controlled), so floor it a notch higher.
    severity: escalate(sevFromScore(score)),
    tool: toolName,
    title: "Tool result carries hidden or imperative instructions (indirect prompt injection)",
    detail:
      "A tool returned content that steers the model rather than just answering. When tool output is attacker-controlled (fetched pages, files, tickets), embedded instructions become indirect prompt injection — the model may act on them as if they were the user.",
    evidence: `${Array.from(new Set(hits)).sort().join("; ")} — “${snippet}…”`,
    recommendation:
      "Treat tool results as untrusted data, never instructions. Wrap/escape returned content, strip markup & invisible characters, and require human approval before acting on tool-derived directives.",
  }];
}

// Run C8 over any tools that ship a sampleResult in the manifest.
function checkManifestResultInjection(target: McpTarget): Finding[] {
  const out: Finding[] = [];
  for (const tool of target.tools) {
    if (tool.sampleResult && tool.sampleResult.trim()) {
      out.push(...checkResultInjection(tool.sampleResult, tool.name));
    }
  }
  return out;
}

export function scan(target: McpTarget): Finding[] {
  return [
    ...checkHiddenInstructions(target),
    ...checkBroadPermissions(target),
    ...checkDangerousCombos(target),
    ...checkToolShadowing(target),
    ...checkDriftRisk(target),
    ...checkOverbroadScope(target),
    ...checkRemoteUnpinned(target),
    ...checkManifestResultInjection(target),
  ].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.check.localeCompare(b.check));
}

export function maxSeverity(findings: Finding[]): Severity {
  return findings.reduce<Severity>((m, f) => sevMax(m, f.severity), "info");
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) c[f.severity] += 1;
  return c;
}

/** Parse a pasted MCP tools/list manifest: {tools:[...]}, a bare [...] array,
 * or {result:{tools:[...]}}. Throws on invalid JSON. */
export function parseManifest(input: string): McpTarget {
  const data = JSON.parse(input);
  let name = "";
  let raw: unknown[] = [];
  if (Array.isArray(data)) {
    raw = data;
  } else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    name = String(o.name ?? o.server ?? "");
    if (Array.isArray(o.tools)) raw = o.tools as unknown[];
    else if (o.result && typeof o.result === "object" && Array.isArray((o.result as Record<string, unknown>).tools)) {
      raw = (o.result as Record<string, unknown>).tools as unknown[];
    }
  }
  const tools: McpTool[] = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => {
      const params: McpParam[] = [];
      const schema = (e.inputSchema ?? e.input_schema) as Record<string, unknown> | undefined;
      const props = schema?.properties as Record<string, unknown> | undefined;
      if (props && typeof props === "object") {
        for (const [pname, pspec] of Object.entries(props)) {
          const s = (pspec && typeof pspec === "object" ? pspec : {}) as Record<string, unknown>;
          const type = String(s.type ?? "");
          const def = s.default != null ? String(s.default) : undefined;
          // Bounded if the schema pins the value space (enum / pattern / format).
          const constrained = !!(s.enum || s.pattern || s.format);
          const description = s.description != null ? String(s.description) : undefined;
          params.push({ name: pname, type, default: def, constrained, description });
        }
      }
      return {
        name: String(e.name ?? ""),
        description: String(e.description ?? ""),
        params,
        descriptionDynamic: Boolean(e.descriptionDynamic),
        sampleResult: e.sampleResult != null ? String(e.sampleResult) : undefined,
      };
    });
  return { name, tools };
}
