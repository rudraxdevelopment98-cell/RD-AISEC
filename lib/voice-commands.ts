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
  // A spoken status question ("what's running?", "how many critical findings?").
  // `speak` is a short filler; the component fetches live state and speaks the
  // real answer when it arrives.
  | { type: "query"; topic: QueryTopic; speak: string }
  | { type: "back"; speak: string }
  | { type: "help"; speak: string }
  | { type: "stop"; speak: string }
  // A conversational turn: the assistant asked something and is waiting for the
  // user's spoken answer (no wake word needed for the reply).
  | { type: "ask"; pending: Pending; speak: string }
  | { type: "none"; speak: string };

/** What the assistant is waiting to hear next, after asking a question. */
export type Pending =
  | { kind: "destination" } // "Where would you like to go?"
  | { kind: "scanTarget" } // "What should I scan?"
  | { kind: "confirmScan"; target: string }; // "Shall I start the scan? yes/no"

/** Live-state topics the assistant can look up and read aloud. */
export type QueryTopic = "summary" | "runners" | "jobs" | "findings" | "critical";

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
 * Detect a spoken status question and which live topic it's about. Returns null
 * when the text isn't a status query (so navigation/scan/search still run).
 * Ordered specific → general so "how many machines" beats the generic summary.
 */
export function detectQuery(text: string): QueryTopic | null {
  const t = normalize(text);

  // Machines / runners status.
  if (
    /\b(machines?|runners?|agents?|kali|boxes?)\b/.test(t) &&
    /\b(online|offline|status|up|down|connected|how many|available|ready|alive|working)\b/.test(t)
  )
    return "runners";
  if (/\b(is|are)\s+(my|the|any)\s+(machine|runner|kali|box|agent)/.test(t)) return "runners";

  // Critical findings specifically.
  if (/\bcritical\b/.test(t) && /\b(finding|vuln|vulnerabilit|issue|bug|any|how many|open)\b/.test(t))
    return "critical";
  if (/\bany\s+critical\b/.test(t)) return "critical";

  // Findings counts.
  if (/\b(how many|number of|count of|any|open)\b.*\b(finding|vuln|vulnerabilit|issue|bug)s?\b/.test(t))
    return "findings";
  if (/\b(finding|vuln|vulnerabilit)s?\b.*\b(count|status|open|total|do i have)\b/.test(t)) return "findings";

  // Jobs / scans running.
  if (
    /\bwhat(?:'?s| is)?\s+running\b/.test(t) ||
    /\b(anything|any (jobs?|scans?))\s+running\b/.test(t) ||
    /\b(how many|number of)\s+(jobs?|scans?)\b/.test(t) ||
    /\b(jobs?|scans?)\s+(running|queued|status|left|remaining)\b/.test(t) ||
    /\b(running|active|queued)\s+(jobs?|scans?)\b/.test(t) ||
    /\bscan\s+(status|queue)\b/.test(t)
  )
    return "jobs";

  // Overall summary / brief. Deliberately excludes bare nav words like "overview".
  if (
    /\b(brief( me)?|sitrep|rundown|summary|catch me up|status report|what(?:'?s| is)?\s+(going on|happening)|how (are things|is everything|are we doing)|give me (a|the) (status|rundown|summary))\b/.test(
      t,
    ) ||
    /^status$/.test(t)
  )
    return "summary";

  return null;
}

/**
 * Parse a (wake-word-stripped) command into an intent. `links` is the user's
 * allowed nav so we never route them somewhere they can't access.
 */
export function parseVoiceCommand(raw: string, links: NavLink[] = []): VoiceIntent {
  const text = normalize(raw);
  if (!text) return { type: "none", speak: "Sorry, I didn't quite catch that — could you say it again?" };

  // Warm greeting / just calling for attention → open the conversation.
  if (/^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening)|you there|are you (there|awake|up)|wake up|hey there)\b/.test(text) && wordCount(text) <= 4) {
    return { type: "ask", pending: { kind: "destination" }, speak: greet() };
  }

  // Stop / cancel listening.
  if (/^(stop( listening)?|cancel|never ?mind|quiet|shut up|that's all|thank you|thanks|bye|goodbye)\b/.test(text)) {
    return { type: "stop", speak: "Okay, I'll rest here. Just call me when you need me." };
  }

  // Help.
  if (/\b(help|what can (you|i) (do|say)|commands|how do i)\b/.test(text)) {
    return {
      type: "help",
      speak:
        "Happy to help. You can say things like: take me to findings, scan example dot com, search for cross site scripting, or go back. What would you like to do?",
    };
  }

  // Go back.
  if (/^(go back|back|previous( page)?|return)\b/.test(text)) {
    return { type: "back", speak: "Sure, going back." };
  }

  // Status question — the assistant looks up live state and reads it back.
  const topic = detectQuery(text);
  if (topic) {
    return { type: "query", topic, speak: "One moment — let me check." };
  }

  // Scan / recon a target.
  const scanM = text.match(/\b(scan|recon|assess|test|attack|start (a )?scan on|run (a )?scan on|run recon on)\b\s+(.*)$/);
  if (scanM) {
    const target = extractTarget(scanM[4] ?? "");
    if (target) return confirmScan(target);
    return { type: "ask", pending: { kind: "scanTarget" }, speak: "Of course — what's the target? For example, example dot com." };
  }

  // Search / find something.
  const searchM = text.match(/\b(search( for)?|find|look up|show me)\b\s+(.*)$/);
  if (searchM) {
    const q = (searchM[3] ?? "").trim();
    // "show me findings" is navigation, not a search — try to resolve first.
    const asDest = resolveDestination(q, links);
    if (asDest && /^show me\b/.test(text)) {
      return { type: "navigate", href: asDest.href, label: asDest.label, speak: `Sure — here's ${asDest.label}.` };
    }
    if (q) {
      return {
        type: "search",
        query: q,
        href: `/dashboard/findings?q=${encodeURIComponent(q)}`,
        speak: `Looking up ${q} in your findings.`,
      };
    }
  }

  // Navigate: "go to / open / navigate to / take me to <dest>".
  const navM = text.match(/^(go to|open|navigate to|take me to|show|jump to|visit|let's go to|i want to see)\s+(the\s+)?(.*)$/);
  const destText = navM ? navM[3] : text; // also allow a bare section name
  const dest = resolveDestination(destText, links);
  if (dest) {
    return { type: "navigate", href: dest.href, label: dest.label, speak: `Sure — opening ${dest.label} for you.` };
  }

  // Looked like a navigation request but we couldn't place it → ask, kindly.
  if (navM) {
    return {
      type: "ask",
      pending: { kind: "destination" },
      speak: "I'm not sure which section you mean. You could say findings, engagements, jobs, or bug bounty. Where would you like to go?",
    };
  }

  return {
    type: "none",
    speak: `Hmm, I didn't quite understand "${raw.trim()}". You can say things like "go to findings" or "scan example dot com". What would you like?`,
  };
}

// ── Conversational helpers ───────────────────────────────────────────────────

function wordCount(s: string): number {
  return s.split(" ").filter(Boolean).length;
}

/** A warm, friendly opener. Kept deterministic (no RNG) so it stays testable. */
function greet(): string {
  return "Hey, I'm right here. Where would you like to go, or what should I scan?";
}

/** Speak a host clearly ("example dot com" reads better than "example.com"). */
function spokenHost(target: string): string {
  return target.replace(/\./g, " dot ").replace(/-/g, " dash ");
}

function confirmScan(target: string): VoiceIntent {
  return {
    type: "ask",
    pending: { kind: "confirmScan", target },
    speak: `Got it — ${spokenHost(target)}. Shall I start the scan? Say yes or no.`,
  };
}

const YES = /\b(yes|yeah|yep|yup|sure|okay|ok|do it|go ahead|please|confirm|start|begin|absolutely|of course)\b/;
const NO = /\b(no|nope|nah|cancel|don't|do not|stop|wait|not now|never mind)\b/;

/**
 * Interpret the user's spoken answer to a pending question. Falls back to the
 * full command grammar so a fresh command mid-conversation still works.
 */
export function resolveFollowup(pending: Pending, raw: string, links: NavLink[] = []): VoiceIntent {
  const text = normalize(raw);
  if (!text) return { type: "ask", pending, speak: "Sorry, I didn't hear you — could you say that again?" };

  // Let the user bail out of any question.
  if (/^(stop|cancel|never ?mind|forget it|no thanks|leave it)\b/.test(text)) {
    return { type: "none", speak: "No problem, I'll leave it. Anything else?" };
  }

  switch (pending.kind) {
    case "confirmScan": {
      if (YES.test(text)) {
        return {
          type: "scan",
          target: pending.target,
          href: `/dashboard/scan?target=${encodeURIComponent(pending.target)}`,
          speak: `Great — starting the scan on ${spokenHost(pending.target)} now.`,
        };
      }
      if (NO.test(text)) return { type: "none", speak: "Okay, I won't start it. What else can I do?" };
      return { type: "ask", pending, speak: `Just say yes to scan ${spokenHost(pending.target)}, or no to skip it.` };
    }

    case "scanTarget": {
      const target = extractTarget(text);
      if (target) return confirmScan(target);
      // Maybe they changed their mind and gave a different command.
      const alt = parseVoiceCommand(text, links);
      if (alt.type !== "none") return alt;
      return { type: "ask", pending, speak: "I didn't catch a target. Try something like example dot com." };
    }

    case "destination": {
      // Strip filler like "let's go", "there", "to the".
      const cleaned = text.replace(/^(go|let's go|take me|i want to see|show me)?\s*(to|there|over there)?\s*(the\s+)?/, "").trim();
      const dest = resolveDestination(cleaned || text, links);
      if (dest) return { type: "navigate", href: dest.href, label: dest.label, speak: `Of course — opening ${dest.label}.` };
      // Fall back to the full grammar (so "scan example dot com" answers too).
      const alt = parseVoiceCommand(text, links);
      if (alt.type !== "none") return alt;
      return {
        type: "ask",
        pending,
        speak: "I didn't catch the section. You can say findings, engagements, jobs, machines, or bug bounty. Where to?",
      };
    }
  }
}
