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

/** The default (no-signal) scan-stage steps. */
export function scanDefaultSteps(deep: boolean): ScanStep[] {
  return SCAN_DEFAULT.map((t) => scanStepFor(t, deep)).filter((s): s is ScanStep => !!s);
}

/**
 * Result-driven scan steps for one host, from its recon finding text. Falls back
 * to the full default battery when there's no signal (never scans less).
 */
export function planScanSteps(reconTexts: string[], deep: boolean): ScanStep[] {
  if (reconTexts.length === 0) return scanDefaultSteps(deep);
  const tools = scanToolSet(deriveHostSignals(reconTexts));
  return [...tools].map((t) => scanStepFor(t, deep)).filter((s): s is ScanStep => !!s);
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
    "-jsonl -tags exposure,exposures,takeover,secret,token,config,backup,default-login,exposed-panel " +
    "-rl 150 -timeout 8 -retries 1 -c 50",
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
      { tool: "nmap", args: "-Pn -F -T4 --host-timeout 10m", mode: "host" },
      { tool: "gobuster", args: "dir -q -t 50 --timeout 10s -w /usr/share/wordlists/dirb/common.txt", mode: "url" },
      { tool: "katana", args: "-silent -d 2 -jc -rl 150", mode: "url" },
    ];
  }
  return [
    { tool: "httpx", args: "-title -status-code -tech-detect", mode: "url" },
    { tool: "nuclei", args: "-jsonl -rl 150 -timeout 8 -retries 1 -c 50", mode: "url" },
    HIGH_YIELD_NUCLEI,
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
