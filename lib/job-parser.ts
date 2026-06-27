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
  // True when this finding is a proven/validated exploitable issue.
  confirmed?: boolean;
};

import { parseNmapNetwork, hostLabel } from "@/lib/network";

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
function normSeverity(s: string): string {
  const v = (s || "").toLowerCase();
  return SEVERITIES.has(v) ? v : "info";
}

/**
 * Nmap normal output → one finding per open port. Host-aware: a network scan
 * (multiple "Nmap scan report for" blocks) attributes each port to its host.
 */
function parseNmap(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  for (const h of parseNmapNetwork(output)) {
    const label = hostLabel(h);
    for (const p of h.ports) {
      out.push({
        title: `Open port ${p.port}/${p.proto} (${p.service}) on ${label}`,
        severity: "info",
        status: "open",
        description:
          `Nmap found ${p.port}/${p.proto} open running ${p.service}` +
          (p.version ? ` — ${p.version}` : "") +
          `.\n\nHost: ${label}` +
          (target && target !== label ? `\nScan target: ${target}` : ""),
        recommendation:
          "Confirm this service is intended to be exposed. Close or firewall it if not, and ensure it is patched and access-controlled.",
      });
    }
  }
  return out;
}

/** Nuclei JSONL: one JSON object per line with info.{name,severity} + matched-at.
 * Captures CVE id, CWE, references and extracted results for richer findings,
 * and dedupes repeats (templateId|matched) within a single run. */
