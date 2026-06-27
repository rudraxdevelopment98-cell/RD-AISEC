// Deterministic WiFi security assessment (no AI). Given an access point's
// encryption/cipher/auth and how many clients it has, produce a risk level and
// concrete hardening suggestions you can hand to the network owner.

export type WifiIssue = {
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  detail: string;
  fix: string;
};

export type WifiAssessment = {
  risk: "critical" | "high" | "medium" | "low" | "good";
  issues: WifiIssue[];
};

const RANK: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export type WifiApInput = {
  ssid?: string;
  security?: string; // OPEN | WEP | WPA | WPA2 | WPA3
  cipher?: string; // CCMP | TKIP
  auth?: string; // PSK | MGT
  clients?: number;
};

export function wifiSecurityAdvice(ap: WifiApInput): WifiAssessment {
  const sec = (ap.security || "").toUpperCase();
  const cipher = (ap.cipher || "").toUpperCase();
  const auth = (ap.auth || "").toUpperCase();
  const issues: WifiIssue[] = [];

  if (sec === "OPEN") {
    issues.push({
      title: "Open network — no encryption",
      severity: "critical",
      detail: "All traffic is sent in clear text; anyone nearby can read it and join freely.",
      fix: "Enable WPA2 (AES/CCMP) at minimum, ideally WPA3, with a strong passphrase.",
    });
  } else if (sec === "WEP") {
    issues.push({
      title: "WEP encryption — broken",
      severity: "critical",
      detail: "WEP can be cracked in minutes regardless of key length.",
      fix: "Replace with WPA2 (AES) or WPA3 immediately; retire any hardware that only supports WEP.",
    });
  } else if (sec === "WPA") {
    issues.push({
      title: "WPA (v1) — deprecated",
      severity: "high",
      detail: "Original WPA relies on TKIP, which is weak and obsolete.",
      fix: "Move to WPA2-AES or WPA3.",
    });
  } else if (sec === "WPA2") {
    issues.push({
      title: "WPA2 — acceptable, but hardenable",
      severity: "medium",
      detail: "WPA2-PSK is vulnerable to offline cracking if the passphrase is weak, and to KRACK on unpatched clients.",
      fix: "Use a long (15+ char) random passphrase, enable WPA3/transition mode if supported, and keep client firmware patched.",
    });
  } else if (sec === "WPA3") {
    issues.push({
      title: "WPA3 — good",
      severity: "info",
      detail: "WPA3-SAE resists offline cracking and adds forward secrecy.",
      fix: "Keep firmware updated; avoid WPA3 'transition' mode once all clients support WPA3.",
    });
  }

  if (cipher === "TKIP") {
    issues.push({
      title: "TKIP cipher in use",
      severity: "high",
      detail: "TKIP is deprecated and weakens even WPA2.",
      fix: "Set the cipher to AES/CCMP only (disable TKIP/mixed mode).",
    });
  }

  if (auth === "PSK" && (sec === "WPA2" || sec === "WPA")) {
    issues.push({
      title: "Pre-shared key (PSK) authentication",
      severity: "medium",
      detail: "A captured handshake can be cracked offline against a wordlist if the passphrase is guessable.",
      fix: "Use a long random passphrase, rotate it periodically, or move to 802.1X/enterprise (RADIUS) for shared environments.",
    });
  }

  if ((ap.clients ?? 0) >= 5) {
    issues.push({
      title: `Many devices on one network (${ap.clients})`,
      severity: "low",
      detail: "Flat networks let a compromised device reach everything, including IoT.",
      fix: "Put IoT/guest devices on a separate SSID/VLAN; enable client isolation on guest WiFi.",
    });
  }

  // Always-applicable hygiene.
  issues.push({
    title: "General WiFi hardening",
    severity: "info",
    detail: "Baseline controls that apply to any access point.",
    fix: "Disable WPS, change the default admin password, disable WAN/remote admin, keep firmware up to date, and reduce TX power so the signal doesn't bleed far outside the premises.",
  });

  const top = issues.reduce((m, i) => Math.max(m, RANK[i.severity] ?? 0), 0);
  const risk =
    top >= 4 ? "critical" : top >= 3 ? "high" : top >= 2 ? "medium" : top >= 1 ? "low" : "good";
  return { risk, issues };
}

/** Plain-text suggestions block, ready to copy into a message/report. */
export function wifiAdviceText(ap: WifiApInput, a: WifiAssessment): string {
  const lines = [
    `WiFi security review — ${ap.ssid || "(hidden)"} [${(ap.security || "?").toUpperCase()}${ap.cipher ? "/" + ap.cipher : ""}]`,
    `Overall risk: ${a.risk.toUpperCase()}`,
    "",
    ...a.issues.flatMap((i) => [
      `• [${i.severity.toUpperCase()}] ${i.title}`,
      `   ${i.detail}`,
      `   Fix: ${i.fix}`,
    ]),
  ];
  return lines.join("\n");
}
