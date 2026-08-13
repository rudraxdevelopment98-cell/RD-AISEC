// Engine strategy — THE single source of truth for which tools run, with what
// args, in each phase. Before this, tool lists were duplicated across the staged
// pipeline (pipeline-engine.ts) and the bug-bounty pipeline (bug-pipeline.ts) and
// could silently drift. Now every orchestrator imports its steps from here.
//
// Pure (no IO). Result-driven planning (scan-plan) + target prioritization
// (target-priority) are re-exported so callers reach one strategy module.

import { deriveHostSignals, scanToolSet } from "@/lib/engine/scan-plan";

export type ScanStep = { tool: string; args: string; mode: "url" | "host" };

/**
 * Canonical per-tool step (args + mode) for the STAGED assessment pipeline. Change
 * a tool's args here and the pipeline + result-driven planner both pick it up.
 */
export function scanStepFor(tool: string, deep = false): ScanStep | null {
  switch (tool) {
    // ── recon ──
    case "httpx":
      return { tool, args: "-title -status-code -tech-detect", mode: "url" };
    case "whatweb":
      return { tool, args: "-a 3", mode: "host" };
    case "gau":
      return { tool, args: "--subs", mode: "host" };
    // ── scan ──
    case "nuclei":
      // Bounty focus: only medium+ severity. Without this, nuclei fires thousands
      // of info/low templates (tech-detect, headers, banners, panels) — the exact
      // low-value flood that buries anything reportable. Programs don't pay for
      // info findings; this keeps CVEs, exposures, misconfigs, takeovers, default
      // logins, and secret leaks (all medium+) while dropping the noise at source.
      return { tool, args: "-jsonl -severity medium,high,critical -rl 150 -timeout 8 -retries 1 -c 50", mode: "url" };
    case "nmap":
      return {
        tool,
        args: deep
          ? "-Pn -sV -T4 -p- --script vuln --host-timeout 30m --min-rate 800 --max-retries 2"
          : "-Pn -sV -T4 --top-ports 200 --host-timeout 15m --max-retries 2",
        mode: "host",
      };
    case "gobuster":
      return {
        tool,
        args: deep
          ? "dir -q -t 50 --timeout 10s -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt"
          : "dir -q -t 50 --timeout 10s -w /usr/share/wordlists/dirb/common.txt",
        mode: "url",
      };
    case "nikto":
      return { tool, args: "-maxtime 1200", mode: "url" };
    case "sslscan":
      return { tool, args: "", mode: "host" };
    // ── signal-driven extras (WordPress / SMB) ──
    case "wpscan":
      return { tool, args: "--no-banner --random-user-agent --enumerate vp", mode: "url" };
    case "enum4linux":
      return { tool, args: "-A", mode: "host" };
    default:
      return null;
  }
}

export const RECON_TOOLS = ["httpx", "whatweb", "gau"];
export const SCAN_DEFAULT = ["nuclei", "nmap", "gobuster", "nikto", "sslscan"];

/** The recon-stage steps. */
export function reconSteps(): ScanStep[] {
  return RECON_TOOLS.map((t) => scanStepFor(t)).filter((s): s is ScanStep => !!s);
}

// Append the high-yield exposure hunt + the GraphQL introspection probe to a web
// host's scan. These are the passes that actually surface reportable modern-class
// bugs (exposed .git/.env, takeovers, leaked secrets, SSRF/SSTI/XXE/OAuth, GraphQL
// authz) — the same two dedicated passes the bug-bounty pipeline runs. Previously
// only the bug-bounty orchestrator ran them, so a MANUAL staged engagement scan
// silently missed exactly the classes we build exploit playbooks for. Gated on the
// host actually being web (a url-mode nuclei step present) so SMB/host-only targets
// don't get pointless URL passes. Finding dedup keeps the overlap cheap.
function withHighYield(steps: ScanStep[]): ScanStep[] {
  const isWeb = steps.some((s) => s.tool === "nuclei" && s.mode === "url");
  return isWeb ? [...steps, HIGH_YIELD_NUCLEI, GRAPHQL_PROBE] : steps;
}

/** The default (no-signal) scan-stage steps. */
export function scanDefaultSteps(deep: boolean): ScanStep[] {
  const base = SCAN_DEFAULT.map((t) => scanStepFor(t, deep)).filter((s): s is ScanStep => !!s);
  return withHighYield(base);
}

/**
 * Result-driven scan steps for one host, from its recon finding text. Falls back
 * to the full default battery when there's no signal (never scans less).
 */
