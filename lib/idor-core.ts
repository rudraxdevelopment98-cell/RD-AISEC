// IDOR / BOLA differential-access engine (pure, no IO — unit-tested).
//
// The single most valuable bug class that a normal scanner CANNOT find: broken
// object-level authorization. A leaked record still returns a clean 200, so a
// single-session scan sees nothing. The only way to find it is DIFFERENTIAL —
// replay the SAME object request across identities and compare:
//
//   owner    (account A)     → A's own object      → should SUCCEED  (baseline)
//   attacker (account B)     → A's object          → should be DENIED
//   anon     (no session)    → A's object          → should be DENIED
//
// If account B (or anon) gets A's object back, that's a BOLA/IDOR. This module is
// the decision core: given the three responses (and, ideally, a marker unique to
// A's data), it returns a verdict + severity + confidence + human reasons. It does
// NOT make requests — the runner replays; this stays pure so it's testable and
// client-safe. For AUTHORIZED testing only.

export type Resp = {
  status: number;
  bodyLen: number;
  /** Optional body text — enables the strongest, lowest-false-positive check. */
  body?: string | null;
  contentType?: string | null;
  /** Short hash of the (whitespace-normalized) body. If the attacker's hash equals
   *  the owner's, they received the byte-identical object — definitive BOLA, even
   *  without a marker. */
  bodyHash?: string | null;
  /** The response LOOKS like a denial/login page (contains "sign in", "forbidden",
   *  "unauthorized", …) even if the status was 200 — the classic soft-deny that a
   *  status/length check misreads as access. */
  deniedLooking?: boolean;
};

export type AccessProbe = {
  /** The request under test, e.g. "GET /api/orders/1001". */
  endpoint: string;
  /** account A → A's own object. The control: establishes what success looks like. */
  owner: Resp;
  /** account B → A's object. Should be denied; success ⇒ BOLA. */
  attacker: Resp;
  /** no session → A's object. Should be denied; success ⇒ unauth object access. */
  anon?: Resp;
  /**
   * A string that appears ONLY in account A's data (A's email, account id, an
   * order token…). If it shows up in the attacker/anon body, that is definitive
   * proof they received A's object — the highest-confidence, zero-FP signal.
   */
  ownerMarker?: string;
};

export type AccessVerdict = {
  verdict: "bola" | "unauth" | "safe" | "inconclusive";
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: number; // 0..100
  reasons: string[];
};

const SUCCESS = (s: number) => s >= 200 && s < 300;
// A response that clearly denies access (used to confirm the fix / rule out FPs).
const DENIED = (s: number) => s === 401 || s === 403 || s === 404 || (s >= 300 && s < 400);

// Sensitive resource hints in the path → bump severity (an exposed invoice/account
// is worse than an exposed avatar).
const SENSITIVE = /\b(account|admin|order|invoice|payment|billing|card|ssn|user|profile|message|dm|token|secret|export|report|document|file|download|api[_-]?key)\b/i;

/** Bodies "look alike" — both succeeded and their sizes are within ~20%. Weak on
 *  its own (dynamic content), so it never CONFIRMS without a corroborating signal. */
function similarSize(a: Resp, b: Resp): boolean {
  if (!SUCCESS(a.status) || !SUCCESS(b.status)) return false;
  const la = Math.max(1, a.bodyLen), lb = Math.max(1, b.bodyLen);
  const ratio = Math.min(la, lb) / Math.max(la, lb);
  return ratio >= 0.8;
}

/** The marker unique to A's data appears in the other identity's response body. */
function leaksMarker(other: Resp, marker?: string): boolean {
  if (!marker || !other.body) return false;
  const m = marker.trim();
  return m.length >= 4 && other.body.includes(m);
}

function bump(sev: AccessVerdict["severity"], endpoint: string): AccessVerdict["severity"] {
  if (SENSITIVE.test(endpoint) && sev === "high") return "critical";
  return sev;
}

/**
 * Assess one differential probe. Conservative by design: a bare 200 from the
 * attacker is only "suspected" (it could be the attacker's OWN object); a CONFIRMED
 * BOLA requires the owner-data marker, or a same-shape success plus a JSON/data body.
 */
