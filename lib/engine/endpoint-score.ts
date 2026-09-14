/**
 * Endpoint prioritization (P3) — spend scan/validate budget where bugs pay.
 *
 * A crawl finds hundreds of URLs; scanning all of them wastes runner time and
 * mostly returns nothing. This scores each endpoint by ATTACKABLE VALUE — the
 * signals that correlate with payable classes (IDOR object ids, SSRF/redirect
 * params, file/template params, auth/admin/api surface) — so the pipeline scans
 * the top ones first (XBOW-style target scoring). Pure + testable.
 * See docs/ENGINE-EARNING-RESEARCH.md.
 */

// Param-name signals → the bug class they open + weight.
const PARAM_SIGNALS: { re: RegExp; w: number }[] = [
  { re: /^(id|uid|uuid|gid|pid|oid|.*_id|.*id)$/i, w: 30 }, // object ids → IDOR/BOLA (top payer)
  { re: /^(user|users|account|acct|customer|member|org|team|company|profile)$/i, w: 28 },
  { re: /^(order|invoice|payment|txn|transaction|doc|document|file|record|ticket|report)$/i, w: 26 },
  { re: /^(url|uri|link|next|redirect|redirect_uri|return|returnto|callback|dest|destination|target|to|out|continue|forward)$/i, w: 26 }, // SSRF / open-redirect
  { re: /^(path|file|filename|filepath|template|page|include|doc|load|read|download|attachment)$/i, w: 24 }, // LFI/traversal/SSTI
  { re: /^(q|s|search|query|keyword|term|name|title|comment|message|body|content|desc|description)$/i, w: 14 }, // XSS/injection reflected
  { re: /^(cmd|exec|command|run|action|func|call|method|op|operation)$/i, w: 22 }, // cmdi/logic
  { re: /^(token|key|secret|apikey|api_key|access_token|auth|session|jwt)$/i, w: 20 }, // auth-material handling
  { re: /^(admin|debug|test|internal|role|is_admin|priv|permission)$/i, w: 24 }, // access-control
];

// Path-segment signals.
const PATH_SIGNALS: { re: RegExp; w: number }[] = [
  { re: /\/(admin|administrator|manage|management|internal|backend|console)(\/|$)/i, w: 22 },
  { re: /\/(api|v[0-9]+|rest|graphql|gql)(\/|$)/i, w: 16 },
  { re: /\/(account|user|users|profile|settings|billing|payment|orders?|invoices?)(\/|$)/i, w: 16 },
  { re: /\/(upload|import|export|file|download|attachment|media)(\/|$)/i, w: 18 },
  { re: /\/(login|logout|auth|oauth|sso|reset|forgot|password|token|verify|register|signup)(\/|$)/i, w: 12 },
  { re: /\/(graphql|gql)(\/|$)/i, w: 8 }, // extra nudge for graphql
  { re: /\/(redirect|goto|out|link|proxy|fetch|webhook)(\/|$)/i, w: 18 },
];

// Numeric / uuid path segment → likely a direct object reference (IDOR).
const ID_SEGMENT = /\/([0-9]{1,12}|[0-9a-f]{8,}|[0-9a-f-]{16,})(\/|$)/i;

export function scoreEndpoint(rawUrl: string): number {
  let u: URL;
  try {
    u = new URL(rawUrl.includes("://") ? rawUrl : `http://${rawUrl}`);
  } catch {
    return 0;
  }
  let score = 5; // base: it's a reachable endpoint
  const path = u.pathname;

  // Parameters — the primary injection/authorization surface.
  const keys = [...u.searchParams.keys()];
  score += Math.min(12, keys.length * 3); // more inputs = more surface (capped)
  for (const k of keys) {
    for (const s of PARAM_SIGNALS) {
      if (s.re.test(k)) {
        score += s.w;
        break;
      }
    }
  }

  // Path signals.
  for (const s of PATH_SIGNALS) if (s.re.test(path)) score += s.w;
  if (ID_SEGMENT.test(path)) score += 24; // /orders/1001 → IDOR surface even without a query

  // Non-GET-looking extensions (static assets) are low value.
  if (/\.(png|jpe?g|gif|svg|ico|css|woff2?|ttf|eot|map|mp4|webp|pdf)$/i.test(path)) score = Math.round(score * 0.15);

  return Math.max(0, Math.min(100, score));
}

/** Rank endpoints best-first by attackable value. Ties keep input order (stable). */
export function rankEndpoints(urls: string[]): string[] {
  return urls
    .map((u, i) => ({ u, i, s: scoreEndpoint(u) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.u);
}
