// Result-driven scan planning — pick scan tools from what recon actually found,
// instead of blasting the full battery at every host.
//
// SAFETY: with NO usable signal, scanToolSet returns the full default set, so
// this can never scan LESS than the old fixed behaviour by accident — it only
// scans SMARTER (adds wpscan for WordPress, sslscan for TLS, enum4linux for SMB;
// skips web-only tools on a host with no web service).
//
// Pure (no IO), unit-tested. `deriveHostSignals` reads recon finding text; the
// pipeline maps findings→host by the host appearing in the finding text.

export type HostSignals = {
  web?: boolean; // HTTP(S) service seen (httpx/whatweb/nikto/gobuster)
  tls?: boolean; // HTTPS / 443 / TLS
  wordpress?: boolean;
  smb?: boolean; // 139/445 / SMB
  ports?: number[];
};

const DEFAULT_TOOLS = ["nuclei", "nmap", "gobuster", "nikto", "sslscan"] as const;

/** Derive per-host signals from the text of that host's recon findings. */
export function deriveHostSignals(texts: string[]): HostSignals {
  const t = texts.join("\n").toLowerCase();
  const ports = [...t.matchAll(/\b(\d{1,5})\/(?:tcp|udp)\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n < 65536);
  const portSet = new Set(ports);
  const web =
    /\bhttps?:\/\//.test(t) || /\bhttp\b|title:|status-code|webserver|nginx|apache|iis|\[200\]|\[30\d\]/.test(t) ||
    portSet.has(80) || portSet.has(443) || portSet.has(8080) || portSet.has(8443);
  const tls = /\bhttps:\/\/|\btls\b|\bssl\b|certificate|443\/tcp/.test(t) || portSet.has(443) || portSet.has(8443);
  const wordpress = /\bwordpress\b|\bwp-\b|wp-content|wp-login|wp-json/.test(t);
  const smb = /\bsmb\b|netbios|microsoft-ds|\b445\/tcp|\b139\/tcp/.test(t) || portSet.has(445) || portSet.has(139);
  return { web, tls, wordpress, smb, ports: [...portSet] };
}

/** True when we have no meaningful signal → use the full default battery. */
export function noSignal(sig: HostSignals): boolean {
  return !sig.web && !sig.tls && !sig.smb && !sig.wordpress && (sig.ports?.length ?? 0) === 0;
}

/**
 * The set of scan tools to run for a host given its signals. Full default set
 * when there's no signal (never regress); otherwise a targeted set.
 */
export function scanToolSet(sig: HostSignals): Set<string> {
  if (noSignal(sig)) return new Set(DEFAULT_TOOLS);
  const tools = new Set<string>(["nmap"]); // always worth a port/service scan
  if (sig.web) {
    tools.add("nuclei");
    tools.add("gobuster");
    tools.add("nikto");
    // Any web host gets a TLS check. Recon (httpx over http://, whatweb, gau)
    // rarely emits an explicit "https://"/"443/tcp" signal, so gating sslscan on
    // sig.tls alone left weak/expired-cert findings — a staple reportable class —
    // uncovered on most real HTTPS sites. A web host is worth the (cheap) scan.
    tools.add("sslscan");
  }
  if (sig.tls) tools.add("sslscan");
  if (sig.wordpress) tools.add("wpscan");
  if (sig.smb) tools.add("enum4linux");
  return tools;
}
