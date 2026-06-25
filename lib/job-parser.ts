// Turn raw runner tool output into findings. Pure + best-effort: each parser
// reads the tool's normal output format and emits finding-shaped objects. The
// caller attaches engagementId and persists them.
//
// Keep these pure and unit-testable — no DB, no auth, no I/O.

export type ParsedFinding = {
  title: string;
  severity: string; // info | low | medium | high | critical
  status: string; // open
  description: string;
  recommendation: string;
};

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
function normSeverity(s: string): string {
  const v = (s || "").toLowerCase();
  return SEVERITIES.has(v) ? v : "info";
}

/** Nmap normal output: lines like "22/tcp open ssh OpenSSH 8.2p1". */
function parseNmap(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  const re = /^(\d{1,5}\/(?:tcp|udp))\s+open\s+(\S+)(?:\s+(.*))?$/i;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    const m = re.exec(line);
    if (!m) continue;
    const [, port, service, version] = m;
    out.push({
      title: `Open port ${port} (${service}) on ${target}`,
      severity: "info",
      status: "open",
      description:
        `Nmap found ${port} open running ${service}` +
        (version ? ` — ${version.trim()}` : "") +
        `.\n\nTarget: ${target}`,
      recommendation:
        "Confirm this service is intended to be exposed. Close or firewall it if not, and ensure it is patched and access-controlled.",
    });
  }
  return out;
}

/** Nuclei JSONL: one JSON object per line with info.{name,severity} + matched-at. */
function parseNuclei(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const j = JSON.parse(line);
      const info = j.info ?? {};
      const name = info.name ?? j["template-id"] ?? "Nuclei match";
      const matched = j["matched-at"] ?? j.host ?? target;
      out.push({
        title: `${name} — ${matched}`,
        severity: normSeverity(info.severity),
        status: "open",
        description:
          `Nuclei template "${j["template-id"] ?? name}" matched at ${matched}.` +
          (info.description ? `\n\n${info.description}` : ""),
        recommendation:
          info.remediation ??
          "Review the matched template reference and remediate the underlying exposure.",
      });
    } catch {
      /* skip non-JSON lines */
    }
  }
  return out;
}

/** httpx probe output: one finding summarizing the live service line(s). */
function parseHttpx(target: string, output: string): ParsedFinding[] {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http://") || l.startsWith("https://"));
  if (lines.length === 0) return [];
  return [
    {
      title: `Live HTTP service on ${target}`,
      severity: "info",
      status: "open",
      description: `httpx probe results:\n\n${lines.join("\n")}`,
      recommendation:
        "Review exposed web services, their titles and technologies; ensure each is intended to be public and hardened.",
    },
  ];
}

/**
 * Dispatch to the right parser. Lookup-only tools (whois/dig) intentionally
 * produce no findings — their output stays on the job as context.
 */
export function parseJobFindings(
  tool: string,
  target: string,
  output: string,
): ParsedFinding[] {
  if (!output?.trim()) return [];
  switch (tool) {
    case "nmap":
      return parseNmap(target, output);
    case "nuclei":
      return parseNuclei(target, output);
    case "httpx":
      return parseHttpx(target, output);
    default:
      return [];
  }
}
