// Deterministic correlation engine — the "brain without AI" and the core of the
// Target Knowledge Base. It works the way a human hunter does: accumulate facts
// about a target (endpoints, params, subdomains, tech, findings), then CONNECT
// them into relationships and a ranked list of LEADS — the next things worth
// looking at. No LLM, no API, no cost; pure + testable. The optional local model
// (Ollama) later reasons over these same facts, but the engine already hunts with
// purpose without it. See docs/ENGINE-EARNING-RESEARCH.md + the TKB design.

export type Fact =
  | { kind: "endpoint"; url: string }
  | { kind: "subdomain"; host: string; cname?: string; ip?: string; alive?: boolean }
  | { kind: "tech"; host: string; name: string }
  | { kind: "finding"; host: string; cls: string; title: string; confirmed?: boolean };

/** A discovered relationship between facts — the "dots connected". */
export type Relation = { kind: string; nodes: string[]; note: string };

/** A prioritized next-action. Higher priority = look here first. */
export type Lead = {
  title: string;
  target: string; // host or URL the lead is about
  cls: string; // vuln class the lead points at
  priority: number; // 0-100
  reason: string; // why this is worth testing (the correlation)
  suggest?: string; // a concrete next step / tool hint
};

// CNAME targets that are classically takeover-prone when the backing resource is
// unclaimed/dangling (a dead subdomain pointing here is often a payable takeover).
const TAKEOVER_CNAMES =
  /\b([a-z0-9-]+\.)?(github\.io|herokuapp\.com|herokudns\.com|s3\.amazonaws\.com|s3-website|cloudfront\.net|azurewebsites\.net|cloudapp\.net|trafficmanager\.net|blob\.core\.windows\.net|fastly\.net|pantheonsite\.io|wpengine\.com|ghost\.io|surge\.sh|bitbucket\.io|readthedocs\.io|netlify\.app|netlify\.com|zendesk\.com|helpscoutdocs\.com|statuspage\.io|launchrock\.com|unbounce\.com|desk\.com|shopify\.com|fastly|cargocollective\.com|readme\.io|akamaihd\.net|firebaseapp\.com)\b/i;

// Param names that carry object references → IDOR/BOLA surface (top payer).
// An object-ref param is a short id token, ends in `_id`, or is a known entity
// name optionally followed by "id" (user/userid/user_id). The old `.*id`
// catch-all also matched dictionary words ("valid", "paid", "grid", "void",
// "android") → spurious IDOR leads, so it's gone.
const ID_ENTITY =
  "user|users|account|acct|customer|member|owner|org|team|group|order|invoice|payment|doc|document|file|record|ticket|report|profile|product|item|post|comment|message|msg|page|node|object|entity|project|task|booking|reservation|transaction|txn|address|card|subscription";
const ID_PARAM = new RegExp(`^(id|uid|uuid|guid|gid|pid|oid|aid|rid|eid|tid|cid|nid|.*_id|(${ID_ENTITY})(id)?)$`, "i");
// Params that reach a URL fetch → SSRF / open redirect.
const SSRF_PARAM = /^(url|uri|link|next|redirect|redirect_uri|return|returnto|callback|dest|destination|target|to|out|continue|forward|feed|host|site|domain|webhook|proxy|fetch)$/i;
// Params that reach the filesystem → LFI / traversal.
const FILE_PARAM = /^(path|file|filename|filepath|template|page|include|load|read|download|attachment|doc)$/i;

function paramsOf(url: string): string[] {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return [...u.searchParams.keys()];
  } catch {
    return [];
  }
}
function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `http://${url}`).hostname.toLowerCase();
  } catch {
    return url.split("/")[0].toLowerCase();
  }
}
function pathShape(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return u.pathname
      .split("/")
      .map((s) => (/^([0-9]+|[0-9a-f]{8,}|[0-9a-f-]{16,})$/i.test(s) ? "{id}" : s))
      .join("/");
  } catch {
    return url;
  }
}

/**
 * Correlate accumulated facts into relationships + ranked leads. Pure: same facts
 * in → same result out. Leads are de-duplicated by (cls, target) keeping the
 * highest priority, and returned best-first.
 */
