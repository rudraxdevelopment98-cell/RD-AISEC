// Voice Command Center — pure, testable intent parser (no DOM, no speech APIs).
//
// The browser component captures a spoken transcript with the Web Speech API and
// hands the raw text here; this module turns it into a structured intent the UI
// can execute (navigate, scan, search…) and a short line to speak back. Keeping
// it pure means the whole grammar is unit-testable without a microphone.
//
// Fully self-contained: no cloud speech service, no API key — recognition and
// speech synthesis both run in the browser.

export type NavLink = { label: string; href: string; section?: string };

export type VoiceIntent =
  | { type: "navigate"; href: string; label: string; speak: string }
  | { type: "scan"; target: string; href: string; speak: string }
  | { type: "search"; query: string; href: string; speak: string }
  | { type: "back"; speak: string }
  | { type: "help"; speak: string }
  | { type: "stop"; speak: string }
  | { type: "none"; speak: string };

/** Default wake word — ties into the project's "Shiva" identity. */
export const WAKE_WORD = "shiva";

/** Does a transcript contain the wake word (with common mis-hears)? */
export function hasWakeWord(transcript: string, wake: string = WAKE_WORD): boolean {
  const t = normalize(transcript);
  const w = wake.toLowerCase();
  // Accept the exact word plus a few reliable mishears of "shiva".
  const variants = w === "shiva" ? [w, "shiv", "sheva", "shizza", "sheila", "siva"] : [w];
  return variants.some((v) => new RegExp(`\\b${escapeRe(v)}\\b`).test(t));
}

/** Strip the wake word (and a leading "hey"/"ok") off the front of a command. */
export function stripWake(transcript: string, wake: string = WAKE_WORD): string {
  return normalize(transcript)
    .replace(new RegExp(`^(hey|ok|okay|yo)\\s+`, "i"), "")
    .replace(new RegExp(`\\b(${escapeRe(wake)}|shiv|sheva|siva|sheila)\\b[,\\.]?\\s*`, "i"), "")
    .trim();
}

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Spoken domains come through as "example dot com" / "one nine two dot one…".
// Reconstruct a host/URL from the dictated words.
function extractTarget(text: string): string {
  let t = text
    .replace(/\bhttps?\b\s*(colon)?\s*(slash slash|double slash)?/gi, "")
    .replace(/\bdot\b/gi, ".")
    .replace(/\bdash\b|\bhyphen\b/gi, "-")
    .replace(/\bcolon\b/gi, ":")
    .replace(/\bslash\b/gi, "/")
    .replace(/\bunderscore\b/gi, "_")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  // Prefer an explicit domain/IP token if present.
  const host = t.match(/\b(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})\b/i);
  if (host) return host[0].toLowerCase();
  // Fallback: a bare word the user may want scanned (single token, no spaces).
  const bare = t.split(" ").find((w) => /^[a-z0-9][a-z0-9.-]*$/i.test(w));
  return bare ? bare.toLowerCase() : "";
}

// Section aliases → nav href. Data-driven matching also runs against link labels,
// but these cover the natural spoken names ("bugs", "home", "machines"…).
const ALIASES: { words: string[]; href: string; label: string }[] = [
  { words: ["home", "dashboard", "overview", "start"], href: "/dashboard", label: "Dashboard" },
  { words: ["bugs", "findings", "vulnerabilities", "issues"], href: "/dashboard/findings", label: "Findings" },
  { words: ["bug bounty", "bounty", "programs"], href: "/dashboard/bugbounty", label: "Bug Bounty" },
  { words: ["engagements", "engagement", "targets"], href: "/dashboard/engagements", label: "Engagements" },
  { words: ["exploit", "exploitation", "attacks"], href: "/dashboard/exploit", label: "Exploitation" },
  { words: ["lab", "exploit lab", "playground"], href: "/dashboard/lab", label: "Exploit Lab" },
  { words: ["jobs", "scans", "queue", "tasks"], href: "/dashboard/jobs", label: "Jobs" },
  { words: ["auto scan", "scanner", "scanning"], href: "/dashboard/scan", label: "Auto Scan" },
  { words: ["network", "network map", "map"], href: "/dashboard/network", label: "Network Map" },
  { words: ["wifi", "wireless", "wi-fi"], href: "/dashboard/wifi", label: "WiFi" },
  { words: ["machines", "runners", "agents"], href: "/dashboard/runners", label: "Machines" },
  { words: ["pentest", "penetration testing", "pen test"], href: "/dashboard/pentest", label: "Penetration Testing" },
  { words: ["forensics", "digital forensics"], href: "/dashboard/forensics", label: "Digital Forensics" },
  { words: ["consulting", "advisory"], href: "/dashboard/consulting", label: "Security Consulting" },
  { words: ["analytics", "stats", "metrics"], href: "/dashboard/analytics", label: "Analytics" },
  { words: ["assistant", "ai assistant", "ai"], href: "/dashboard/assistant", label: "AI Assistant" },
  { words: ["knowledge", "library", "docs"], href: "/dashboard/knowledge", label: "Knowledge Library" },
  { words: ["tools", "tool catalog"], href: "/dashboard/tools", label: "Tool Catalog" },
  { words: ["shiva", "mcp", "mcp security"], href: "/dashboard/shiva", label: "Shiva" },
  { words: ["settings", "config", "preferences"], href: "/dashboard/settings", label: "Settings" },
  { words: ["members", "team", "users"], href: "/dashboard/members", label: "Members" },
  { words: ["siem", "activity", "logs"], href: "/dashboard/siem", label: "SIEM · Activity" },
  { words: ["import", "burp"], href: "/dashboard/import", label: "Import (Burp)" },
  { words: ["history", "monitoring"], href: "/dashboard/history", label: "Monitoring" },
];

