// MCP gateway policy engine — a pure, in-browser simulator of the Shiva gateway
// (shiva/gateway). It turns the scanner's findings into per-tool allow/flag/block
// verdicts under a configurable policy, and replays a call sequence with runtime
// data-flow taint so the classic read-then-exfiltrate chain is blocked live.
// No deps, unit-testable. Reuses lib/mcp-scan as the detection layer.

import {
  type McpTarget,
  type Severity,
  type Finding,
  SEV_RANK,
  sevMax,
  scan,
  inferCapabilities,
} from "./mcp-scan";

export type Verdict = "allow" | "flag" | "block";

export const VERDICT_RANK: Record<Verdict, number> = { allow: 0, flag: 1, block: 2 };

export type GatewayPolicy = {
  /** Block any tool that triggers a critical finding. */
  blockCritical: boolean;
  /** Block any tool that can run commands / code (exec capability). */
  blockExec: boolean;
  /** Flag (require approval) tools with a high-severity finding. */
  flagHigh: boolean;
  /** Flag tools that can write or delete files. */
  flagWrite: boolean;
  /** At runtime, block an outbound/network call once sensitive data was read. */
  blockExfilChain: boolean;
};

export const DEFAULT_POLICY: GatewayPolicy = {
  blockCritical: true,
  blockExec: true,
  flagHigh: true,
  flagWrite: true,
  blockExfilChain: true,
};

export const POLICY_LABELS: { key: keyof GatewayPolicy; label: string; hint: string }[] = [
  { key: "blockCritical", label: "Block critical", hint: "Deny any tool with a critical finding" },
  { key: "blockExec", label: "Block command exec", hint: "Deny tools that can run shell / code" },
  { key: "flagHigh", label: "Flag high", hint: "Require approval for high-severity tools" },
  { key: "flagWrite", label: "Flag file writes", hint: "Require approval for write / delete tools" },
  { key: "blockExfilChain", label: "Block exfil chain", hint: "At runtime, block a network call after a secret/file read" },
];

export type ToolVerdict = {
  tool: string;
  caps: string[];
  verdict: Verdict;
  maxSeverity: Severity;
  reasons: string[];
};

/** Pull the two capability names out of a C3 combo finding title. */
function comboCaps(f: Finding): [string, string] | null {
  const m = f.title.match(/combination:\s*(\w+)\s*\+\s*(\w+)/i);
  return m ? [m[1], m[2]] : null;
}

/** Static evaluation: a verdict per tool under the policy. */
export function evaluateTools(target: McpTarget, policy: GatewayPolicy): ToolVerdict[] {
  const findings = scan(target);
  return target.tools.map((tool) => {
    const caps = inferCapabilities(tool);
    const own = findings.filter((f) => f.tool === tool.name);
    const combos = findings.filter(
      (f) => f.check === "C3-dangerous-combo" && (() => {
        const cc = comboCaps(f);
        return cc ? caps.has(cc[0]) || caps.has(cc[1]) : false;
      })(),
    );
    const relevant = [...own, ...combos];
    const maxSeverity = relevant.reduce<Severity>((m, f) => sevMax(m, f.severity), "info");

    const reasons: string[] = [];
    let verdict: Verdict = "allow";
    const bump = (v: Verdict, why: string) => {
      if (VERDICT_RANK[v] >= VERDICT_RANK[verdict]) verdict = v;
      reasons.push(why);
    };

    if (policy.blockCritical && maxSeverity === "critical") bump("block", "critical finding");
    if (policy.blockExec && caps.has("exec")) bump("block", "command/code execution capability");
    if (policy.flagHigh && maxSeverity === "high") bump("flag", "high-severity finding");
    if (policy.flagWrite && (caps.has("fs_write") || caps.has("fs_delete"))) bump("flag", "file write/delete capability");
    if (verdict === "allow" && maxSeverity === "medium") bump("flag", "medium-severity finding");

    if (reasons.length === 0) reasons.push("no policy rule triggered");
    return { tool: tool.name, caps: Array.from(caps).sort(), verdict, maxSeverity, reasons };
  });
}

export type CallResult = {
  step: number;
  tool: string;
  verdict: Verdict;
  reason: string;
  /** True if the runtime exfil-chain rule fired on this call. */
  exfilBlocked: boolean;
};

const SENSITIVE_READ = new Set(["secrets", "fs_read"]);

/**
 * Replay a sequence of tool calls through the gateway. Static verdicts apply,
 * plus a runtime data-flow rule: once a tool that reads sensitive data (secrets
 * or files) has run, any later network/outbound call is blocked as a potential
 * exfiltration — the read-then-send chain, caught live rather than statically.
 */
export function simulateCalls(
  target: McpTarget,
  sequence: string[],
  policy: GatewayPolicy,
): CallResult[] {
  const verdicts = new Map(evaluateTools(target, policy).map((v) => [v.tool, v]));
  const capsByTool = new Map(target.tools.map((t) => [t.name, inferCapabilities(t)]));
  let sensitiveSeen = false;

  return sequence.map((name, i) => {
    const tv = verdicts.get(name);
    const caps = capsByTool.get(name) ?? new Set<string>();
    // Runtime exfil chain takes precedence: a network call after a sensitive read.
    if (policy.blockExfilChain && caps.has("network") && sensitiveSeen) {
      return {
        step: i + 1,
        tool: name,
        verdict: "block",
        reason: "exfiltration chain — sensitive data was read earlier this session",
        exfilBlocked: true,
      };
    }
    const verdict: Verdict = tv?.verdict ?? "allow";
    const reason = tv ? tv.reasons[0] : "unknown tool — not in manifest";
    // A tool only taints the session if it was actually allowed to run.
    if (verdict !== "block" && Array.from(caps).some((c) => SENSITIVE_READ.has(c))) {
      sensitiveSeen = true;
    }
    return { step: i + 1, tool: name, verdict, reason, exfilBlocked: false };
  });
}
