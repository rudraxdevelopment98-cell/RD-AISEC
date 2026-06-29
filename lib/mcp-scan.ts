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

export type McpParam = { name: string; type?: string };
export type McpTool = {
  name: string;
  description?: string;
  params?: McpParam[];
  descriptionDynamic?: boolean;
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

export function scan(target: McpTarget): Finding[] {
  return [
    ...checkHiddenInstructions(target),
    ...checkBroadPermissions(target),
    ...checkDangerousCombos(target),
    ...checkToolShadowing(target),
    ...checkDriftRisk(target),
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
          const type = pspec && typeof pspec === "object" ? String((pspec as Record<string, unknown>).type ?? "") : "";
          params.push({ name: pname, type });
        }
      }
      return {
        name: String(e.name ?? ""),
        description: String(e.description ?? ""),
        params,
        descriptionDynamic: Boolean(e.descriptionDynamic),
      };
    });
  return { name, tools };
}