function parseNuclei(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  const seen = new Set<string>();
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      const j = JSON.parse(line);
      const info = j.info ?? {};
      const tid = j["template-id"] ?? "";
      const name = info.name ?? tid ?? "Nuclei match";
      const matched = j["matched-at"] ?? j.host ?? target;
      const key = `${tid}|${matched}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sev = normSeverity(info.severity);

      const classification = info.classification ?? {};
      const cve = (Array.isArray(classification["cve-id"]) ? classification["cve-id"][0] : classification["cve-id"]) || "";
      const cwe = Array.isArray(classification["cwe-id"]) ? classification["cwe-id"].join(", ") : classification["cwe-id"] || "";
      const cvss = classification["cvss-score"] ? `CVSS ${classification["cvss-score"]}` : "";
      const refs: string[] = Array.isArray(info.reference) ? info.reference.slice(0, 3) : [];
      const extracted: string[] = Array.isArray(j["extracted-results"]) ? j["extracted-results"].slice(0, 5) : [];
      const tags = Array.isArray(info.tags) ? info.tags.join(", ") : info.tags || "";

      const meta = [cve && cve.toUpperCase(), cwe && `CWE: ${cwe}`, cvss].filter(Boolean).join(" · ");
      out.push({
        title: `${name}${cve ? ` (${cve.toUpperCase()})` : ""} — ${matched}`,
        severity: sev,
        status: "open",
        // High/critical nuclei matches are template-confirmed exposures.
        confirmed: sev === "critical" || sev === "high",
        description:
          `Nuclei template "${tid || name}" matched at ${matched}.` +
          (meta ? `\n\n${meta}` : "") +
          (tags ? `\nTags: ${tags}` : "") +
          (info.description ? `\n\n${info.description}` : "") +
          (extracted.length ? `\n\nExtracted: ${extracted.join(", ")}` : "") +
          (refs.length ? `\n\nReferences:\n${refs.join("\n")}` : ""),
        recommendation:
          info.remediation ??
          "Review the matched template reference and remediate the underlying exposure (patch/upgrade or remove the exposed asset).",
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

/** sqlmap: detect confirmed SQL injection points and the affected parameters. */
function parseSqlmap(target: string, output: string): ParsedFinding[] {
  const vulnerable =
    /sqlmap identified the following injection point|is vulnerable/i.test(output);
  if (!vulnerable) return [];

  const params = Array.from(output.matchAll(/^Parameter:\s*(.+)$/gim)).map((m) =>
    m[1].trim(),
  );
  const where = params.length ? ` (parameter${params.length > 1 ? "s" : ""}: ${params.join(", ")})` : "";
  return [
    {
      title: `SQL injection on ${target}${where}`,
      severity: "critical",
      status: "open",
      confirmed: true,
      description:
        `sqlmap confirmed a SQL injection point on ${target}${where}.\n\n` +
        "SQL injection can allow reading or modifying the database and, depending on configuration, the underlying host.",
      recommendation:
        "Use parameterized queries / prepared statements for all database access, validate and constrain input, and apply least-privilege database accounts. Re-test after fixing.",
    },
  ];
}

/** Nikto: summarize the reported items ("+ " lines), elevating on risky keywords. */
function parseNikto(target: string, output: string): ParsedFinding[] {
  const skip = /^\+\s*(Target (IP|Hostname|Port)|Start Time|End Time|Server:|SSL Info|[\d]+ host\(s\) tested)/i;
  const items = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("+ ") && !skip.test(l));
  if (items.length === 0) return [];

  const risky = /osvdb|cve-|vulnerab|outdated|deprecated|directory indexing|default (file|account)|x-frame-options|injection|traversal/i.test(
    output,
  );
  return [
    {
      title: `Nikto findings on ${target}`,
      severity: risky ? "medium" : "info",
      status: "open",
      description: `Nikto reported ${items.length} item(s) on ${target}:\n\n${items.join("\n")}`,
      recommendation:
        "Review each reported item; patch outdated software, remove default/sample files, and add missing security headers.",
    },
  ];
}

/** masscan: lines like "Discovered open port 80/tcp on 1.2.3.4" → one finding each. */
function parseMasscan(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  for (const m of output.matchAll(/Discovered open port (\d+)\/(\w+) on ([\d.]+)/gi)) {
    const [, port, proto, host] = m;
    out.push({
      title: `Open port ${port}/${proto} on ${host}`,
      severity: "info",
      status: "open",
      description: `masscan found ${port}/${proto} open on ${host}` + (target ? `\n\nScan target: ${target}` : ""),
      recommendation:
        "Confirm this service is meant to be exposed. Close or firewall it if not, and ensure it is patched and access-controlled.",
    });
  }
  return out;
}

/** arp-scan: "192.168.1.1\taa:bb:cc:..\tVendor" → one summary finding of LAN devices. */
function parseArpScan(target: string, output: string): ParsedFinding[] {
  const rows = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(\d{1,3}\.){3}\d{1,3}\s+([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(l));
  if (rows.length === 0) return [];
  return [
    {
      title: `LAN devices discovered on ${target} (${rows.length})`,
      severity: "info",
      status: "open",
      description: `arp-scan found ${rows.length} device(s) on ${target}:\n\n${rows.join("\n")}`,
      recommendation:
        "Confirm every device is expected. Investigate any unknown hosts/MAC vendors on the network.",
    },
  ];
}

/** gobuster: "/admin (Status: 200)" lines → one summary finding; elevate on sensitive paths. */
function parseGobuster(target: string, output: string): ParsedFinding[] {
  const paths = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\/\S*\s*\(Status:\s*\d{3}\)/i.test(l));
  if (paths.length === 0) return [];
  const sensitive = /\/(admin|login|backup|\.git|\.env|config|phpmyadmin|wp-admin|api|upload|dashboard|test|dev|old|\.svn|\.bak)/i.test(
    output,
  );
  return [
    {
      title: `Discovered paths on ${target} (${paths.length})`,
      severity: sensitive ? "medium" : "info",
      status: "open",
      description: `gobuster found ${paths.length} path(s) on ${target}:\n\n${paths.join("\n")}`,
      recommendation:
        "Review exposed paths. Restrict or remove admin panels, backups, VCS folders (.git/.svn), and config files that shouldn't be public.",
    },
  ];
}

/** WhatWeb: one finding summarizing the detected technology stack. */
function parseWhatweb(target: string, output: string): ParsedFinding[] {
  const line = output
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /^https?:\/\//i.test(l));
  if (!line) return [];
  return [
    {
      title: `Technology stack on ${target}`,
      severity: "info",
      status: "open",
      description: `WhatWeb fingerprint:\n\n${line}`,
      recommendation:
        "Review the exposed technologies and versions. Hide version banners where possible and ensure each component is current and patched.",
    },
  ];
}

/** enum4linux: summarize SMB exposure; elevate when null sessions / shares are found. */
function parseEnum4linux(target: string, output: string): ParsedFinding[] {
  const hasShares = /Sharename|Mapping: OK|\[\+\] Attempting to map shares/i.test(output);
  const nullSession = /allows sessions using username '', password ''|Server allows session using username|Got domain\/workgroup name/i.test(
    output,
  );
  if (!hasShares && !nullSession) return [];
  return [
    {
      title: `SMB enumeration exposed information on ${target}`,
      severity: nullSession ? "medium" : "low",
      status: "open",
      description:
        `enum4linux gathered SMB/Windows information from ${target}` +
        (nullSession ? " via an anonymous (null) session" : "") +
        ".\n\nReview the job output for shares, users, and groups that shouldn't be readable anonymously.",
      recommendation:
        "Disable anonymous/null SMB sessions, restrict share permissions, disable SMBv1, and keep the host patched (e.g. against MS17-010).",
    },
  ];
}

/** dnsrecon: flag a successful zone transfer (high impact); otherwise no finding. */
function parseDnsrecon(target: string, output: string): ParsedFinding[] {
  if (!/zone transfer.*success|\[\+\]\s*zone transfer|AXFR.*(success|records)/i.test(output)) {
    return [];
  }
  return [
    {
      title: `DNS zone transfer allowed on ${target}`,
      severity: "high",
      status: "open",
      confirmed: true,
      description:
        `dnsrecon completed a DNS zone transfer (AXFR) against ${target}, exposing the full DNS record set.\n\n` +
        "This leaks internal hostnames and infrastructure that aid an attacker's mapping.",
      recommendation:
        "Restrict zone transfers to authorized secondary name servers only (allow-transfer / TSIG). Do not allow AXFR from arbitrary clients.",
    },
  ];
}

/**
 * Detect a CONFIRMED-vulnerable signal in any tool output (nmap --script vuln,
 * Metasploit check/scanner modules, etc.) and emit a critical, confirmed finding.
 */
function parseVulnConfirm(target: string, output: string): ParsedFinding[] {
  const re =
    /\b(State:\s*VULNERABLE|is likely VULNERABLE|appears? to be vulnerable|target is vulnerable|host is likely vulnerable|\bVULNERABLE\b)/i;
  if (!re.test(output)) return [];
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => re.test(l) || /CVE-\d|ms\d\d-\d|exploit/i.test(l))
    .slice(0, 10);
  return [
    {
      title: `✅ Confirmed exploitable: ${target}`,
      severity: "critical",
      status: "open",
      confirmed: true,
      description:
        `Automated validation indicates ${target} is exploitable:\n\n${lines.join("\n")}\n\n` +
        "Validate manually on the authorized target, then report and remediate.",
      recommendation:
        "Patch/upgrade the affected component immediately, then re-run the check to confirm the fix.",
    },
  ];
}

/** searchsploit: list public Exploit-DB matches for a product/CVE as a finding. */
function parseSearchsploit(target: string, output: string): ParsedFinding[] {
  if (/Exploits?:\s*No Results|^\s*No Results/im.test(output)) return [];
  // Result rows look like "  <title>  | <path/to/exploit>".
  const rows = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("|") && /[a-z0-9]\/[a-z0-9]/i.test(l) && !/^Exploit Title|^-+/.test(l))
    .map((l) => l.replace(/\s*\|\s*/, " — "));
  if (rows.length === 0) return [];
  return [
    {
      title: `Public exploits available for "${target}" (${rows.length})`,
      severity: "high",
      status: "open",
      description:
        `Exploit-DB has ${rows.length} entr${rows.length === 1 ? "y" : "ies"} matching "${target}":\n\n` +
        rows.slice(0, 25).join("\n") +
        (rows.length > 25 ? `\n…and ${rows.length - 25} more` : "") +
        `\n\nFetch one with:  searchsploit -m <path>`,
      recommendation:
        "Confirm the affected component/version is exposed, validate the exploit on the authorized target, then patch/upgrade to remove it.",
    },
  ];
}

/** sslscan: flag weak protocols (SSLv2/3, TLS1.0/1.1), weak ciphers (RC4/3DES/
 * NULL/EXPORT/DES), Heartbleed, and expired/self-signed certificates. */
function parseSslscan(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  const enabled = (proto: RegExp) =>
    output.split("\n").some((l) => proto.test(l) && /enabled/i.test(l));

  // Deprecated protocols still enabled.
  const deadProtos: { re: RegExp; name: string; sev: string }[] = [
    { re: /SSLv2/i, name: "SSLv2", sev: "high" },
    { re: /SSLv3/i, name: "SSLv3", sev: "high" },
    { re: /TLSv1\.0/i, name: "TLS 1.0", sev: "medium" },
    { re: /TLSv1\.1/i, name: "TLS 1.1", sev: "medium" },
  ];
  const weakOn = deadProtos.filter((p) => enabled(p.re));
  if (weakOn.length) {
    const worst = weakOn.some((p) => p.sev === "high") ? "high" : "medium";
    out.push({
      title: `Weak TLS/SSL protocols enabled on ${target} (${weakOn.map((p) => p.name).join(", ")})`,
      severity: worst,
      status: "open",
      confirmed: true,
      description:
        `sslscan found these deprecated protocols enabled on ${target}: ${weakOn.map((p) => p.name).join(", ")}.\n\n` +
        "Deprecated TLS/SSL versions are vulnerable to downgrade and decryption attacks (POODLE, BEAST, etc.).",
      recommendation:
        "Disable SSLv2/SSLv3 and TLS 1.0/1.1. Serve only TLS 1.2+ (prefer TLS 1.3) with modern cipher suites.",
    });
  }

  // Weak ciphers accepted.
  const weakCiphers = Array.from(
    output.matchAll(/Accepted\s+\S+\s+\d+\s+bits\s+(\S*(?:RC4|3DES|DES|NULL|EXPORT|MD5|ANON)\S*)/gi),
  ).map((m) => m[1]);
  const uniqWeak = Array.from(new Set(weakCiphers)).slice(0, 12);
  if (uniqWeak.length) {
    out.push({
      title: `Weak TLS ciphers accepted on ${target} (${uniqWeak.length})`,
      severity: "medium",
      status: "open",
      confirmed: true,
      description: `sslscan shows ${target} accepts weak cipher suites:\n\n${uniqWeak.join("\n")}`,
      recommendation:
        "Remove RC4, 3DES/DES, NULL, EXPORT, MD5 and anonymous cipher suites. Use AEAD ciphers (AES-GCM, ChaCha20-Poly1305) with forward secrecy.",
    });
  }

  // Heartbleed.
  if (/vulnerable to heartbleed/i.test(output)) {
    out.push({
      title: `Heartbleed (CVE-2014-0160) on ${target}`,
      severity: "critical",
      status: "open",
      confirmed: true,
      description: `sslscan reports ${target} is vulnerable to Heartbleed (CVE-2014-0160), which leaks server memory (keys, sessions, secrets).`,
      recommendation: "Upgrade OpenSSL immediately, reissue/rotate certificates and keys, and invalidate existing sessions.",
    });
  }

  // Certificate problems.
  if (/certificate has expired|expired\s*$/im.test(output)) {
    out.push({
      title: `Expired TLS certificate on ${target}`,
      severity: "medium",
      status: "open",
      description: `sslscan reports the TLS certificate for ${target} has expired.`,
      recommendation: "Renew the certificate and automate renewal (e.g. ACME/Let's Encrypt) to prevent recurrence.",
    });
  }
  if (/self[- ]signed/i.test(output)) {
    out.push({
      title: `Self-signed TLS certificate on ${target}`,
      severity: "low",
      status: "open",
      description: `sslscan reports a self-signed certificate on ${target}; clients can't verify the server's identity.`,
      recommendation: "Use a certificate from a trusted CA for any service clients connect to.",
    });
  }
  return out;
}

/** WPScan: surface flagged vulnerabilities ("[!]" alerts) and an out-of-date core. */
function parseWpscan(target: string, output: string): ParsedFinding[] {
  const out: ParsedFinding[] = [];
  const alerts = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("[!]") && /vulnerab|out of date|outdated|known|cve|wpvdb/i.test(l));
  if (alerts.length) {
    out.push({
      title: `WordPress vulnerabilities on ${target} (${alerts.length})`,
      severity: "high",
      status: "open",
      confirmed: true,
      description:
        `WPScan flagged ${alerts.length} issue(s) on ${target}:\n\n` +
        alerts.slice(0, 20).join("\n") +
        (alerts.length > 20 ? `\n…and ${alerts.length - 20} more` : ""),
      recommendation:
        "Update WordPress core, themes and plugins to patched versions; remove unused/abandoned plugins; restrict wp-admin and xmlrpc.",
    });
  }
  const ver = output.match(/WordPress version ([\d.]+) identified[\s\S]*?(out of date|insecure|latest)/i);
  if (ver && /out of date|insecure/i.test(ver[2])) {
    out.push({
      title: `Outdated WordPress core ${ver[1]} on ${target}`,
      severity: "medium",
      status: "open",
      description: `WPScan identified WordPress ${ver[1]} on ${target}, which is out of date.`,
      recommendation: "Upgrade WordPress core to the latest release and keep auto-updates enabled.",
    });
  }
  return out;
}

/** wafw00f: note whether a WAF is present (absence is useful context, not a vuln). */
function parseWafw00f(target: string, output: string): ParsedFinding[] {
  const behind = output.match(/is behind (.+?)(?: WAF| \(|\.|$)/i);
  if (behind) {
    return [
      {
        title: `WAF detected on ${target}: ${behind[1].trim()}`,
        severity: "info",
        status: "open",
        description: `wafw00f reports ${target} is behind ${behind[1].trim()}.`,
        recommendation: "Account for the WAF when testing; ensure it is tuned and not the only control.",
      },
    ];
  }
  if (/no WAF|No WAF|seems to be unprotected|number of requests/i.test(output)) {
    return [
      {
        title: `No WAF detected on ${target}`,
        severity: "low",
        status: "open",
        description: `wafw00f did not detect a web application firewall protecting ${target}.`,
        recommendation:
          "Consider a WAF as a defense-in-depth layer for internet-facing applications. It is not a substitute for fixing the underlying issues.",
      },
    ];
  }
  return [];
}

/**
 * WiFi access points from `nmcli ... dev wifi list` (terse or tabular) or
 * airodump output. Flags open (no encryption) and WEP networks. Best-effort:
 * returns [] when the text doesn't look like WiFi output.
 */
function parseWifi(output: string): ParsedFinding[] {
  // nmcli terse mode escapes the colons in a BSSID (AA\:BB\:...). Unescape first.
  const text = (output || "").replace(/\\:/g, ":");
  // Only treat output as WiFi when there are clear wireless markers — otherwise
  // a stray MAC in some other tool's output would create bogus "WiFi" findings.
  const isWifi =
    /\bWPA3?\b|\bWEP\b|\bESSID\b|\bBSSID\b|airodump|nmcli|Station MAC|monitor mode|wifi/i.test(text);
  if (!isWifi) return [];
  const macRe = /\b([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\b/;
  const out: ParsedFinding[] = [];

  // ── Captured handshakes (airodump shows "WPA handshake: <bssid>") ──
  const handshakes = new Set<string>();
  for (const m of text.matchAll(/WPA handshake:\s*([0-9A-Fa-f:]{17})/gi)) {
    handshakes.add(m[1].toUpperCase());
  }
  for (const b of handshakes) {
    out.push({
      title: `WPA handshake captured (${b})`,
      severity: "high",
      status: "open",
      confirmed: true,
      description:
        `A WPA handshake was captured for access point ${b}. It can be cracked offline against a wordlist:\n\n` +
        `aircrack-ng -w wordlist.txt capture-01.cap`,
      recommendation:
        "Use a long, random WPA2/WPA3 passphrase (or 802.1X/enterprise). Short/dictionary passphrases fall to offline cracking.",
    });
  }

  // ── airodump CSV station (client) section ──
  if (/Station MAC/i.test(text)) {
    const clients: string[] = [];
    let inStations = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (/^Station MAC/i.test(line)) {
        inStations = true;
        continue;
      }
      if (!inStations) continue;
      const cols = line.split(",").map((c) => c.trim());
      if (cols.length < 6 || !macRe.test(cols[0])) continue;
      const sta = cols[0].toUpperCase();
      const assoc = macRe.test(cols[5] ?? "") ? cols[5].toUpperCase() : "(not associated)";
      clients.push(`${sta} → ${assoc}`);
    }
    if (clients.length > 0) {
      out.push({
        title: `WiFi clients observed (${clients.length})`,
        severity: "info",
        status: "open",
        description: `Stations seen near the capture:\n\n${clients.join("\n")}`,
        recommendation:
          "Confirm associated devices are expected. Unknown clients on your network warrant investigation.",
      });
    }
  }

  type AP = { ssid: string; bssid: string; sec: string; line: string };
  const aps: AP[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = line.match(macRe);
    if (!m) continue;
    if (/station|associated|handshake|^BSSID/i.test(line) && !/:/.test(line.replace(macRe, "")))
      continue;
    const bssid = m[1].toUpperCase();
    const sec = /\bWPA3\b/i.test(line)
      ? "WPA3"
      : /\bWPA2\b/i.test(line)
        ? "WPA2"
        : /\bWPA\b/i.test(line)
          ? "WPA"
          : /\bWEP\b/i.test(line)
            ? "WEP"
            : /\b(OPN|open)\b/i.test(line) || /:\s*(--)?\s*$/.test(line)
              ? "OPEN"
              : "?";
    // SSID: nmcli puts it before the BSSID; airodump CSV puts ESSID last.
    // Split on the ORIGINAL matched MAC (m[1]) — `bssid` is upper-cased and
    // wouldn't match a lowercase MAC in the source line.
    let ssid = line.split(m[1])[0].replace(/[:|,]+$/, "").trim();
    if (!ssid && line.includes(",")) {
      const cols = line.split(",").map((c) => c.trim());
      ssid =
        cols
          .slice(1)
          .reverse()
          .find(
            (c) =>
              c &&
              !/^[0-9]+$/.test(c) &&
              !macRe.test(c) &&
              !/^(WPA|WPA2|WPA3|WEP|OPN|CCMP|TKIP|PSK|MGT|-1)$/i.test(c),
          ) ?? "";
    }
    if (!ssid) ssid = "(hidden)";
    // Skip a BSSID already counted as a client/handshake-only line.
    aps.push({ ssid, bssid, sec, line });
  }
  // Dedupe APs by BSSID (CSV + TUI can repeat).
  const seenBssid = new Set<string>();
  const uniqueAps = aps.filter((a) => (seenBssid.has(a.bssid) ? false : seenBssid.add(a.bssid)));

  if (uniqueAps.length > 0) {
    out.push({
      title: `WiFi networks discovered (${uniqueAps.length})`,
      severity: "info",
      status: "open",
      description:
        `Wireless scan found ${uniqueAps.length} access point(s):\n\n` +
        uniqueAps.map((a) => `${a.ssid}  ${a.bssid}  ${a.sec}`).join("\n"),
      recommendation:
        "Confirm every access point is expected. Investigate unknown/rogue APs near your environment.",
    });
  }
  for (const a of uniqueAps) {
    if (a.sec === "OPEN") {
      out.push({
        title: `Open WiFi network "${a.ssid}" (${a.bssid})`,
        severity: "medium",
        status: "open",
        description: `The access point "${a.ssid}" (${a.bssid}) uses no encryption — traffic is sent in the clear.`,
        recommendation: "Enable WPA2/WPA3 encryption on this access point; never run open WiFi for sensitive use.",
      });
    } else if (a.sec === "WEP" || a.sec === "WPA") {
      out.push({
        title: `Weak WiFi encryption (${a.sec}) on "${a.ssid}" (${a.bssid})`,
        severity: a.sec === "WEP" ? "high" : "medium",
        status: "open",
        description: `The access point "${a.ssid}" (${a.bssid}) uses ${a.sec}, which is broken/outdated.`,
        recommendation: "Upgrade the access point to WPA2 (AES) or WPA3.",
      });
    }
  }
  return out;
}

/**
 * Dispatch to the right parser. Lookup-only tools (whois/dig) intentionally
 * produce no auto-findings — their output stays on the job for manual review.
 * Custom jobs are checked for WiFi output and confirmed-vuln signals so wireless
 * scans and Metasploit checks can be imported.
 */
export function parseJobFindings(
  tool: string,
  target: string,
  output: string,
): ParsedFinding[] {
  if (!output?.trim()) return [];
  switch (tool) {
    case "nmap":
      // Open ports + any vuln-script confirmations (--script vuln).
      return [...parseNmap(target, output), ...parseVulnConfirm(target, output)];
    case "nuclei":
      return parseNuclei(target, output);
    case "sslscan":
      return [...parseSslscan(target, output), ...parseVulnConfirm(target, output)];
    case "wpscan":
      return parseWpscan(target, output);
    case "httpx":
      return parseHttpx(target, output);
    case "sqlmap":
      return parseSqlmap(target, output);
    case "nikto":
      return parseNikto(target, output);
    case "masscan":
      return parseMasscan(target, output);
    case "arpscan":
      return parseArpScan(target, output);
    case "gobuster":
      return parseGobuster(target, output);
    case "whatweb":
      return parseWhatweb(target, output);
    case "enum4linux":
      return parseEnum4linux(target, output);
    case "dnsrecon":
      return parseDnsrecon(target, output);
    case "wafw00f":
      return parseWafw00f(target, output);
    case "searchsploit":
      return parseSearchsploit(target, output);
    default:
      // Custom jobs: WiFi scans, or Metasploit check/scanner confirmations.
      return [...parseWifi(output), ...parseVulnConfirm(target, output)];
  }
}
