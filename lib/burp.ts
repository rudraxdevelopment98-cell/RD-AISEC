// Parse a Burp Suite issues XML export into findings. Pure + dependency-free:
// Burp's issue export is a flat, predictable structure, so we extract fields
// with regex rather than pulling in an XML library. No AI, no I/O.
//
// Burp severities map: High -> high, Medium -> medium, Low -> low,
// Information -> info, False positive -> false_positive (status, not severity).

export type ParsedBurpFinding = {
  title: string;
  severity: string; // info | low | medium | high | critical
  status: string; // open | false_positive
  description: string;
  recommendation: string;
};

/** Strip CDATA wrappers, HTML tags, and decode the common entities. */
function clean(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Extract the inner text of the first <tag>…</tag> in a block (attrs allowed). */
function field(block: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? clean(m[1]) : "";
}

function mapSeverity(burp: string): { severity: string; status: string } {
  switch (burp.trim().toLowerCase()) {
    case "high":
      return { severity: "high", status: "open" };
    case "medium":
      return { severity: "medium", status: "open" };
    case "low":
      return { severity: "low", status: "open" };
    case "false positive":
      return { severity: "info", status: "false_positive" };
    case "information":
    default:
      return { severity: "info", status: "open" };
  }
}

const MAX_FINDINGS = 1000;

/** Parse Burp issues XML; returns [] if it isn't a recognizable Burp export. */
export function parseBurpIssues(xml: string): ParsedBurpFinding[] {
  if (!xml || !/<issue\b/i.test(xml)) return [];

  const findings: ParsedBurpFinding[] = [];
  const blocks = xml.matchAll(/<issue\b[^>]*>([\s\S]*?)<\/issue>/gi);
  for (const m of blocks) {
    const block = m[1];
    const name = field(block, "name") || "Burp issue";
    const host = field(block, "host");
    const path = field(block, "path") || field(block, "location");
    const { severity, status } = mapSeverity(field(block, "severity"));
    const confidence = field(block, "confidence");

    const detail = field(block, "issueDetail");
    const background = field(block, "issueBackground");
    const remediation =
      field(block, "remediationDetail") || field(block, "remediationBackground");

    const where = [host, path].filter(Boolean).join("");
    const descParts = [
      `Imported from Burp Suite.${where ? ` Location: ${where}.` : ""}${
        confidence ? ` Confidence: ${confidence}.` : ""
      }`,
      detail,
      background,
    ].filter(Boolean);

    findings.push({
      title: `${name}${host ? ` — ${host}${path}` : ""}`.slice(0, 300),
      severity,
      status,
      description: descParts.join("\n\n").slice(0, 8000) || name,
      recommendation:
        remediation.slice(0, 8000) ||
        "Review the Burp issue detail and remediate per the issue background.",
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}
