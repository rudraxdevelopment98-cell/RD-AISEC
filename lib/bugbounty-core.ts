// Pure helpers for bug-bounty scope parsing. No DB/IO.

export const BUG_PLATFORMS = [
  { id: "hackerone", label: "HackerOne" },
  { id: "bugcrowd", label: "Bugcrowd" },
  { id: "intigriti", label: "Intigriti" },
  { id: "yeswehack", label: "YesWeHack" },
  { id: "other", label: "Other" },
] as const;

export function platformLabel(id: string): string {
  return BUG_PLATFORMS.find((p) => p.id === id)?.label ?? "Other";
}

/**
 * Parse a pasted scope blob into a clean target list. Drops comments/blank
 * lines, strips a leading wildcard (*.example.com -> example.com) and URL
 * scheme/paths so the value is scannable. De-duplicates.
 */
export function parseScopeTargets(scope: string): string[] {
  const out = new Set<string>();
  for (const lineRaw of (scope ?? "").split(/\r?\n/)) {
    let line = lineRaw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    // Take the first token (scope lines sometimes have notes after a space).
    line = line.split(/\s+/)[0];
    line = line.replace(/^\*\./, ""); // wildcard host
    line = line.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
    line = line.split("/")[0]; // path
    line = line.replace(/^\*$/, ""); // bare wildcard -> drop
    if (line && /[a-z0-9]/i.test(line)) out.add(line);
  }
  return [...out];
}
