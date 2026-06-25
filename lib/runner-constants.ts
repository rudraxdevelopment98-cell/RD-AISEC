// Runner tool allowlist + job statuses. Separate module so the "use server"
// actions file can import these (a "use server" file may only export async
// functions).
//
// SECURITY: the portal only ever queues an allowlisted tool with one of its
// predefined argument presets. Targets and args are validated against
// SAFE_VALUE (no shell metacharacters) before a Job is created. The runner
// enforces its own copy of this allowlist as defense in depth — it never runs
// arbitrary shell.

export type ToolPreset = {
  id: string;
  label: string;
  // flags passed before the target, e.g. ["-sV", "-T4"]
  args: string[];
};

export type RunnerTool = {
  id: string;
  label: string;
  // short description of what it does, shown in the UI
  description: string;
  // whether this tool is active (touches the target) vs passive (lookup only)
  active: boolean;
  presets: ToolPreset[];
};

export const RUNNER_TOOLS: RunnerTool[] = [
  {
    id: "nmap",
    label: "Nmap — port & service scan",
    description: "Discover open ports and the services behind them.",
    active: true,
    presets: [
      { id: "quick", label: "Quick (top 100 ports)", args: ["-F", "-T4"] },
      { id: "service", label: "Service + version", args: ["-sV", "-T4"] },
      { id: "full", label: "Full TCP (all ports)", args: ["-p-", "-T4"] },
    ],
  },
  {
    id: "httpx",
    label: "httpx — HTTP probe",
    description: "Probe a host for live HTTP(S) services, titles and status.",
    active: true,
    presets: [
      { id: "probe", label: "Probe (title, status, tech)", args: ["-title", "-status-code", "-tech-detect"] },
    ],
  },
  {
    id: "nuclei",
    label: "Nuclei — templated checks",
    description: "Run community vulnerability/exposure templates against a target.",
    active: true,
    presets: [
      { id: "info", label: "Info & misconfig (low impact)", args: ["-severity", "info,low", "-jsonl"] },
      { id: "default", label: "Default templates", args: ["-jsonl"] },
    ],
  },
  {
    id: "whois",
    label: "WHOIS — registration lookup",
    description: "Passive registration/ownership lookup for a domain or IP.",
    active: false,
    presets: [{ id: "lookup", label: "Lookup", args: [] }],
  },
  {
    id: "dig",
    label: "dig — DNS records",
    description: "Passive DNS record lookup (A/AAAA/MX/NS/TXT).",
    active: false,
    presets: [{ id: "any", label: "Common records", args: ["+nocmd", "+noall", "+answer", "ANY"] }],
  },
];

export function findTool(id: string): RunnerTool | undefined {
  return RUNNER_TOOLS.find((t) => t.id === id);
}

export const JOB_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// A runner is considered offline if it hasn't polled within this window.
export const RUNNER_ONLINE_WINDOW_MS = 90_000;

// Cap stored tool output so a chatty tool can't bloat the database.
export const MAX_OUTPUT_CHARS = 200_000;

/**
 * Allowed characters for a target or an arg token. Deliberately strict — no
 * shell metacharacters (; | & $ ` > < ( ) etc.), so even though the runner uses
 * argv (not a shell), a malformed value can never become an injection.
 */
const SAFE_VALUE = /^[A-Za-z0-9 ._:/@,+=\-]+$/;

export function isSafeValue(v: string): boolean {
  return v.length > 0 && v.length <= 512 && SAFE_VALUE.test(v);
}