export function correlate(facts: Fact[]): { relations: Relation[]; leads: Lead[] } {
  const relations: Relation[] = [];
  const leads: Lead[] = [];
  const push = (l: Lead) => leads.push(l);

  const endpoints = facts.filter((f): f is Extract<Fact, { kind: "endpoint" }> => f.kind === "endpoint");
  const subdomains = facts.filter((f): f is Extract<Fact, { kind: "subdomain" }> => f.kind === "subdomain");
  const techs = facts.filter((f): f is Extract<Fact, { kind: "tech" }> => f.kind === "tech");
  const findings = facts.filter((f): f is Extract<Fact, { kind: "finding" }> => f.kind === "finding");

  // 1) Dangling-CNAME subdomain takeover — the most reliably-payable correlation.
  for (const s of subdomains) {
    if (s.cname && TAKEOVER_CNAMES.test(s.cname) && s.alive === false) {
      relations.push({ kind: "dangling-cname", nodes: [s.host, s.cname], note: "dead subdomain points at a takeover-prone provider" });
      push({
        title: `Possible subdomain takeover: ${s.host}`,
        target: s.host,
        cls: "takeover",
        priority: 95,
        reason: `${s.host} CNAMEs to ${s.cname} (takeover-prone) but does not resolve/serve — a classic dangling takeover.`,
        suggest: `nuclei -tags takeover -u ${s.host}; then claim the backing resource to prove it.`,
      });
    }
  }

  // 2) Shared-IP clusters across subdomains → pivot / same-app authz reuse.
  const byIp = new Map<string, string[]>();
  for (const s of subdomains) if (s.ip) byIp.set(s.ip, [...(byIp.get(s.ip) ?? []), s.host]);
  for (const [ip, hosts] of byIp) {
    if (hosts.length >= 2) {
      relations.push({ kind: "shared-ip", nodes: hosts, note: `share IP ${ip}` });
    }
  }

  // 3) Param reuse across endpoints → object-id params that recur are IDOR surface.
  const paramHosts = new Map<string, Set<string>>(); // param -> hosts seen on
  const paramUrls = new Map<string, Set<string>>(); // param -> distinct path shapes
  for (const e of endpoints) {
    const h = hostOf(e.url);
    for (const p of paramsOf(e.url)) {
      const key = p.toLowerCase();
      paramHosts.set(key, (paramHosts.get(key) ?? new Set()).add(h));
      paramUrls.set(key, (paramUrls.get(key) ?? new Set()).add(`${h}${pathShape(e.url)}`));
    }
  }
  for (const [p, shapes] of paramUrls) {
    if (ID_PARAM.test(p) && shapes.size >= 2) {
      relations.push({ kind: "param-reuse", nodes: [...shapes], note: `object-id param "${p}" used on ${shapes.size} endpoints` });
      push({
        title: `IDOR/BOLA candidate: object param "${p}" (${shapes.size} endpoints)`,
        target: [...(paramHosts.get(p) ?? [])][0] ?? p,
        cls: "idor",
        priority: 88,
        reason: `The object-reference param "${p}" recurs across ${shapes.size} endpoints — swap ids across two accounts to test object-level authorization.`,
        suggest: `Configure two accounts, then run the IDOR differential probe on these endpoints.`,
      });
    }
    if (SSRF_PARAM.test(p)) {
      push({
        title: `SSRF/redirect candidate: param "${p}"`,
        target: [...(paramHosts.get(p) ?? [])][0] ?? p,
        cls: "ssrf",
        priority: 80,
        reason: `The param "${p}" reaches a URL fetch/redirect — test SSRF (OAST) and open-redirect.`,
        suggest: `nuclei -dast -tags ssrf,redirect on these endpoints (OAST callback proves it).`,
      });
    }
    if (FILE_PARAM.test(p)) {
      push({
        title: `LFI/traversal candidate: param "${p}"`,
        target: [...(paramHosts.get(p) ?? [])][0] ?? p,
        cls: "lfi",
        priority: 72,
        reason: `The param "${p}" reaches the filesystem — test path traversal / LFI.`,
        suggest: `nuclei -dast -tags lfi,fileupload on these endpoints.`,
      });
    }
  }

  // 4) Tech stack → the classes that pay on it.
  for (const t of techs) {
    const n = t.name.toLowerCase();
    if (/graphql/.test(n)) push({ title: `GraphQL authz/introspection: ${t.host}`, target: t.host, cls: "graphql", priority: 78, reason: `GraphQL detected on ${t.host} — test introspection, field-level authz (IDOR), batching.`, suggest: `nuclei -tags graphql; then manual authz on sensitive queries.` });
    if (/wordpress|wp-/.test(n)) push({ title: `WordPress attack surface: ${t.host}`, target: t.host, cls: "cms", priority: 55, reason: `WordPress on ${t.host} — enumerate users/plugins for known vulns.`, suggest: `wpscan --enumerate u,vp,vt` });
    if (/\bs3\b|amazonaws/.test(n)) push({ title: `S3 bucket exposure: ${t.host}`, target: t.host, cls: "exposure", priority: 70, reason: `S3 reference on ${t.host} — test for a public/writable bucket.`, suggest: `Check bucket ACLs (read/list/write) for the referenced bucket.` });
    if (/jira|confluence|atlassian/.test(n)) push({ title: `Atlassian surface: ${t.host}`, target: t.host, cls: "cve", priority: 60, reason: `Atlassian product on ${t.host} — several high-impact CVEs; verify version.`, suggest: `nuclei -tags jira,confluence,atlassian` });
  }

  // 5) Finding clustering → attack chains (multiple issues on one host compound).
  const byHost = new Map<string, Extract<Fact, { kind: "finding" }>[]>();
  for (const f of findings) byHost.set(f.host, [...(byHost.get(f.host) ?? []), f]);
  for (const [h, fs] of byHost) {
    if (fs.length >= 3) {
      relations.push({ kind: "finding-cluster", nodes: [h], note: `${fs.length} findings on ${h}` });
      push({
        title: `Attack-chain candidate: ${fs.length} issues on ${h}`,
        target: h,
        cls: "chain",
        priority: 50 + Math.min(20, fs.length * 2),
        reason: `${h} has ${fs.length} findings (${[...new Set(fs.map((x) => x.cls))].join(", ")}) — chain them for higher impact.`,
      });
    }
  }

  // De-dup leads by (cls|target), keep the highest priority; sort best-first.
  const best = new Map<string, Lead>();
  for (const l of leads) {
    const k = `${l.cls}|${l.target}`;
    const cur = best.get(k);
    if (!cur || l.priority > cur.priority) best.set(k, l);
  }
  const ranked = [...best.values()].sort((a, b) => b.priority - a.priority);
  return { relations, leads: ranked };
}