/** Resolve a spoken destination to an allowed nav link (aliases + labels). */
function resolveDestination(dest: string, links: NavLink[]): NavLink | null {
  const d = normalize(dest);
  if (!d) return null;
  const allowed = new Set(links.map((l) => l.href));
  // 1) Alias table (longest phrase first so "bug bounty" beats "bounty").
  const aliasHit = [...ALIASES]
    .sort((a, b) => Math.max(...b.words.map((w) => w.length)) - Math.max(...a.words.map((w) => w.length)))
    .find((a) => a.words.some((w) => d === w || d.includes(w)));
  if (aliasHit && (allowed.size === 0 || allowed.has(aliasHit.href))) {
    return { href: aliasHit.href, label: aliasHit.label };
  }
  // 2) Direct label match against the user's own nav.
  const byLabel = links.find((l) => {
    const lbl = l.label.toLowerCase();
    return d === lbl || d.includes(lbl) || lbl.includes(d);
  });
  return byLabel ?? null;
}

/**
 * Parse a (wake-word-stripped) command into an intent. `links` is the user's
 * allowed nav so we never route them somewhere they can't access.
 */
export function parseVoiceCommand(raw: string, links: NavLink[] = []): VoiceIntent {
  const text = normalize(raw);
  if (!text) return { type: "none", speak: "I didn't catch that." };

  // Stop / cancel listening.
  if (/^(stop( listening)?|cancel|never mind|nevermind|quiet|shut up|thanks?)\b/.test(text)) {
    return { type: "stop", speak: "Standing by." };
  }

  // Help.
  if (/\b(help|what can (you|i) (do|say)|commands|how do i)\b/.test(text)) {
    return {
      type: "help",
      speak:
        "Try: go to findings, scan example dot com, search for cross site scripting, go back, or stop listening.",
    };
  }

  // Go back.
  if (/^(go back|back|previous( page)?|return)\b/.test(text)) {
    return { type: "back", speak: "Going back." };
  }

  // Scan / recon a target.
  const scanM = text.match(/\b(scan|recon|assess|test|attack|start (a )?scan on|run (a )?scan on|run recon on)\b\s+(.*)$/);
  if (scanM) {
    const target = extractTarget(scanM[4] ?? "");
    if (target) {
      return {
        type: "scan",
        target,
        href: `/dashboard/scan?target=${encodeURIComponent(target)}`,
        speak: `Opening a scan for ${target.replace(/\./g, " dot ")}.`,
      };
    }
    return { type: "none", speak: "Which target should I scan? Say, scan example dot com." };
  }

  // Search / find something.
  const searchM = text.match(/\b(search( for)?|find|look up|show me)\b\s+(.*)$/);
  if (searchM) {
    const q = (searchM[3] ?? "").trim();
    // "show me findings" is navigation, not a search — try to resolve first.
    const asDest = resolveDestination(q, links);
    if (asDest && /^show me\b/.test(text)) {
      return { type: "navigate", href: asDest.href, label: asDest.label, speak: `Opening ${asDest.label}.` };
    }
    if (q) {
      return {
        type: "search",
        query: q,
        href: `/dashboard/findings?q=${encodeURIComponent(q)}`,
        speak: `Searching findings for ${q}.`,
      };
    }
  }

  // Navigate: "go to / open / navigate to / take me to <dest>".
  const navM = text.match(/^(go to|open|navigate to|take me to|show|jump to|visit)\s+(the\s+)?(.*)$/);
  const destText = navM ? navM[3] : text; // also allow a bare section name
  const dest = resolveDestination(destText, links);
  if (dest) {
    return { type: "navigate", href: dest.href, label: dest.label, speak: `Opening ${dest.label}.` };
  }

  return {
    type: "none",
    speak: `I didn't understand "${raw.trim()}". Say help for a list of commands.`,
  };
}
