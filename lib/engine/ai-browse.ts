/**
 * AI browsing for authorized recon — "give the engine's AI eyes on the target".
 *
 * A bounded Claude tool-use loop that can FETCH pages within an engagement's
 * authorized scope, read them, and return a structured recon brief: what the app
 * appears to do, its tech signals, likely-sensitive endpoints, a guess at the
 * auth model, and a prioritized list of what to test + which engine tools to run.
 *
 * Safety is layered and non-negotiable:
 *   - KEY-GATED: does nothing (costs nothing) unless ANTHROPIC_API_KEY is set.
 *   - SCOPE-GATED: only URLs whose host is in the engagement's `scope` are
 *     fetchable, and only when the engagement is marked `authorized`.
 *   - SSRF-GUARDED: http/https only; the resolved IP of every host (and every
 *     redirect hop) must be public — private / loopback / link-local / cloud-
 *     metadata ranges are refused even for an in-scope hostname.
 *   - BOUNDED: capped fetches, capped bytes, capped model turns, hard timeout.
 *
 * The model never runs commands or touches the target beyond plain GET reads;
 * exploitation stays in the human-gated engine pipeline.
 */

import dns from "node:dns/promises";
import net from "node:net";

export type SuggestedTest = { title: string; why: string };

export type ReconBrief = {
  enabled: boolean;
  /** Set when we couldn't run (no key, not authorized, no scope, model error). */
  error?: string;
  summary: string;
  techStack: string[];
  sensitiveEndpoints: string[];
  authModel: string;
  suggestedTests: SuggestedTest[];
  /** Engine tool ids the AI recommends running next (free-form; UI maps known ones). */
  suggestedTools: string[];
  /** In-scope URLs the AI actually read, for transparency. */
  pagesFetched: string[];
};

const MODEL = process.env.AI_BROWSE_MODEL || "claude-sonnet-5";
const MAX_FETCHES = 6;
const MAX_TURNS = 8;
const MAX_BYTES = 400_000; // stop reading a page past this
const MAX_TEXT = 12_000; // chars of extracted text handed to the model per page
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function disabled(error: string): ReconBrief {
  return {
    enabled: false,
    error,
    summary: "",
    techStack: [],
    sensitiveEndpoints: [],
    authModel: "",
    suggestedTests: [],
    suggestedTools: [],
    pagesFetched: [],
  };
}

/** Parse hostnames from a free-form scope blob (URLs, bare domains, `*.x`, one per line/comma). */
export function scopeHosts(scope: string): string[] {
  const out = new Set<string>();
  for (const raw of scope.split(/[\s,]+/)) {
    let t = raw.trim().toLowerCase();
    if (!t) continue;
    if (/\/\d{1,3}$/.test(t) && !t.includes("://")) continue; // CIDR (e.g. 10.0.0.0/24)
    t = t.replace(/^\*+\./, "").replace(/^\.+/, ""); // *.example.com / .example.com → example.com
    if (t.includes("://")) {
      try {
        t = new URL(t).hostname;
      } catch {
        continue;
      }
    } else {
      t = t.split("/")[0].split(":")[0]; // strip any path/port on a bare host
    }
    // Domain hosts only — bare IPs/CIDRs are handled by the scan tools, not the
    // browser (and SSRF-guarded regardless). Keep dotted names with letters.
    if (!t || t.includes("*") || t.includes("/")) continue;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) continue; // bare IPv4
    if (/^[a-z0-9.-]+$/.test(t) && t.includes(".") && /[a-z]/.test(t)) out.add(t);
  }
  return [...out];
}

/** A fetch host is in scope if it equals, or is a subdomain of, a scope host. */
export function hostInScope(host: string, hosts: string[]): boolean {
  const h = host.toLowerCase();
  return hosts.some((s) => h === s || h.endsWith("." + s));
}