export function planScanSteps(reconTexts: string[], deep: boolean): ScanStep[] {
  if (reconTexts.length === 0) return scanDefaultSteps(deep);
  const tools = scanToolSet(deriveHostSignals(reconTexts));
  const base = [...tools].map((t) => scanStepFor(t, deep)).filter((s): s is ScanStep => !!s);
  return withHighYield(base);
}

// Dedicated "high-yield hunt" — the finding classes that actually earn bounties on
// fresh scope: exposed .git/.env/backups/configs, subdomain takeover, leaked
// secrets/tokens, default logins, exposed panels. Run as its OWN nuclei pass with
// an explicit tag allowlist and NO severity floor, because many of these templates
// are rated info/low by nuclei and would otherwise be filtered out by the general
// scan's medium+ floor — which is exactly why the engine surfaced "nothing
// reportable." nuclei's own de-dupe + the finding dedup keep the overlap cheap.
export const HIGH_YIELD_NUCLEI: ScanStep = {
  tool: "nuclei",
  args:
    // Fresh-scope exposures + the modern high-value classes that actually pay in
    // 2024–2025 (SSRF, JWT/OAuth, SSTI/XXE, cache poisoning, CRLF, LFI). GraphQL is
    // its own dedicated probe below.
    "-jsonl -tags exposure,exposures,takeover,secret,token,config,backup,default-login,exposed-panel," +
    "jwt,oauth,ssrf,ssti,xxe,cache,crlf,lfi,redirect " +
    "-rl 150 -timeout 8 -retries 1 -c 50",
  mode: "url",
};

// Dedicated GraphQL introspection probe — a first-class step. GraphQL IDOR/BOLA
// and introspection disclosure are among the most under-explored, well-paying
// classes right now (missing per-resolver authz + a schema handed to the world).
// nuclei's graphql templates fingerprint the common endpoints (/graphql,
// /api/graphql, /v1/graphql, /graphql/console, …) and flag introspection + known
// GraphQL CVEs. Findings classify via the "graphql" taxonomy class.
export const GRAPHQL_PROBE: ScanStep = {
  tool: "nuclei",
  args: "-jsonl -tags graphql -rl 120 -timeout 8 -retries 1 -c 40",
  mode: "url",
};

// ── Bug-bounty automation pipeline (distinct recipe: adds katana crawl + the
//    high-yield hunt; deep adds nuclei-DAST fuzzing + dalfox). Kept here so ALL
//    tool lists live in one file. ──
export function bugPipelineSteps(deep: boolean): ScanStep[] {
  if (!deep) {
    return [
      { tool: "httpx", args: "-title -status-code -tech-detect", mode: "url" },
      { tool: "nuclei", args: "-jsonl -severity medium,high,critical -rl 150 -timeout 8 -retries 1 -c 50", mode: "url" },
      HIGH_YIELD_NUCLEI,
      GRAPHQL_PROBE,
      { tool: "nmap", args: "-Pn -F -T4 --host-timeout 10m", mode: "host" },
      { tool: "gobuster", args: "dir -q -t 50 --timeout 10s -w /usr/share/wordlists/dirb/common.txt", mode: "url" },
      { tool: "katana", args: "-silent -d 2 -jc -rl 150", mode: "url" },
    ];
  }
  return [
    { tool: "httpx", args: "-title -status-code -tech-detect", mode: "url" },
    { tool: "nuclei", args: "-jsonl -rl 150 -timeout 8 -retries 1 -c 50", mode: "url" },
    HIGH_YIELD_NUCLEI,
    GRAPHQL_PROBE,
    { tool: "nmap", args: "-Pn -sV -p- --script vuln -T4 --host-timeout 30m --min-rate 800 --max-retries 2", mode: "host" },
    { tool: "gobuster", args: "dir -q -t 50 --timeout 10s -w /usr/share/wordlists/dirb/common.txt", mode: "url" },
    { tool: "katana", args: "-silent -d 3 -jc -kf all -rl 150", mode: "url" },
    { tool: "nuclei", args: "-dast -rl 100 -timeout 8 -retries 1 -c 40", mode: "url" },
    { tool: "dalfox", args: "--skip-bav --worker 30 --timeout 10 --silence", mode: "url" },
    { tool: "nikto", args: "-maxtime 1200", mode: "url" },
    { tool: "sslscan", args: "", mode: "host" },
  ];
}

export { prioritizeHosts } from "@/lib/engine/target-priority";
export { deriveHostSignals, scanToolSet } from "@/lib/engine/scan-plan";
