// Two-account IDOR/BOLA scan — the orchestration layer around lib/idor-core.
//
// Flow:
//   1. buildIdorEndpoints(): from an engagement's findings, pick object-id URLs
//      worth testing (enumerable numeric ids on sensitive paths rank first).
//   2. The portal queues an "idorprobe" job carrying those endpoints; at serve
//      time it injects account A's + account B's session headers (decrypted, TLS
//      only — see app/api/runner/job).
//   3. The runner replays each endpoint as A (owner), B (attacker), and anon, and
//      reports ONLY status + body length + a marker-present boolean per identity —
//      so account A's actual data never transits back to the portal.
//   4. parseIdorResult() feeds those into idor-core.assessAccess() → findings.
//
// Pure (no IO); the server action / job-parser call these. Authorized testing only.

import { assessAccess, prioritizeForIdor, type Resp } from "@/lib/idor-core";
import { extractEndpoints } from "@/lib/recon-extract";

export const IDOR_TOOL = "idorprobe";
const MAX_ENDPOINTS = 40; // keep a replay job bounded (3 requests each)

export type IdorEndpoint = { method: string; url: string };

/** Pull candidate object-id endpoints out of an engagement's findings. Uses the
 *  recon-extract miner (resolves relative paths, drops assets), dedupes by URL,
 *  keeps only URLs with a testable object reference, ranks enumerable numeric ids
 *  on sensitive paths first, and caps the count so the replay stays bounded. */
export function buildIdorEndpoints(
  findings: { title?: string | null; description?: string | null }[],
): IdorEndpoint[] {
  const urls = new Set<string>();
  for (const f of findings) {
    // Per-finding so relative paths resolve against that finding's own host.
    for (const u of extractEndpoints(`${f.title ?? ""}\n${f.description ?? ""}`)) urls.add(u);
  }
  const ranked = prioritizeForIdor([...urls].map((url) => ({ endpoint: `GET ${url}`, url })));
  const out: IdorEndpoint[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    out.push({ method: "GET", url: r.url });
    if (out.length >= MAX_ENDPOINTS) break;
  }
  return out;
}

// ── Runner result shape (compact on purpose — no bodies, only signals) ───────
// { probes: [ { ep, o:{s,n,m,d,h}, a:{...}, x?:{...} } ] }
//   ep = "GET <url>";  s=status, n=body length, m=owner-marker present,
//   d=looks like a login/denied page, h=short hash of the normalized body
type Identity = { s?: unknown; n?: unknown; m?: unknown; d?: unknown; h?: unknown };
type RawProbe = { ep?: unknown; o?: Identity; a?: Identity; x?: Identity };

function toResp(id: Identity | undefined, marker: string): Resp | undefined {
  if (!id || typeof id.s !== "number") return undefined;
  const hasMarker = id.m === true;
  return {
    status: id.s,
    bodyLen: typeof id.n === "number" ? id.n : 0,
    // Reconstruct just enough for idor-core: the marker string iff the runner saw
    // it. The actual owner data is never shipped — only this boolean.
    body: hasMarker ? marker : undefined,
    contentType: "application/json",
    bodyHash: typeof id.h === "string" ? id.h : undefined,
    deniedLooking: id.d === true,
  };
}

export type IdorFinding = {
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  description: string;
  evidence: string;
};

/** Parse the runner's idorprobe output into confirmed/suspected access findings.
 *  With no marker configured, only same-shape successes surface (high/suspected);
 *  a marker enables confirmed-critical proof that B/anon received A's data. */
export function parseIdorResult(output: string, marker = ""): IdorFinding[] {
  let parsed: { probes?: RawProbe[] };
  try {
    parsed = JSON.parse(output);
  } catch {
    return [];
  }
  const probes = Array.isArray(parsed.probes) ? parsed.probes : [];
  const findings: IdorFinding[] = [];
  for (const p of probes) {
    const ep = typeof p.ep === "string" ? p.ep : "";
    if (!ep) continue;
    const owner = toResp(p.o, marker);
    const attacker = toResp(p.a, marker);
    if (!owner || !attacker) continue;
    const v = assessAccess({ endpoint: ep, owner, attacker, anon: toResp(p.x, marker), ownerMarker: marker || undefined });
    if (v.verdict !== "bola" && v.verdict !== "unauth") continue; // only real access breaks become findings
    const label = v.verdict === "unauth" ? "Unauthenticated object access" : "IDOR / BOLA (broken object-level authorization)";
    findings.push({
      title: `${label}: ${ep}`,
      severity: v.severity,
      description:
        `${v.reasons.join(" ")}\n\n` +
        `Method: differential access test (owner vs. ${v.verdict === "unauth" ? "anonymous" : "second account"}). ` +
        `Confidence ${v.confidence}%.`,
      evidence: ep,
    });
  }
  return findings;
}