/** Reject private / reserved / loopback / link-local / cloud-metadata IPs (v4 + v6). */
export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
    const [a, b] = p;
    if (a === 10) return false; // 10/8
    if (a === 127) return false; // loopback
    if (a === 0) return false; // "this" network
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12
    if (a === 192 && b === 168) return false; // 192.168/16
    if (a === 169 && b === 254) return false; // link-local + 169.254.169.254 metadata
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
    if (a >= 224) return false; // multicast + reserved (224/4, 240/4)
    return true;
  }
  if (net.isIPv6(ip)) {
    let x = ip.toLowerCase();
    if (x === "::1" || x === "::") return false; // loopback / unspecified
    // IPv4-mapped (::ffff:a.b.c.d) → judge by the embedded v4.
    const m = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPublicIp(m[1]);
    if (x.startsWith("fe80")) return false; // link-local
    const hi = parseInt(x.split(":")[0] || "0", 16);
    if ((hi & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    return true;
  }
  return false;
}

/** Every address a host resolves to must be public — else it's an SSRF target. */
async function hostResolvesPublic(host: string): Promise<boolean> {
  if (net.isIP(host)) return isPublicIp(host);
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    return false;
  }
  return addrs.length > 0 && addrs.every((a) => isPublicIp(a.address));
}