export function assessAccess(p: AccessProbe): AccessVerdict {
  const reasons: string[] = [];

  // 1. Baseline sanity: the owner must actually be able to fetch the object, or we
  //    have nothing to compare against.
  if (!SUCCESS(p.owner.status)) {
    return {
      verdict: "inconclusive",
      severity: "info",
      confidence: 10,
      reasons: [`No baseline: the owner request returned ${p.owner.status}, so there's no "authorized success" to compare against.`],
    };
  }

  const isData = /json|xml|csv|octet-stream/i.test(p.attacker.contentType ?? "") || /json|xml|csv/i.test(p.owner.contentType ?? "");
  const sameHash = (a: Resp, b: Resp) => !!a.bodyHash && !!b.bodyHash && a.bodyHash === b.bodyHash;

  // 2. Unauthenticated access is the worst case — check it first.
  if (p.anon && !p.anon.deniedLooking) {
    if (leaksMarker(p.anon, p.ownerMarker)) {
      return { verdict: "unauth", severity: "critical", confidence: 96,
        reasons: [`Unauthenticated request returned the owner's data (marker "${p.ownerMarker}" present). No session required to read the object.`] };
    }
    if (SUCCESS(p.anon.status) && sameHash(p.owner, p.anon)) {
      return { verdict: "unauth", severity: "critical", confidence: 92,
        reasons: [`Unauthenticated request returned a byte-identical copy of the owner's object (same body hash). No auth required.`] };
    }
    if (SUCCESS(p.anon.status) && similarSize(p.owner, p.anon)) {
      return { verdict: "unauth", severity: bump("high", p.endpoint), confidence: isData ? 78 : 65,
        reasons: [`Unauthenticated request succeeded (${p.anon.status}) with a response the same shape as the owner's — object appears readable with no auth. Verify it's the owner's object.`] };
    }
  }

  // 3. Cross-account (BOLA): account B fetching account A's object.
  if (leaksMarker(p.attacker, p.ownerMarker)) {
    return { verdict: "bola", severity: "critical", confidence: 95,
      reasons: [`Account B's response contains account A's data marker ("${p.ownerMarker}") — B can read A's object. Confirmed broken object-level authorization.`] };
  }
  if (SUCCESS(p.attacker.status) && sameHash(p.owner, p.attacker)) {
    return { verdict: "bola", severity: bump("high", p.endpoint) === "critical" ? "critical" : "high", confidence: 93,
      reasons: [`Account B received a byte-identical copy of account A's object (same body hash) — confirmed broken object-level authorization.`] };
  }
  // A 200 that's actually a login/denied page is NOT access — treat as enforced.
  if (p.attacker.deniedLooking) {
    return { verdict: "safe", severity: "info", confidence: 80,
      reasons: [`Account B got ${p.attacker.status} but the response is a login/denied page (soft-deny) — authorization is enforced.`] };
  }
  if (SUCCESS(p.attacker.status)) {
    if (similarSize(p.owner, p.attacker)) {
      // Same-shape success from another account → strong, but not marker-proven.
      return { verdict: "bola", severity: bump("high", p.endpoint), confidence: isData ? 80 : 68,
        reasons: [
          `Account B received a ${p.attacker.status} the same shape as the owner's response for A's object.`,
          `Confirm it's A's data (not B's own) with a data marker — then it's a confirmed BOLA.`,
        ] };
    }
    // 200 but different shape — could be B's own object, or a generic page. Suspected.
    return { verdict: "inconclusive", severity: "medium", confidence: 40,
      reasons: [`Account B got ${p.attacker.status} but a different-shaped body — likely B's own object or a generic page. Re-test with a marker unique to A's data to decide.`] };
  }

  // 4. Denied → correctly enforced.
  if (DENIED(p.attacker.status)) {
    return { verdict: "safe", severity: "info", confidence: 85,
      reasons: [`Account B was correctly denied (${p.attacker.status}) — object-level authorization is enforced here.`] };
  }

  return { verdict: "inconclusive", severity: "info", confidence: 20,
    reasons: [`Attacker response ${p.attacker.status} was neither a clear success nor a clear denial — inspect manually.`] };
}

// ── Enumerability: which endpoints are even worth differential-testing ──────────
// IDOR needs a guessable object reference. A numeric/sequential id is the classic
// candidate; a long random UUID/hash is far less exploitable (can't enumerate).

const NUMERIC_ID = /\/(\d{1,12})(?:\b|\/|$|\?)/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_HASH = /\b[0-9a-f]{24,}\b/i;

export type IdRef = { kind: "numeric" | "uuid" | "hash" | "none"; value: string | null; enumerable: boolean };

/** Classify the object reference in an endpoint — numeric ids are enumerable (high
 *  IDOR risk); UUIDs/long hashes are effectively unguessable (low priority). */
export function objectRef(endpoint: string): IdRef {
  const num = endpoint.match(NUMERIC_ID);
  if (num) return { kind: "numeric", value: num[1], enumerable: true };
  const uuid = endpoint.match(UUID);
  if (uuid) return { kind: "uuid", value: uuid[0], enumerable: false };
  const hash = endpoint.match(LONG_HASH);
  if (hash) return { kind: "hash", value: hash[0], enumerable: false };
  return { kind: "none", value: null, enumerable: false };
}

/** Rank endpoints for IDOR testing: those with an enumerable numeric id on a
 *  sensitive path first. Returns the input annotated + sorted, worst-first. */
export function prioritizeForIdor<T extends { endpoint: string }>(items: T[]): (T & { ref: IdRef; sensitive: boolean; score: number })[] {
  return items
    .map((it) => {
      const ref = objectRef(it.endpoint);
      const sensitive = SENSITIVE.test(it.endpoint);
      const score = (ref.enumerable ? 2 : ref.kind !== "none" ? 1 : 0) + (sensitive ? 1 : 0);
      return { ...it, ref, sensitive, score };
    })
    .filter((x) => x.ref.kind !== "none")
    .sort((a, b) => b.score - a.score);
}
