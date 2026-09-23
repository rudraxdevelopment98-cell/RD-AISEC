/**
 * Secret VALUE classification — exposure is not the same as a payable bug.
 *
 * The detector finds any string shaped like a credential, but their bounty value
 * spans two orders of magnitude:
 *
 *   • public-by-design — Google browser/Maps/Firebase API keys (AIza…), Stripe
 *     PUBLISHABLE keys (pk_…), Sentry public DSNs, reCAPTCHA site keys, OAuth
 *     client_ids, GA/Mapbox tokens, Algolia search keys. These are MEANT to ship
 *     in client-side code. Reporting them gets auto-closed as Informational / N/A
 *     ($0) and burns reputation — the exact "time-pass" trap to avoid.
 *
 *   • privileged — GitHub/GitLab/Slack tokens, Stripe SECRET keys (sk_live_…),
 *     SendGrid, AWS secret keys, private keys, live DB/connection creds. These are
 *     genuinely high value, ESPECIALLY once secretvalidate proves them live.
 *
 * This module is the pure classifier both the novelty score and the finding UI use
 * so a Google Maps key never again shows up as an "88/100 reportable" finding.
 * See docs/ENGINE-EARNING-RESEARCH.md.
 */

export type SecretValue = "public" | "privileged" | "unknown";

// Public-by-design: intended to be client-side. Matching here means LOW value.
const PUBLIC_SIGNS: { re: RegExp; what: string }[] = [
  { re: /\bAIza[0-9A-Za-z_\-]{35}\b/, what: "Google browser/Maps/Firebase API key" },
  { re: /\bpk_(live|test)_[0-9A-Za-z]{8,}\b/, what: "Stripe publishable key" },
  { re: /\b[0-9]+-[0-9a-z_]+\.apps\.googleusercontent\.com\b/i, what: "Google OAuth client id" },
  { re: /\bhttps:\/\/[0-9a-f]+@[0-9a-z.\-]*(sentry\.io|ingest\.[0-9a-z.\-]+)\/[0-9]+\b/i, what: "Sentry public DSN" },
  { re: /\b6L[0-9A-Za-z_\-]{38}\b/, what: "reCAPTCHA site key" },
  { re: /\bpk\.eyJ[0-9A-Za-z_\-]{20,}\b/, what: "Mapbox public token" },
  { re: /\bUA-[0-9]{4,}-[0-9]+\b|\bG-[0-9A-Z]{8,}\b|\bGTM-[0-9A-Z]{5,}\b/, what: "Google Analytics / GTM id" },
  { re: /\bfirebaseio\.com\b|\bfirebaseapp\.com\b|["']?apiKey["']?\s*[:=]\s*["']AIza/i, what: "Firebase web config" },
  { re: /\balgolia[^\n]{0,40}search[^\n]{0,4}key/i, what: "Algolia search-only key" },
];

// Privileged: server-side credentials that grant real access. HIGH value.
const PRIVILEGED_SIGNS: { re: RegExp; what: string }[] = [
  { re: /\b(gh[oprsu]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/, what: "GitHub token" },
  { re: /\bglpat-[A-Za-z0-9_\-]{20,}\b/, what: "GitLab token" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, what: "Slack token" },
  { re: /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_\/]+\b/, what: "Slack incoming webhook" },
  { re: /\bsk_live_[A-Za-z0-9]{16,}\b/, what: "Stripe SECRET key" },
  { re: /\brk_live_[A-Za-z0-9]{16,}\b/, what: "Stripe restricted key" },
  { re: /\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b/, what: "SendGrid key" },
  { re: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/, what: "OpenAI key" },
  { re: /\bnpm_[A-Za-z0-9]{36}\b/, what: "npm token" },
  { re: /\bdop_v1_[0-9a-f]{64}\b/, what: "DigitalOcean token" },
  { re: /\bshp(at|ca|pa|ss)_[0-9a-fA-F]{32}\b/, what: "Shopify access token" },
  { re: /\bPMAK-[0-9a-f]{24}-[0-9a-f]{34}\b/, what: "Postman API key" },
  { re: /\bkey-[0-9a-f]{32}\b/, what: "Mailgun key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: "AWS access key id" },
  { re: /-----BEGIN[ A-Z]*PRIVATE KEY-----/, what: "private key" },
  { re: /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s:@/]+@/i, what: "database/service connection string with credentials" },
];

export type SecretAssessment = {
  value: SecretValue;
  what: string;      // human label of what was recognized
  payable: boolean;  // is this class plausibly worth a bounty at all?
  reason: string;    // short explanation for the UI / report gate
};

/**
 * Classify the bounty value of a secret-type finding from its text (title +
 * description — where the detector recorded what it found). Never returns or logs
 * the secret itself; only its class.
 */
export function classifySecretValue(text: string): SecretAssessment {
  const hay = text || "";
  // Privileged wins if both somehow match (a real secret alongside a public one).
  for (const s of PRIVILEGED_SIGNS) {
    if (s.re.test(hay)) {
      return {
        value: "privileged",
        what: s.what,
        payable: true,
        reason: `Privileged credential (${s.what}) — high value if live. Prove it with a read-only identity check before reporting.`,
      };
    }
  }
  for (const s of PUBLIC_SIGNS) {
    if (s.re.test(hay)) {
      return {
        value: "public",
        what: s.what,
        payable: false,
        reason: `${s.what} is public-by-design (meant to ship in client-side code) — programs close these as informational / N/A. Not payable unless you can show it grants a privileged, unrestricted scope (e.g. billing abuse on an unrestricted key).`,
      };
    }
  }
  return {
    value: "unknown",
    what: "unrecognized credential",
    payable: true,
    reason: "Unrecognized credential shape — value unclear. Prove it's live and privileged before reporting; don't submit on exposure alone.",
  };
}