/** Strip HTML to readable text (drop scripts/styles, collapse tags + whitespace). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type FetchResult = { ok: true; url: string; status: number; text: string } | { ok: false; error: string };

/** SSRF-safe, scope-gated GET with manual redirect re-validation. */
async function safeFetch(rawUrl: string, hosts: string[], hops = 0): Promise<FetchResult> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, error: "not a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "only http/https URLs are allowed" };
  }
  if (!hostInScope(u.hostname, hosts)) {
    return { ok: false, error: `host ${u.hostname} is out of the authorized scope` };
  }
  if (!(await hostResolvesPublic(u.hostname))) {
    return { ok: false, error: `host ${u.hostname} resolves to a non-public address (refused)` };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": "RD-AISEC-Recon/1.0 (+authorized-testing)", Accept: "text/html,*/*" },
    });

    // Re-validate redirects against scope + SSRF (never blindly follow).
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, error: `redirect with no location (${res.status})` };
      if (hops >= MAX_REDIRECTS) return { ok: false, error: "too many redirects" };
      const next = new URL(loc, u).toString();
      return safeFetch(next, hosts, hops + 1);
    }

    const ct = res.headers.get("content-type") || "";
    const reader = res.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          if (received >= MAX_BYTES) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    const body = buf.toString("utf8");
    const text = ct.includes("html") ? htmlToText(body) : body;
    return { ok: true, url: u.toString(), status: res.status, text: text.slice(0, MAX_TEXT) };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${(e as Error).message}` };
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = [
  "You are a reconnaissance analyst for AUTHORIZED penetration testing. You are given",
  "an engagement whose scope lists hosts the operator is explicitly permitted to test.",
  "Use the fetch_url tool to READ in-scope pages (plain GET only — you cannot log in,",
  "submit forms, or exploit anything). Start from the main scope URLs, then follow",
  "links you see in the returned text that stay in scope. After a few reads, call",
  "submit_brief exactly once with your findings. Be concrete and specific to what you",
  "actually saw — do not invent endpoints or technologies. Suggested tests should map",
  "to the kinds of bugs this app is likely to have; suggested tools should be ids from",
  "the engine's catalog (e.g. nuclei, katana, arjun, dalfox, sqlmap, ffuf, wpscan).",
].join(" ");

const FETCH_TOOL = {
  name: "fetch_url",
  description: "GET an in-scope URL and return its readable text. Out-of-scope or non-public hosts are refused.",
  input_schema: {
    type: "object" as const,
    properties: { url: { type: "string", description: "Absolute http(s) URL within the authorized scope." } },
    required: ["url"],
  },
};

const BRIEF_TOOL = {
  name: "submit_brief",
  description: "Return the final structured recon brief. Call this exactly once when done reading.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "2-4 sentences: what this app appears to be and do." },
      techStack: { type: "array", items: { type: "string" }, description: "Frameworks/servers/CMS/libraries you saw signals of." },
      sensitiveEndpoints: { type: "array", items: { type: "string" }, description: "Paths/URLs worth testing (login, admin, api, upload, id-bearing)." },
      authModel: { type: "string", description: "Best guess at how auth works (cookie session, JWT, SSO, none observed)." },
      suggestedTests: {
        type: "array",
        items: { type: "object", properties: { title: { type: "string" }, why: { type: "string" } }, required: ["title", "why"] },
        description: "Prioritized things to test and the reason each is plausible here.",
      },
      suggestedTools: { type: "array", items: { type: "string" }, description: "Engine tool ids to run next." },
    },
    required: ["summary", "suggestedTests"],
  },
};

/**
 * Run the AI browse loop for an engagement. Caller is responsible for authZ
 * (owner check); this enforces authorized + scope + key gating and returns a
 * structured brief (or a disabled/error brief that the UI can render plainly).
 */
export async function aiReconBrief(engagement: {
  name: string;
  scope: string;
  authorized: boolean;
}): Promise<ReconBrief> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return disabled("AI browsing is off. Set ANTHROPIC_API_KEY in the server environment to enable it.");
  }
  if (!engagement.authorized) {
    return disabled("Record written authorization on the engagement before running AI recon.");
  }
  const hosts = scopeHosts(engagement.scope);
  if (hosts.length === 0) {
    return disabled("No in-scope hosts found on this engagement. Add scope (one host/URL per line) first.");
  }

  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
  } catch {
    return disabled("The @anthropic-ai/sdk package isn't installed on the server.");
  }
  const client = new Anthropic();

  const seedUrls = hosts.slice(0, 3).map((h) => `https://${h}/`);
  const messages: import("@anthropic-ai/sdk").Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Engagement: ${engagement.name}\n` +
        `In-scope hosts: ${hosts.join(", ")}\n` +
        `Start by fetching these: ${seedUrls.join(", ")}\n` +
        `Read a few in-scope pages, then submit_brief.`,
    },
  ];

  const pagesFetched: string[] = [];
  let fetches = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res: import("@anthropic-ai/sdk").Anthropic.Message;
    try {
      res = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM,
        tools: [FETCH_TOOL, BRIEF_TOOL],
        messages,
      });
    } catch (e) {
      return disabled(`AI request failed: ${(e as Error).message}`);
    }

    const toolUses = res.content.filter((b): b is import("@anthropic-ai/sdk").Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break; // model stopped without a brief

    // Did it submit the brief? That's the terminal state.
    const brief = toolUses.find((t) => t.name === "submit_brief");
    if (brief) {
      const inp = brief.input as Record<string, unknown>;
      return {
        enabled: true,
        summary: String(inp.summary || ""),
        techStack: asStrArray(inp.techStack),
        sensitiveEndpoints: asStrArray(inp.sensitiveEndpoints),
        authModel: String(inp.authModel || ""),
        suggestedTests: asTestArray(inp.suggestedTests),
        suggestedTools: asStrArray(inp.suggestedTools),
        pagesFetched,
      };
    }

    // Otherwise service the fetch_url calls and loop.
    messages.push({ role: "assistant", content: res.content });
    const results: import("@anthropic-ai/sdk").Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (tu.name !== "fetch_url") {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "unknown tool", is_error: true });
        continue;
      }
      const url = String((tu.input as { url?: unknown }).url || "");
      if (fetches >= MAX_FETCHES) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: "fetch budget exhausted — submit_brief now.", is_error: true });
        continue;
      }
      fetches++;
      const r = await safeFetch(url, hosts);
      if (r.ok) {
        pagesFetched.push(r.url);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: `[${r.status}] ${r.url}\n\n${r.text}` });
      } else {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.error, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return disabled("The AI finished without producing a brief. Try again, or narrow the scope.");
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 30) : [];
}
function asTestArray(v: unknown): SuggestedTest[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      return { title: String(o.title || ""), why: String(o.why || "") };
    })
    .filter((t) => t.title)
    .slice(0, 20);
}
